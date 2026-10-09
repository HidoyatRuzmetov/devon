import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa a remote note refresh cannot silently overwrite an unsaved local title', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/personal/notes', {
      title: `Local QA note conflict ${randomUUID()}`,
    })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string; version: number }
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    const card = page.locator(`[data-personal-note-id="${created.id}"]`)
    const title = card.getByRole('textbox', { name: 'Note title', exact: true })
    await title.fill('My unsaved note title')
    expect(
      (
        await authedPatch(context, `/api/v1/personal/notes/${created.id}`, {
          version: created.version,
          title: 'Title saved in another tab',
          body: { text: 'Body saved in another tab' },
        })
      ).status(),
    ).toBe(200)
    const refreshed = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        new URL(res.url()).pathname === '/api/v1/personal/notes',
    )
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    expect((await refreshed).status()).toBe(200)
    await expect(card.getByRole('textbox', { name: 'Note body', exact: true })).toHaveValue(
      'Body saved in another tab',
    )
    await expect(title).toHaveValue('My unsaved note title')
    const saved = page.waitForResponse(
      (res) =>
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/notes/${created.id}`,
    )
    await card.getByRole('button', { name: 'Pin', exact: true }).focus()
    expect((await saved).status()).toBe(409)
    await expect(card.getByRole('alert')).toContainText('changed elsewhere')
    const notes = await (await context.request.get('/api/v1/personal/notes')).json()
    expect(notes.find((note: { id: string }) => note.id === created.id)).toMatchObject({
      title: 'Title saved in another tab',
      body: { text: 'Body saved in another tab' },
    })
    await card.getByRole('button', { name: 'Retry save', exact: true }).click()
    await expect
      .poll(async () => {
        const current = await (await context.request.get('/api/v1/personal/notes')).json()
        return current.find((note: { id: string }) => note.id === created.id)
      })
      .toMatchObject({
        title: 'My unsaved note title',
        body: { text: 'Body saved in another tab' },
      })
  } finally {
    await context.close()
  }
})

test('@qa leaving a note body cancels the duplicate delayed save', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `Local QA note autosave ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/personal/notes', { title })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    const statuses: number[] = []
    page.on('response', (res) => {
      if (
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/notes/${created.id}`
      )
        statuses.push(res.status())
    })
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    const card = page.locator(`input[value="${title}"]`).locator('../..')
    await card.locator('textarea').fill('A note body that must be saved once.')
    await card.getByRole('button', { name: 'Pin', exact: true }).focus()
    await expect.poll(() => statuses).toContain(200)
    await page.waitForTimeout(1000)
    expect(statuses).toEqual([200])
    const persisted = (await (await context.request.get('/api/v1/personal/notes')).json()) as {
      id: string
      body: { text: string }
    }[]
    expect(persisted.find((item) => item.id === created.id)?.body.text).toBe(
      'A note body that must be saved once.',
    )
  } finally {
    await context.close()
  }
})

test('@qa a failed note title save preserves the draft and explains the failure', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `Local QA note refusal ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/personal/notes', { title })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    await page.route(`**/api/v1/personal/notes/${created.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Controlled local note refusal',
          status: 503,
        }),
      })
    })
    const card = page.locator(`[data-personal-note-id="${created.id}"]`)
    const input = card.getByRole('textbox', { name: 'Note title', exact: true })
    await input.fill('Retained private note title')
    await card.locator('textarea').focus()
    await expect(card.getByRole('alert')).toContainText('Could not save')
    await expect(input).toHaveValue('Retained private note title')
    const persisted = (await (await context.request.get('/api/v1/personal/notes')).json()) as {
      id: string
      title: string
    }[]
    expect(persisted.find((item) => item.id === created.id)?.title).toBe(title)
    await page.unroute(`**/api/v1/personal/notes/${created.id}`)
    await card.getByRole('button', { name: 'Retry save', exact: true }).click()
    await expect
      .poll(async () => {
        const notes = (await (await context.request.get('/api/v1/personal/notes')).json()) as {
          id: string
          title: string
        }[]
        return notes.find((item) => item.id === created.id)?.title
      })
      .toBe('Retained private note title')
    await expect(card.getByRole('alert')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('@qa a pending note save preserves newer body and title drafts in request order', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let release: () => void = () => undefined
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/personal/notes', {
      title: `Local QA queued note ${randomUUID()}`,
    })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let writes = 0
    const statuses: number[] = []
    page.on('response', (res) => {
      if (
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/notes/${created.id}`
      )
        statuses.push(res.status())
    })
    await page.route(`**/api/v1/personal/notes/${created.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      writes += 1
      if (writes === 1) await gate
      await route.continue()
    })
    const card = page.locator(`[data-personal-note-id="${created.id}"]`)
    const body = card.getByRole('textbox', { name: 'Note body', exact: true })
    const title = card.getByRole('textbox', { name: 'Note title', exact: true })
    await body.fill('Earlier note body')
    await expect.poll(() => writes).toBe(1)
    await body.fill('Latest note body')
    await title.fill('Latest queued note title')
    await body.focus()
    await page.waitForTimeout(700)
    expect(writes).toBe(1)
    release()
    await expect.poll(() => statuses).toEqual([200, 200])
    await expect(body).toHaveValue('Latest note body')
    await expect(title).toHaveValue('Latest queued note title')
    const notes = (await (await context.request.get('/api/v1/personal/notes')).json()) as {
      id: string
      title: string
      body: { text: string }
    }[]
    expect(notes.find((item) => item.id === created.id)).toMatchObject({
      title: 'Latest queued note title',
      body: { text: 'Latest note body' },
    })
    await page.reload()
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    await expect(body).toHaveValue('Latest note body')
    await expect(title).toHaveValue('Latest queued note title')
  } finally {
    release()
    await context.close()
  }
})
