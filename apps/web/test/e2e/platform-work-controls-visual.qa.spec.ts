/* eslint-disable no-restricted-syntax -- Native viewport and disclosure transitions are sequential. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'

const examplePassword = 'Ishonchli#2026'
function label(locale: string, key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing ${locale}:${key}`)
  return value
}
async function openSection(page: Page, id: string) {
  const toggle = page.locator(`button[aria-controls="${id}"]`)
  await toggle.focus()
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.locator(`[id="${id}"]`)
  await expect(panel).toBeVisible()
  return panel
}
async function capture(
  page: Page,
  panel: Locator,
  state: string,
  metadata: Record<string, unknown>,
) {
  await settleCapture(page, false)
  const screenshot = test.info().outputPath(`${state}.png`)
  await page.screenshot({ path: screenshot })
  const overflow = await panel.evaluate((element) => {
    const toggle = document.querySelector(`button[aria-controls="${element.id}"]`)
    return [
      ...element.querySelectorAll('*'),
      ...(toggle ? [toggle, ...toggle.querySelectorAll('*')] : []),
    ]
      .filter((node) => {
        const bounds = node.getBoundingClientRect()
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          (bounds.right > innerWidth + 1 || bounds.left < -1)
        )
      })
      .map((node) => ({
        tag: node.tagName,
        text: node.textContent?.slice(0, 80),
        className: node.getAttribute('class'),
        right: node.getBoundingClientRect().right,
      }))
  })
  appendFileSync(
    test.info().outputPath('captures.jsonl'),
    JSON.stringify({ ...metadata, state, screenshot, overflow, pixelInspected: false }) + '\n',
  )
  expect(overflow).toEqual([])
}
for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
  for (const theme of ['light', 'dark']) {
    test(`@qa nested work controls reflow ${locale} ${theme}`, async ({ browser }) => {
      test.setTimeout(240_000)
      const context = await newFlowContext(browser)
      try {
        await login(context, { login: 'demo.boshliq', password: examplePassword })
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        await context.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        const title = `QA work controls ${randomUUID().slice(0, 8)}`
        const create = await authedPost(context, '/api/v1/cards', {
          title,
          kind: 'task',
          dueAt: '2026-11-30T12:00:00Z',
        })
        expect(create.status()).toBe(201)
        const { id } = (await create.json()) as { id: string }
        const blocker = await authedPost(context, '/api/v1/cards', {
          title: 'Подробное наименование задания для согласования отчёта и проверки документов',
          kind: 'task',
          dueAt: '2027-02-12T12:00:00Z',
        })
        expect(blocker.status()).toBe(201)
        const blockerId = ((await blocker.json()) as { id: string }).id
        expect(
          (
            await authedPost(context, `/api/v1/cards/${id}/dependencies`, {
              blockedByCardId: blockerId,
            })
          ).status(),
        ).toBe(201)
        expect(
          (
            await authedPost(context, `/api/v1/cards/${id}/reminders`, {
              remindAt: '2027-02-12T12:00:00Z',
              note: 'НапоминаниеСПодробнымиИнструкциямиБезПробелов'.repeat(4),
            })
          ).status(),
        ).toBe(201)
        expect(
          (
            await authedPatch(context, `/api/v1/cards/${id}`, {
              recurrence: {
                freq: 'monthly',
                interval: 2,
                mode: 'schedule',
                dayOfMonth: 31,
                count: 3,
                until: '2027-12-31',
              },
            })
          ).status(),
        ).toBe(200)
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        for (const environment of [
          { width: 1440, height: 900, scale: 1 },
          { width: 768, height: 600, scale: 2 },
          { width: 390, height: 600, scale: 2 },
          { width: 320, height: 600, scale: 2 },
          { width: 360, height: 225, scale: 1 },
        ]) {
          await page.setViewportSize({ width: environment.width, height: environment.height })
          await page.goto(`/work?card=${id}`)
          await waitForLoadedRoute(page, '/work')
          await setTextScale(page, environment.scale)
          const dialog = page.getByRole('dialog')
          await expect(
            dialog.getByRole('textbox', { name: label(locale, 'work.field.title'), exact: true }),
          ).toHaveValue(title)
          const panels = [
            { key: 'deps', last: 'work.dependencies.add' },
            { key: 'reminders', last: 'work.reminders.delete' },
            { key: 'repeat', last: 'work.recurrence.stop' },
          ]
          for (const entry of panels) {
            const panel = await openSection(page, `card-${entry.key}-${id}`)
            const last = panel.getByRole('button', { name: label(locale, entry.last), exact: true })
            await settleCapture(page, false)
            // Motion's measured-height disclosure animation runs outside main and may not appear
            // in getAnimations(). Wait for this actual panel and its staggered rows before focus.
            await expect
              .poll(
                () =>
                  panel.evaluate(
                    (element) =>
                      element.clientHeight >= element.scrollHeight - 1 &&
                      [...element.querySelectorAll('[data-devon-entrance]')].every(
                        (row) => Number(getComputedStyle(row).opacity) >= 0.99,
                      ),
                  ),
                {
                  message:
                    'disclosure reached full natural height and readable rows before native focus',
                },
              )
              .toBe(true)
            if (environment.width === 320) {
              await page.locator(`button[aria-controls="card-${entry.key}-${id}"]`).focus()
              await capture(page, panel, `${entry.key}-heading-320-text200`, {
                locale,
                theme,
                ...environment,
              })
            }
            await last.focus()
            await expect(last).toBeFocused()
            const bounds = await last.boundingBox()
            expect(bounds!.y).toBeGreaterThanOrEqual(0)
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(environment.height + 1)
            await capture(
              page,
              panel,
              `${entry.key}-${environment.width}-${environment.height}-text${environment.scale * 100}`,
              { locale, theme, ...environment },
            )
            const axe = await new AxeBuilder({ page })
              .include(`[id="card-${entry.key}-${id}"]`)
              .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
              .analyze()
            expect(axe.violations).toEqual([])
          }
          await page.keyboard.press('Escape')
          await expect(dialog).not.toBeVisible()
          const tile = page.locator(`[data-dnd-card="${id}"]`)
          await tile.getByRole('checkbox').check()
          const toolbar = page.getByRole('toolbar', {
            name: label(locale, 'work.bulk.toolbarLabel'),
            exact: true,
          })
          await expect(toolbar).toBeVisible()
          if (environment.width < 768)
            await toolbar
              .getByRole('button', { name: label(locale, 'cmd.group.actions'), exact: true })
              .click()
          const priority = toolbar.getByRole('button', {
            name: label(locale, 'work.bulk.priority'),
            exact: true,
          })
          await priority.focus()
          await capture(
            page,
            toolbar,
            `bulk-${environment.width}-${environment.height}-text${environment.scale * 100}`,
            { locale, theme, ...environment },
          )
          await priority.press('Enter')
          await expect(
            page.getByRole('menuitem', { name: label(locale, 'work.priority.high'), exact: true }),
          ).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(priority).toBeFocused()
          await toolbar
            .getByRole('button', { name: label(locale, 'work.bulk.clear'), exact: true })
            .click()
          await expect(toolbar).not.toBeVisible()
        }
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
