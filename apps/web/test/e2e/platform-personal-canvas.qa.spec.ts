/* eslint-disable no-restricted-syntax -- Ordered keyboard gestures mutate one selected canvas object; each assertion depends on the preceding gesture. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { settleCapture } from './platform-capture.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa sticky notes retain readable text and named reachable controls in both themes', async ({
  browser,
}, info) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `Canvas sticky controls ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/personal/canvases', { title })
    expect(response.status()).toBe(201)
    const canvas = await response.json()
    const page = await context.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText(title, { exact: true }) })
      .getByRole('button', { name: 'Open', exact: true })
      .click()
    await page.getByRole('button', { name: 'Add sticky note', exact: true }).click()
    const text = page.locator('main textarea')
    await text.fill('A readable sticky note, also in dark mode.')
    await expect
      .poll(async () => {
        const saved = await (
          await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)
        ).json()
        return saved.stickies[0]?.text
      })
      .toBe('A readable sticky note, also in dark mode.')
    const dir = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/canvas-controls',
      process.env['QA_RUN_ID'] ?? 'default',
      info.project.name,
    )
    mkdirSync(dir, { recursive: true })
    const violations = []
    for (const theme of ['light', 'dark']) {
      for (
        let i = 0;
        i < 3 && (await page.locator('html').getAttribute('data-theme')) !== theme;
        i++
      ) {
        const previous = await page.evaluate(
          (key) => localStorage.getItem(key) ?? 'light',
          THEME_STORAGE_KEY,
        )
        const next = previous === 'light' ? 'dark' : previous === 'dark' ? 'system' : 'light'
        await page.getByRole('button', { name: 'Switch theme', exact: true }).click()
        await expect
          .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
          .toBe(next)
        await expect(page.locator('html')).not.toHaveClass(/devon-theme-transition/)
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await settleCapture(page)
      await page.screenshot({ path: join(dir, `sticky-${theme}-390.png`), fullPage: true })
      const result = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      violations.push({ theme, violations: result.violations })
    }
    writeFileSync(join(dir, 'sticky-axe.json'), JSON.stringify(violations, null, 2))
    await expect(text).toHaveAccessibleName('Sticky note text')
    const remove = text
      .locator('..')
      .getByRole('button', { name: 'Delete sticky note', exact: true })
    const target = await remove.boundingBox()
    expect(target!.width).toBeGreaterThanOrEqual(24)
    expect(target!.height).toBeGreaterThanOrEqual(24)
    expect(violations.flatMap((entry) => entry.violations)).toEqual([])
    await remove.focus()
    await remove.press('Enter')
    await expect
      .poll(async () => {
        const saved = await (
          await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)
        ).json()
        return saved.stickies.length
      })
      .toBe(0)
  } finally {
    await context.close()
  }
})

test('@qa leaving a canvas flushes the authorized latest drawing before its debounce', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `Canvas navigation ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/personal/canvases', { title })
    expect(response.status()).toBe(201)
    const canvas = await response.json()
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText(title, { exact: true }) })
      .getByRole('button', { name: 'Open', exact: true })
      .click()
    await drawRectangle(page)
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    await expect
      .poll(async () => {
        const saved = await (
          await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)
        ).json()
        return saved.scene.elements.length
      })
      .toBe(1)
    await page.reload()
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText(title, { exact: true }) })
      .getByRole('button', { name: 'Open', exact: true })
      .click()
    await expect(page.locator('svg[width="2400"][height="1400"] > g rect')).toHaveCount(1)
  } finally {
    await context.close()
  }
})

async function drawRectangle(page: Page) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  const drawing = page.locator('svg[width="2400"][height="1400"]')
  await drawing.scrollIntoViewIfNeeded()
  const bounds = await drawing.boundingBox()
  expect(bounds).toBeTruthy()
  await page.mouse.move(bounds!.x + 80, bounds!.y + 80)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + 180, bounds!.y + 140, { steps: 4 })
  await page.mouse.up()
}

test('@qa canvas title and drawing saves use the preceding committed version', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let release: () => void = () => undefined
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `Local QA canvas saves ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/personal/canvases', { title })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText(title, { exact: true }) })
      .getByRole('button', { name: 'Open', exact: true })
      .click()
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let writes = 0
    const statuses: number[] = []
    page.on('response', (res) => {
      if (
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/canvases/${created.id}`
      )
        statuses.push(res.status())
    })
    await page.route(`**/api/v1/personal/canvases/${created.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      writes += 1
      if (writes === 1) await gate
      await route.continue()
    })
    await drawRectangle(page)
    await expect.poll(() => writes).toBe(1)
    await page.locator(`input[value="${title}"]`).fill('A canvas with a saved drawing')
    await page.getByRole('button', { name: 'Share this canvas', exact: true }).focus()
    await page.waitForTimeout(300)
    expect(writes).toBe(1)
    release()
    await expect.poll(() => statuses).toEqual([200, 200])
    const persisted = await (
      await context.request.get(`/api/v1/personal/canvases/${created.id}`)
    ).json()
    expect(persisted.title).toBe('A canvas with a saved drawing')
    expect(persisted.scene.elements).toHaveLength(1)
  } finally {
    release()
    await context.close()
  }
})
