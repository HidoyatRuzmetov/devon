import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

type Kind = 'tasks' | 'notes' | 'canvases'

async function deleteThroughUi(page: Page, kind: Kind, title: string) {
  const tab = { tasks: 'To-dos', notes: 'Notes', canvases: 'Canvas' }[kind]
  const action = { tasks: 'Delete to-do', notes: 'Delete note', canvases: 'Delete canvas' }[kind]
  await page.getByRole('tab', { name: tab, exact: true }).click()
  const content =
    kind === 'canvases'
      ? page.getByText(title, { exact: true })
      : page.locator(`input[value="${title}"]`)
  await content.locator('..').getByRole('button', { name: action, exact: true }).click()
}

for (const kind of ['tasks', 'notes', 'canvases'] as const) {
  test(`@qa personal ${kind} undo restores the persisted deletion after changing tabs`, async ({
    browser,
  }) => {
    const context = await newFlowContext(browser)
    try {
      await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      const title = `Local QA Undo ${kind} ${randomUUID()}`
      const response = await authedPost(context, `/api/v1/personal/${kind}`, { title })
      expect(response.status()).toBe(201)
      const created = (await response.json()) as { id: string }
      const page = await context.newPage()
      await page.goto('/personal')
      await deleteThroughUi(page, kind, title)
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
      expect(
        (
          (await (await context.request.get(`/api/v1/personal/${kind}`)).json()) as { id: string }[]
        ).some((item) => item.id === created.id),
      ).toBe(false)
      await page.getByRole('tab', { name: 'Periods', exact: true }).click()
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect
        .poll(async () =>
          (
            (await (await context.request.get(`/api/v1/personal/${kind}`)).json()) as {
              id: string
            }[]
          ).some((item) => item.id === created.id),
        )
        .toBe(true)
      await page.reload()
      await page
        .getByRole('tab', {
          name: { tasks: 'To-dos', notes: 'Notes', canvases: 'Canvas' }[kind],
          exact: true,
        })
        .click()
      if (kind === 'canvases') await expect(page.getByText(title, { exact: true })).toBeVisible()
      else await expect(page.locator(`input[value="${title}"]`)).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test(`@qa failed personal ${kind} deletion retains the item and offers no false Undo`, async ({
    browser,
  }) => {
    const context = await newFlowContext(browser)
    try {
      await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      const title = `Local QA refused ${kind} ${randomUUID()}`
      const response = await authedPost(context, `/api/v1/personal/${kind}`, { title })
      expect(response.status()).toBe(201)
      const created = (await response.json()) as { id: string }
      const page = await context.newPage()
      await page.goto('/personal')
      await page.route(`**/api/v1/personal/${kind}/${created.id}?receipt=true`, async (route) => {
        if (route.request().method() !== 'DELETE') return route.continue()
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Controlled local deletion refusal',
            status: 503,
          }),
        })
      })
      await deleteThroughUi(page, kind, title)
      await expect(page.getByText('Could not save', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
      if (kind === 'canvases') await expect(page.getByText(title, { exact: true })).toBeVisible()
      else await expect(page.locator(`input[value="${title}"]`)).toBeVisible()
      expect(
        (
          (await (await context.request.get(`/api/v1/personal/${kind}`)).json()) as { id: string }[]
        ).some((item) => item.id === created.id),
      ).toBe(true)
    } finally {
      await context.close()
    }
  })
}

test('@qa Today completion Undo persists after leaving the tab', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `Local QA completion Undo ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/personal/tasks', { title })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto('/personal')
    await page
      .locator('li')
      .filter({ has: page.getByText(title, { exact: true }) })
      .getByRole('checkbox', { name: 'Mark done', exact: true })
      .click()
    await expect(page.getByText('Marked done', { exact: true })).toBeVisible()
    expect(
      (
        (await (await context.request.get('/api/v1/personal/tasks')).json()) as {
          id: string
          doneAt: string | null
        }[]
      ).find((item) => item.id === created.id)?.doneAt,
    ).toBeTruthy()
    await page.getByRole('tab', { name: 'Periods', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            (await (await context.request.get('/api/v1/personal/tasks')).json()) as {
              id: string
              doneAt: string | null
            }[]
          ).find((item) => item.id === created.id)?.doneAt,
      )
      .toBe(null)
  } finally {
    await context.close()
  }
})
