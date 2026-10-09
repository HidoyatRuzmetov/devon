import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { setTextScale, settleCapture } from './platform-capture.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa a note title remains readable and controls fit with 200 percent text', async ({
  browser,
}, info) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/personal/notes', {
      title: `Readable private note ${randomUUID()}`,
      body: { text: 'A private note with details that remain editable at a narrow width.' },
    })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.setViewportSize({ width: 320, height: 600 })
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    await setTextScale(page, 2)
    await settleCapture(page)
    const dir = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/personal-reflow',
      process.env['QA_RUN_ID'] ?? 'default',
    )
    mkdirSync(dir, { recursive: true })
    await page.screenshot({
      path: join(dir, `${info.project.name}-note-320-text200.png`),
      fullPage: true,
    })
    const title = page
      .locator(`[data-personal-note-id="${created.id}"]`)
      .getByRole('textbox', { name: 'Note title', exact: true })
    const geometry = await title.evaluate((input) => ({
      height: input.clientHeight,
      lineHeight: parseFloat(getComputedStyle(input).lineHeight),
    }))
    expect(geometry.height).toBeGreaterThanOrEqual(geometry.lineHeight)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321)
  } finally {
    await context.close()
  }
})
