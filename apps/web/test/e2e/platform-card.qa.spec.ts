/* eslint-disable no-restricted-syntax -- Viewport and typography transitions share one browser page and must run sequentially. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { settleCapture } from './platform-capture.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa a blank card title has clear feedback and a corrected title persists', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/cards', {
      title: 'Local QA required title',
    })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    const page = await context.newPage()
    let writes = 0
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === `/api/v1/cards/${card.id}`
      )
        writes += 1
    })
    await page.goto(`/work/card?id=${card.id}`)
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    const description = page.getByRole('textbox', { name: 'Description', exact: true })
    await title.fill('   ')
    await description.focus()
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a card title.' })).toBeVisible()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(writes).toBe(0)
    expect((await (await context.request.get(`/api/v1/cards/${card.id}`)).json()).title).toBe(
      'Local QA required title',
    )
    await title.fill('Corrected card title')
    await description.focus()
    await expect
      .poll(
        async () => (await (await context.request.get(`/api/v1/cards/${card.id}`)).json()).title,
      )
      .toBe('Corrected card title')
    await expect(title).not.toHaveAttribute('aria-invalid', 'true')
    await page.reload()
    await expect(title).toHaveValue('Corrected card title')
  } finally {
    await context.close()
  }
})

test('@qa repeated title saves reach the server in order and retain the newer draft', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let releaseFirst: () => void = () => undefined
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/cards', { title: 'Local QA ordered saves' })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto(`/work/card?id=${card.id}`)
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    const description = page.getByRole('textbox', { name: 'Description', exact: true })
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let writes = 0
    await page.route(`**/api/v1/cards/${card.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      writes += 1
      if (writes > 1) return route.continue()
      await firstGate
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Controlled local refusal',
          status: 503,
        }),
      })
    })
    await title.fill('Earlier title draft')
    await description.focus()
    await expect.poll(() => writes).toBe(1)
    await title.fill('Latest title draft')
    await description.focus()
    await page.waitForTimeout(400)
    expect(writes, 'a later save must wait for the older request to settle').toBe(1)
    releaseFirst()
    await expect.poll(() => writes).toBe(2)
    await expect
      .poll(
        async () => (await (await context.request.get(`/api/v1/cards/${card.id}`)).json()).title,
      )
      .toBe('Latest title draft')
    await expect(title).toHaveValue('Latest title draft')
    await page.reload()
    await expect(title).toHaveValue('Latest title draft')
  } finally {
    releaseFirst()
    await context.close()
  }
})

