import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, csrfToken, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

test("@qa a colleague may edit a shared page but cannot delete or restore its owner's work", async ({
  browser,
}) => {
  const owner = await newFlowContext(browser)
  const colleague = await newFlowContext(browser)
  try {
    await login(owner, { login: 'demo.boshliq', password: qaExampleCredential1 })
    await login(colleague, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(colleague, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const createdResponse = await authedPost(owner, '/api/v1/pages', {
      kind: 'note',
      title: `Other colleague's page ${randomUUID()}`,
      blocks: doc('Shared knowledge'),
    })
    expect(createdResponse.status()).toBe(201)
    const created = await createdResponse.json()
    const path = `/api/v1/pages/${created.id}`
    expect(
      (
        await authedPatch(colleague, path, {
          version: created.version,
          title: 'Collaborative title',
        })
      ).status(),
    ).toBe(200)
    const page = await colleague.newPage()
    await page.goto(`/pages?page=${created.id}`)
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Collaborative title',
    )
    await expect(page.getByRole('button', { name: 'More actions', exact: true })).toHaveCount(0)
    const history = page
      .getByRole('heading', { name: 'Version history', exact: true })
      .locator('..')
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await history.getByRole('listitem').nth(1).getByRole('button').click()
    await expect(
      history.getByRole('button', { name: 'Restore this version', exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await colleague.request.delete(path, {
          headers: { 'x-csrf-token': await csrfToken(colleague) },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await owner.request.delete(path, { headers: { 'x-csrf-token': await csrfToken(owner) } })
      ).status(),
    ).toBe(204)
    expect((await authedPost(colleague, `${path}/restore`, {})).status()).toBe(403)
    expect((await colleague.request.get(path)).status()).toBe(404)
    expect((await authedPost(owner, `${path}/restore`, {})).status()).toBe(204)
    expect((await owner.request.get(path)).status()).toBe(200)
  } finally {
    await owner.close()
    await colleague.close()
  }
})

test('@qa a knowledge page saves title and body together instead of dropping the preceding field', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/pages', {
      kind: 'note',
      title: `Combined page save ${randomUUID()}`,
      blocks: doc('Initial paragraph'),
    })
    expect(response.status()).toBe(201)
    const created = await response.json()
    const page = await context.newPage()
    await page.goto(`/pages?page=${created.id}`)
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    const body = page.locator('main [contenteditable="true"]')
    await expect(title).toHaveValue(created.title)
    await title.fill('Saved knowledge title')
    await body.fill('Saved knowledge paragraph')
    await expect
      .poll(async () => (await context.request.get(`/api/v1/pages/${created.id}`)).json())
      .toMatchObject({ title: 'Saved knowledge title', blocks: doc('Saved knowledge paragraph') })
    const saved = await (await context.request.get(`/api/v1/pages/${created.id}`)).json()
    expect(saved.blocks).toMatchObject(doc('Saved knowledge paragraph'))
    await page.reload()
    await expect(title).toHaveValue('Saved knowledge title')
    await expect(body).toHaveText('Saved knowledge paragraph')
  } finally {
    await context.close()
  }
})

test('@qa a refused knowledge save preserves the draft and offers an actual retry', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/pages', {
      kind: 'note',
      title: `Knowledge save refusal ${randomUUID()}`,
    })
    expect(response.status()).toBe(201)
    const created = await response.json()
    const page = await context.newPage()
    await page.goto(`/pages?page=${created.id}`)
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    await expect(title).toHaveValue(created.title)
    await page.route(`**/api/v1/pages/${created.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Controlled save refusal',
          status: 503,
        }),
      })
    })
    await title.fill('Retained knowledge draft')
    await expect(page.locator('main').getByRole('alert')).toContainText('Could not save')
    await expect(title).toHaveValue('Retained knowledge draft')
    expect((await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).title).toBe(
      created.title,
    )
    await page.unroute(`**/api/v1/pages/${created.id}`)
    await page.getByRole('button', { name: 'Retry save', exact: true }).click()
    await expect
      .poll(
        async () => (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).title,
      )
      .toBe('Retained knowledge draft')
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('@qa restoring a page version updates the visible title and editor without reload', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const originalTitle = `Version restore ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/pages', {
      kind: 'note',
      title: originalTitle,
      blocks: doc('Earlier useful paragraph'),
    })
    expect(response.status()).toBe(201)
    const created = await response.json()
    expect(
      (
        await authedPatch(context, `/api/v1/pages/${created.id}`, {
          version: created.version,
          title: 'Later knowledge title',
          blocks: doc('Later paragraph'),
        })
      ).status(),
    ).toBe(200)
    const page = await context.newPage()
    await page.goto(`/pages?page=${created.id}`)
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    const body = page.locator('main [contenteditable="true"]')
    await expect(title).toHaveValue('Later knowledge title')
    const history = page
      .getByRole('heading', { name: 'Version history', exact: true })
      .locator('..')
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await history.getByRole('listitem').nth(1).getByRole('button').click()
    await history.getByRole('button', { name: 'Restore this version', exact: true }).click()
    await expect
      .poll(
        async () => (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).title,
      )
      .toBe(originalTitle)
    await expect(title).toHaveValue(originalTitle)
    await expect(body).toHaveText('Earlier useful paragraph')
    expect(
      (await (await context.request.get(`/api/v1/pages/${created.id}/versions`)).json()).length,
    ).toBe(3)
  } finally {
    await context.close()
  }
})

test('@qa a failed version preview has a retry and does not show stale history', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/pages', {
      kind: 'note',
      title: `History recovery ${randomUUID()}`,
      blocks: doc('Original history'),
    })
    expect(response.status()).toBe(201)
    const created = await response.json()
    expect(
      (
        await authedPatch(context, `/api/v1/pages/${created.id}`, {
          version: created.version,
          title: 'New history title',
          blocks: doc('New history'),
        })
      ).status(),
    ).toBe(200)
    const versions = await (
      await context.request.get(`/api/v1/pages/${created.id}/versions`)
    ).json()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`/pages?page=${created.id}`)
    const history = page
      .getByRole('heading', { name: 'Version history', exact: true })
      .locator('..')
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await history.getByRole('listitem').first().getByRole('button').click()
    await expect(history).toContainText('No changes')
    const oldPath = `/api/v1/pages/${created.id}/versions/${versions[1].id}`
    let refused = 0
    await page.route(`**${oldPath}`, async (route) => {
      refused++
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Controlled version refusal',
          status: 503,
        }),
      })
    })
    await history.getByRole('listitem').nth(1).getByRole('button').first().click()
    await expect.poll(() => refused).toBe(1)
    await expect(history.getByRole('alert')).toBeVisible()
    await expect(history).not.toContainText('No changes')
    await page.screenshot({
      path: test.info().outputPath('history-preview-failed.png'),
      fullPage: true,
    })
    await page.unroute(`**${oldPath}`)
    await history.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(history).toContainText('Original')
    await expect(history.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
