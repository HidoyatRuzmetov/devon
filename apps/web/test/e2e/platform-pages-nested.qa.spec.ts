import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa a refused new page has feedback and a cancel path', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    await page.goto('/pages')
    await page.getByRole('button', { name: 'New page', exact: true }).first().click()
    const title = page.getByRole('textbox', { name: 'Page title', exact: true })
    await title.fill(`Failed new page ${randomUUID()}`)
    const form = title.locator('..')
    let refused = 0
    await page.route('**/api/v1/pages', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      refused++
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Controlled create refusal',
          status: 503,
        }),
      })
    })
    await form.getByRole('button', { name: 'New page', exact: true }).click()
    await expect.poll(() => refused).toBe(1)
    await expect(form.getByRole('alert')).toBeVisible()
    await expect(title).not.toHaveValue('')
    await page.screenshot({
      path: test.info().outputPath('page-create-refused.png'),
      fullPage: true,
    })
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(title).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New page', exact: true }).first()).toBeFocused()
  } finally {
    await context.close()
  }
})

test('@qa failed onboarding loading is not presented as an empty checklist', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    await page.route('**/api/v1/pages/onboarding/templates', async (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Controlled template refusal',
          status: 503,
        }),
      }),
    )
    await page.goto('/pages?tab=onboarding')
    await expect(page.locator('main').getByRole('alert')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('No onboarding checklist yet')
    await page.unroute('**/api/v1/pages/onboarding/templates')
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(
      page.getByRole('textbox', { name: 'Checklist name', exact: true }).first(),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})

test('@qa toggling an onboarding template preserves added draft items', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const name = `Checklist draft ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/pages/onboarding/templates', {
      name,
      enabled: true,
      items: [{ id: 'first', text: 'Original checklist item', ownerRole: 'newcomer' }],
    })
    expect(response.status()).toBe(201)
    const created = await response.json()
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const card = page.getByRole('heading', { name, exact: true }).locator('..').locator('..')
    const input = card.getByRole('textbox', { name: 'What needs to happen?', exact: true })
    await input.fill('Retained newcomer instruction')
    await card.getByRole('button', { name: 'Add item', exact: true }).click()
    await expect(card.getByRole('listitem')).toHaveCount(2)
    const toggled = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/pages/onboarding/templates/${created.id}` &&
        response.request().method() === 'PATCH',
    )
    await card.getByRole('switch').click()
    expect((await toggled).status()).toBe(200)
    await expect
      .poll(
        async () =>
          (await (await context.request.get('/api/v1/pages/onboarding/templates')).json()).find(
            (row: { id: string }) => row.id === created.id,
          )?.enabled,
      )
      .toBe(false)
    await expect(card.getByRole('switch')).not.toBeChecked()
    await expect(card.getByRole('listitem')).toHaveCount(2)
    await page.screenshot({
      path: test.info().outputPath('onboarding-item-retained.png'),
      fullPage: true,
    })
    const save = card.getByRole('button', { name: 'Save', exact: true })
    if (await save.count()) await save.click()
    await expect
      .poll(async () =>
        (await (await context.request.get('/api/v1/pages/onboarding/templates')).json())
          .find((row: { id: string }) => row.id === created.id)
          ?.items.map((item: { text: string }) => item.text),
      )
      .toEqual(['Original checklist item', 'Retained newcomer instruction'])
    await page.reload()
    await expect(card.getByRole('listitem')).toHaveCount(2)
  } finally {
    await context.close()
  }
})
