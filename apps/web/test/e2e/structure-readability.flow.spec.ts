import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { settleCapture } from './platform-capture.js'
import { visualLabel } from './visual-label.js'

test('@flow org chart keyboard, localized controls, enlarged text and complete image export', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('org.readability.head'),
      headPassword: examplePassword(),
      departmentName: 'Digital services and transparent public administration',
    })
    expect(
      (
        await authedPatch(head, '/api/v1/accounts/profile', {
          givenName: 'Mahmudjon Abdukarimovich',
          familyName: 'Abdurahmonov',
        })
      ).status(),
    ).toBe(200)
    const firstResponse = await authedPost(
      head,
      `/api/v1/departments/${department.departmentId}/units`,
      { name: 'Service delivery and data governance' },
    )
    expect(firstResponse.status()).toBe(201)
    const first = (await firstResponse.json()) as { id: string }
    expect(
      (
        await authedPost(head, `/api/v1/departments/${department.departmentId}/units`, {
          name: 'Support team',
          parentUnitId: first.id,
        })
      ).status(),
    ).toBe(201)
    expect(
      (
        await authedPost(head, `/api/v1/departments/${department.departmentId}/units`, {
          name: 'Quality assurance',
        })
      ).status(),
    ).toBe(201)
    const page = await head.newPage()
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
      'nested',
    )
    await mkdir(root, { recursive: true })
    const locales = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const
    const themes = ['light', 'dark']
    const records: unknown[] = []
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const locale = locales[localeIndex]!
      await authedPatch(head, '/api/v1/me', { locale })
      const label = (key: string) => visualLabel('structure', locale, `structure.units.${key}`)
      for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
        const theme = themes[themeIndex]!
        await page.goto('/structure')
        await page.evaluate((theme) => {
          document.documentElement.dataset['theme'] = theme
        }, theme)
        await page.getByRole('tab', { name: label('view.chart'), exact: true }).click()
        const tree = page.getByRole('tree', {
          name: 'Digital services and transparent public administration',
          exact: true,
        })
        await expect(tree.getByRole('treeitem')).toHaveCount(4)
        await expect(tree.locator('path')).toHaveCount(3)
        await page.setViewportSize({ width: 1440, height: 900 })
        const rootNode = tree.getByRole('treeitem', {
          name: 'Digital services and transparent public administration',
          exact: true,
        })
        await rootNode.focus()
        await rootNode.press('ArrowDown')
        const firstNode = tree.getByRole('treeitem', {
          name: 'Service delivery and data governance',
          exact: true,
        })
        await expect(firstNode).toBeFocused()
        await firstNode.press('ArrowRight')
        await expect(
          tree.getByRole('treeitem', { name: 'Quality assurance', exact: true }),
        ).toBeFocused()
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowDown')
        await expect(
          tree.getByRole('treeitem', { name: 'Support team', exact: true }),
        ).toBeFocused()
        await page.keyboard.press('ArrowUp')
        await expect(firstNode).toBeFocused()
        await firstNode.press('Enter')
        await expect(
          page
            .getByRole('heading', { name: 'Service delivery and data governance', exact: true })
            .first(),
        ).toBeVisible()
        await page
          .getByRole('button', { name: label('chart.closePanel'), exact: true })
          .last()
          .click()
        await expect(firstNode).toBeFocused()
        await page.setViewportSize({ width: 320, height: 900 })
        await settleCapture(page, false)
        await page.screenshot({ path: join(root, `org-${locale}-${theme}-320.png`) })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.evaluate(() => {
          const root = document.documentElement
          const style = getComputedStyle(root)
          for (const name of ['body', 'small', 'caption', 'eyebrow', 'h1', 'h2', 'h3']) {
            for (const suffix of ['', '--line-height']) {
              const token = `--text-${name}${suffix}`
              const value = Number.parseFloat(style.getPropertyValue(token))
              if (Number.isFinite(value)) root.style.setProperty(token, `${value * 2}px`)
            }
          }
        })
        await settleCapture(page, false)
        const measurement = await tree.getByRole('treeitem').evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = (node.querySelector('rect') as SVGGraphicsElement).getBBox()
            const texts = [...node.querySelectorAll('text')].map((text) => ({
              text: text.textContent,
              box: text.getBBox(),
            }))
            return {
              name: node.getAttribute('aria-label'),
              outside: texts
                .filter(
                  ({ box: text }) =>
                    text.x < box.x - 1 ||
                    text.y < box.y - 1 ||
                    text.x + text.width > box.x + box.width + 1 ||
                    text.y + text.height > box.y + box.height + 1,
                )
                .map((item) => item.text),
              overlaps: texts
                .filter((item, index) =>
                  texts
                    .slice(index + 1)
                    .some(
                      (next) =>
                        item.box.x < next.box.x + next.box.width &&
                        item.box.x + item.box.width > next.box.x &&
                        item.box.y < next.box.y + next.box.height &&
                        item.box.y + item.box.height > next.box.y,
                    ),
                )
                .map((item) => item.text),
            }
          }),
        )
        records.push({ locale, theme, measurement })
        await writeFile(join(root, 'org-text200-metrics.json'), JSON.stringify(records, null, 2))
        await page.screenshot({ path: join(root, `org-${locale}-${theme}-320-text200.png`) })
        expect(measurement.flatMap((node) => node.outside)).toEqual([])
        expect(measurement.flatMap((node) => node.overlaps)).toEqual([])
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        const downloading = page.waitForEvent('download')
        await page.getByRole('button', { name: label('chart.exportPng'), exact: true }).click()
        const download = await downloading
        const path = join(root, `org-export-${locale}-${theme}-text200.png`)
        await download.saveAs(path)
        const png = await readFile(path)
        expect(png.subarray(1, 4).toString()).toBe('PNG')
        expect(png.readUInt32BE(16)).toBeGreaterThan(500)
        expect(png.readUInt32BE(20)).toBeGreaterThan(500)
        const renderedNames = await tree.getByRole('treeitem').evaluateAll((nodes) =>
          nodes.map((node) => ({
            name: node.getAttribute('aria-label')!.replace(/\s/g, ''),
            title: node.querySelector('text')!.textContent!.replace(/\s/g, ''),
          })),
        )
        expect(renderedNames.every((node) => node.name === node.title)).toBe(true)
        expect((await rootNode.locator('text').nth(2).textContent())?.replace(/\s/g, '')).toBe(
          'MahmudjonAbdukarimovichAbdurahmonov',
        )
        await page.evaluate(() => {
          for (const name of ['body', 'small', 'caption', 'eyebrow', 'h1', 'h2', 'h3']) {
            document.documentElement.style.removeProperty(`--text-${name}`)
            document.documentElement.style.removeProperty(`--text-${name}--line-height`)
          }
        })
      }
    }
  } finally {
    await head.close()
    await admin.close()
  }
})