test('@qa unrelated card readers see readable properties without edit controls', async ({
  browser,
}) => {
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await login(head, { login: 'demo.boshliq', password: qaExampleCredential1 })
    const response = await authedPost(head, '/api/v1/cards', {
      title: 'Local QA read-only property example',
      description: 'A readable description for colleagues.',
      dueAt: '2026-12-01T12:00:00.000Z',
      startAt: '2026-11-01T12:00:00.000Z',
      priority: 'high',
    })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    await login(member, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const before = await (await member.request.get(`/api/v1/cards/${card.id}`)).json()
    expect(before.canEdit).toBe(false)
    const page = await member.newPage()
    await page.goto(`/work/card?id=${card.id}`)
    await expect(page.getByText(/This card is not yours to change/)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveAttribute(
      'readonly',
      '',
    )
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveAttribute(
      'readonly',
      '',
    )
    await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Due', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Assignee: / })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Giver: / })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toHaveCount(0)
    expect(
      (await authedPatch(member, `/api/v1/cards/${card.id}`, { priority: 'none' })).status(),
    ).toBe(403)
    const persisted = await (await member.request.get(`/api/v1/cards/${card.id}`)).json()
    expect(persisted.priority).toBe(before.priority)
    expect(persisted.description).toEqual(before.description)
  } finally {
    await head.close()
    await member.close()
  }
})

test('@qa card translation and time entries reflow and persist at narrow widths', async ({
  browser,
}, info) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/cards', {
      title: 'Local QA narrow card',
      description: 'A description with enough text to offer the translation target control.',
      estimateMin: 120,
    })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.setViewportSize({ width: 320, height: 600 })
    await page.goto(`/work/card?id=${card.id}`)
    const target = page.getByRole('combobox', { name: 'Into which language', exact: true })
    await expect(target).toBeVisible()
    await target.selectOption('ru')
    await expect(target).toHaveValue('ru')
    const note = 'Local QA time entry ' + 'x'.repeat(180)
    await page.getByRole('textbox', { name: 'Time spent', exact: true }).fill('45 minutes')
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill(note)
    await page.getByRole('button', { name: 'Log', exact: true }).click()
    const logs = async () =>
      (await (await context.request.get(`/api/v1/cards/${card.id}/time-logs`)).json()) as {
        entries: { id: string; note: string | null }[]
        loggedMin: number
      }
    await expect.poll(async () => (await logs()).loggedMin).toBe(45)
    expect((await logs()).entries.some((entry) => entry.note === note)).toBe(true)
    await page.reload()
    await expect(page.getByText(note, { exact: true })).toBeVisible()
    const dir = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/card-reflow')
    mkdirSync(dir, { recursive: true })
    for (const [width, textScale] of [
      [320, 1],
      [390, 1],
      [768, 1],
      [320, 2],
    ] as const) {
      await page.setViewportSize({ width, height: 600 })
      if (textScale === 2) {
        await page.evaluate(() => {
          const root = document.documentElement
          const computed = getComputedStyle(root)
          // The project uses px typography tokens. Enlarge actual text and line heights,
          // preserving spacing/icons; changing root font-size alone is not text enlargement.
          for (const name of [
            'eyebrow',
            'caption',
            'small',
            'body',
            'lead',
            'h3',
            'h2',
            'h1',
            'hero',
          ]) {
            for (const suffix of ['', '--line-height']) {
              const token = `--text-${name}${suffix}`
              const value = parseFloat(computed.getPropertyValue(token))
              if (Number.isFinite(value)) root.style.setProperty(token, `${value * 2}px`)
            }
          }
        })
      }
      await settleCapture(page)
      await page.screenshot({
        path: join(dir, `${info.project.name}-${width}-text-${textScale}.png`),
        fullPage: true,
      })
      if ((await page.evaluate(() => document.documentElement.scrollWidth)) > width + 1) {
        await info.attach('overflow-elements', {
          body: JSON.stringify(
            await page.locator('body *').evaluateAll((elements) =>
              elements
                .map((element) => ({
                  tag: element.tagName,
                  text: element.textContent?.slice(0, 100),
                  className: element.getAttribute('class'),
                  left: element.getBoundingClientRect().left,
                  right: element.getBoundingClientRect().right,
                  width: element.getBoundingClientRect().width,
                }))
                .filter((element) => element.right > innerWidth + 1 || element.left < -1),
            ),
            null,
            2,
          ),
          contentType: 'application/json',
        })
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      )
      const deletion = page.getByRole('button', { name: 'Delete entry', exact: true })
      await deletion.scrollIntoViewIfNeeded()
      const bounds = await deletion.boundingBox()
      expect(bounds).toBeTruthy()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(bounds!.width).toBeGreaterThanOrEqual(24)
    }
    await page.getByRole('button', { name: 'Delete entry', exact: true }).click()
    await expect.poll(async () => (await logs()).entries.length).toBe(0)
    expect((await logs()).loggedMin).toBe(0)
  } finally {
    await context.close()
  }
})

test('@qa card autosave failures retain drafts and retry without unhandled errors', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/cards', {
      title: 'Local QA saved title',
      description: 'Saved description.',
    })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`/work/card?id=${card.id}`)
    const title = page.getByRole('textbox', { name: 'Title', exact: true })
    const description = page.getByRole('textbox', { name: 'Description', exact: true })
    const endpoint = `**/api/v1/cards/${card.id}`
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Controlled local save refusal',
          status: 503,
        }),
      })
    })
    await title.fill('Retained title draft')
    await description.focus()
    await expect(
      page.getByText('Could not save it. The previous value is back.', { exact: true }),
    ).toBeVisible()
    await expect(title).toHaveValue('Retained title draft')
    await description.fill('Retained description draft.')
    await title.focus()
    await expect(description).toHaveValue('Retained description draft.')
    const saved = await (await context.request.get(`/api/v1/cards/${card.id}`)).json()
    expect(saved.title).toBe('Local QA saved title')
    expect(saved.description.text).toBe('Saved description.')
    await page.unroute(endpoint)
    // A fresh focus/blur retries the draft through the actual application controls.
    await description.focus()
    await expect
      .poll(
        async () => (await (await context.request.get(`/api/v1/cards/${card.id}`)).json()).title,
      )
      .toBe('Retained title draft')
    await title.focus()
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/v1/cards/${card.id}`)).json()).description.text,
      )
      .toBe('Retained description draft.')
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
