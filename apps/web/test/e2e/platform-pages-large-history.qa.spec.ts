/* eslint-disable no-restricted-syntax -- Each theme transition reloads and inspects the same page; concurrent transitions would invalidate both observations. */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa a long accepted page history stays readable and responds to keyboard selection', async ({
  browser,
}, info) => {
  test.setTimeout(90_000)
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const doc = (word: string) => ({
      type: 'doc',
      content: Array.from({ length: 3 }, () => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `${word} `.repeat(2000) }],
      })),
    })
    const response = await authedPost(context, '/api/v1/pages', {
      kind: 'note',
      title: `Large history ${randomUUID()}`,
      blocks: doc('alpha'),
    })
    expect(response.status()).toBe(201)
    const created = await response.json()
    const path = `/api/v1/pages/${created.id}`
    const updated = await authedPatch(context, path, {
      version: created.version,
      blocks: doc('bravo'),
    })
    expect(updated.status()).toBe(200)
    expect((await (await context.request.get(path)).json()).blocks).toEqual(doc('bravo'))
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/pages?page=${created.id}`)
    const history = page
      .getByRole('heading', { name: 'Version history', exact: true })
      .locator('..')
    await expect(history.getByRole('listitem')).toHaveCount(2)
    const older = history.getByRole('listitem').nth(1)
    const select = older.getByRole('button').first()
    await select.focus()
    await select.press('Enter')
    const difference = older.locator('p.whitespace-pre-wrap')
    await expect(difference).toBeVisible()
    const text = await difference.textContent()
    expect(text?.match(/alpha/g)).toHaveLength(6000)
    expect(text?.match(/bravo/g)).toHaveLength(6000)
    await select.press('Enter')
    await expect(difference).toHaveCount(0)
    await expect(select).toBeFocused()
    await select.press('Enter')
    await expect(difference).toBeVisible()
    const evidence = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/knowledge/large-history',
      process.env['QA_RUN_ID'] ?? 'default',
      info.project.name,
    )
    mkdirSync(evidence, { recursive: true })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
        key: THEME_STORAGE_KEY,
        value: theme,
      })
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(select).toBeVisible()
      await select.focus()
      await select.press('Enter')
      await expect(difference).toBeVisible()
      const accessibility = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(accessibility.violations).toEqual([])
      await page.screenshot({ path: join(evidence, `${theme}-selected.png`) })
      const addition = difference.locator('span').last()
      await addition.scrollIntoViewIfNeeded()
      await expect(addition).toBeVisible()
      await page.screenshot({ path: join(evidence, `${theme}-addition-tail.png`) })
    }
  } finally {
    await context.close()
  }
})
