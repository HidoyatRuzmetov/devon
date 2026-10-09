/* eslint-disable no-restricted-syntax -- Local settings journeys intentionally keep real route, locale and layout transitions sequential. */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser } from '@playwright/test'
import type { Locale } from '@devon/i18n'
import {
  authedPatch,
  examplePassword,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'
import { visualLabel } from './visual-label.js'

const evidence = resolve(import.meta.dirname, '../../../../artifacts/qa/2026-10/settings/nested')
async function fixture(browser: Browser) {
  const context = await newFlowContext(browser)
  const external: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== FLOW_WEB_BASE_URL) {
      external.push(url.hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await registerUser(context, {
    login: uniqueLogin('settings.nested'),
    password: examplePassword(),
    givenName: 'Synthetic',
    familyName: 'Settings',
  })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await context.newPage()
  return {
    context,
    page,
    close: async () => {
      await context.close()
      expect(external).toEqual([])
    },
  }
}

test('notification preferences save by keyboard and all three digest modes persist', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/account/notifications')
    await f.page.setViewportSize({ width: 320, height: 800 })
    await waitForLoadedRoute(f.page, '/account/notifications')
    await settleCapture(f.page)
    const assignment = f.page.getByRole('switch', { name: 'Assignment via Telegram', exact: true })
    const matrix = f.page.getByRole('region', { name: 'By type and channel', exact: true })
    const visibleControl = await assignment.evaluate((element) => {
      const control = element.getBoundingClientRect()
      const region = element.closest('[role="region"]')!.getBoundingClientRect()
      return control.left >= region.left && control.right <= region.right
    })
    expect(visibleControl, 'The Telegram control is visible without horizontal scrolling').toBe(
      true,
    )
    const initial = await assignment.getAttribute('aria-checked')
    await f.page.getByRole('link', { name: 'Notification preferences', exact: true }).focus()
    await f.page.keyboard.press('Tab')
    await expect(matrix).toBeFocused()
    await f.page.keyboard.press('Tab')
    await expect(assignment).toBeFocused()
    const saved = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/prefs'),
    )
    await f.page.keyboard.press('Space')
    expect((await saved).status()).toBe(200)
    await expect(assignment).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
    const digest = f.page.getByRole('combobox', { name: 'Telegram', exact: true })
    for (const mode of ['weekly', 'off', 'daily']) {
      const receipt = f.page.waitForResponse(
        (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/prefs'),
      )
      await digest.selectOption(mode)
      expect((await receipt).status()).toBe(200)
      await expect(digest).toBeEnabled()
      const actual = await f.context.request.get('/api/v1/notifications/prefs')
      expect(actual.status()).toBe(200)
      const row = (await actual.json()).items.find(
        (item: { reason: string; channel: string }) =>
          item.reason === 'digest' && item.channel === 'telegram',
      )
      expect({ enabled: row.enabled, mode: row.digestMode }).toEqual({
        enabled: mode !== 'off',
        mode,
      })
    }
    await f.page.reload()
    await expect(digest).toHaveValue('daily')
    await expect(assignment).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
    expect(await f.page.locator('th').getByText('Email', { exact: true }).count()).toBe(0)
    await expect(f.page.getByText('In-app · Always on', { exact: true })).toBeVisible()
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    )
  } finally {
    await f.close()
  }
})

test('a too-short quiet window explains the refusal, retains its draft and retries successfully', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const before = await (await f.context.request.get('/api/v1/notifications/quiet-hours')).json()
    await f.page.goto('/account/notifications')
    await f.page.getByLabel('Starts', { exact: true }).fill('22:00')
    await f.page.getByLabel('Ends', { exact: true }).fill('06:00')
    const refused = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/quiet-hours'),
    )
    await f.page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await refused).status()).toBe(422)
    await expect(f.page.getByRole('alert')).toHaveText(
      "This range must be at least as quiet as your department's default.",
    )
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('22:00')
    await expect(f.page.getByLabel('Ends', { exact: true })).toHaveValue('06:00')
    expect(await (await f.context.request.get('/api/v1/notifications/quiet-hours')).json()).toEqual(
      before,
    )
    await f.page.getByLabel('Starts', { exact: true }).fill('19:00')
    await f.page.getByLabel('Ends', { exact: true }).fill('09:00')
    const saved = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/quiet-hours'),
    )
    await f.page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(f.page.getByRole('alert')).toHaveCount(0)
    await f.page.reload()
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('19:00')
    await expect(f.page.getByLabel('Ends', { exact: true })).toHaveValue('09:00')
  } finally {
    await f.close()
  }
})

test('notification and Telegram read failures retry actual data without enabling an unconfigured bot', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.route('**/api/v1/notifications/prefs', (route) => route.abort('connectionfailed'))
    await f.page.goto('/account/notifications')
    const retry = f.page.getByRole('button', { name: 'Try again', exact: true })
    await expect(retry).toBeVisible()
    await f.page.unroute('**/api/v1/notifications/prefs')
    const read = f.page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith('/prefs'),
    )
    await retry.click()
    expect((await read).status()).toBe(200)
    await expect(
      f.page.getByRole('switch', { name: 'Assignment via Telegram', exact: true }),
    ).toBeVisible()
    await f.page.route('**/api/v1/telegram/status', (route) => route.abort('connectionfailed'))
    await f.page.getByRole('link', { name: 'Telegram', exact: true }).click()
    await expect(retry).toBeVisible()
    await f.page.unroute('**/api/v1/telegram/status')
    const status = f.page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/telegram/status'),
    )
    await retry.click()
    const response = await status
    expect(response.status()).toBe(200)
    expect((await response.json()).configured).toBe(false)
    await expect(f.page.getByText('Telegram is not connected yet', { exact: true })).toBeVisible()
    expect(
      await f.page.getByRole('button', { name: 'Get a connection code', exact: true }).count(),
    ).toBe(0)
  } finally {
    await f.close()
  }
})

for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`settings rendered controls ${locale} ${theme} narrow and enlarged`, async ({
      browser,
    }, info) => {
      const f = await fixture(browser)
      const errors: string[] = []
      f.page.on('pageerror', (error) => errors.push(error.message))
      const label = (module: string, key: string) => visualLabel(module, locale as Locale, key)
      try {
        await f.page.goto('/account')
        const appearance = f.page.locator('#section-appearance')
        const language = appearance.getByRole('combobox', { name: 'Language', exact: true })
        if (locale !== 'en') {
          const saved = f.page.waitForResponse(
            (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === '/api/v1/me',
          )
          await language.selectOption(locale)
          expect((await saved).status()).toBe(200)
        }
        await appearance
          .getByRole('combobox', {
            name: label('accounts', 'accounts.settings.theme'),
            exact: true,
          })
          .selectOption(theme)
        await expect(f.page.locator('html')).toHaveAttribute('data-theme', theme)
        await f.page.reload()
        await expect(
          appearance.getByRole('combobox', {
            name: label('accounts', 'accounts.register.locale'),
            exact: true,
          }),
        ).toHaveValue(locale)
        await expect(f.page.locator('html')).toHaveAttribute('data-theme', theme)
        mkdirSync(evidence, { recursive: true })
        for (const layout of [
          { width: 320, height: 800, scale: 1 },
          { width: 768, height: 384, scale: 2 },
        ]) {
          await f.page.setViewportSize({ width: layout.width, height: layout.height })
          for (const path of ['/account', '/account/notifications', '/account/telegram']) {
            if (new URL(f.page.url()).pathname !== path)
              await f.page
                .getByRole('navigation', {
                  name: label('accounts', 'accounts.settings.subnavAria'),
                  exact: true,
                })
                .getByRole('link', {
                  name:
                    path === '/account'
                      ? label('accounts', 'accounts.settings.title')
                      : path === '/account/notifications'
                        ? label('inbox', 'inbox.preferences.title')
                        : label('telegram', 'telegram.title'),
                  exact: true,
                })
                .click()
            await waitForLoadedRoute(f.page, path)
            await setTextScale(f.page, layout.scale)
            await settleCapture(f.page)
            expect(
              await f.page.evaluate(() => document.documentElement.scrollWidth),
              `${path} ${locale} ${theme} at ${layout.width}/${layout.scale}`,
            ).toBeLessThanOrEqual(layout.width)
            const name = `${info.project.name}-${locale}-${theme}-${layout.width}-${layout.scale}-${path.split('/').filter(Boolean).join('-')}`
            await f.page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true })
            if (path === '/account') {
              await appearance.screenshot({ path: resolve(evidence, `${name}-appearance.png`) })
              const selectedLabels = await appearance
                .getByRole('combobox')
                .evaluateAll((elements) =>
                  elements.map((element) => {
                    const select = element as HTMLSelectElement
                    const style = getComputedStyle(select)
                    const context = document.createElement('canvas').getContext('2d')!
                    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
                    return {
                      selected: select.selectedOptions[0]?.textContent ?? '',
                      width: context.measureText(select.selectedOptions[0]?.textContent ?? '')
                        .width,
                      available:
                        select.clientWidth -
                        parseFloat(style.paddingLeft) -
                        parseFloat(style.paddingRight) -
                        24,
                    }
                  }),
                )
              for (const selected of selectedLabels)
                expect(
                  selected.width,
                  `${locale} selected ${selected.selected} has room beside its native arrow`,
                ).toBeLessThanOrEqual(selected.available)
            }
            if (path === '/account/notifications') {
              expect(await f.page.locator('th').getByText('Email', { exact: true }).count()).toBe(0)
              const visibleControls = await f.page.getByRole('switch').evaluateAll((elements) =>
                elements
                  .filter((element) => element.closest('table'))
                  .map((element) => {
                    const control = element.getBoundingClientRect()
                    const region = element.closest('[role="region"]')!.getBoundingClientRect()
                    return {
                      label: element.getAttribute('aria-label'),
                      fits: control.left >= region.left && control.right <= region.right,
                    }
                  }),
              )
              expect(visibleControls).toHaveLength(10)
              for (const control of visibleControls)
                expect(
                  control.fits,
                  `${locale} ${control.label} is visible without scrolling`,
                ).toBe(true)
              const reasonLabels = await f.page
                .locator('tbody td:first-child .truncate')
                .evaluateAll((elements) =>
                  elements.map((element) => ({
                    label: element.textContent,
                    fits:
                      element.scrollWidth <= element.clientWidth &&
                      element.scrollHeight <= element.clientHeight,
                  })),
                )
              expect(reasonLabels).toHaveLength(10)
              for (const reason of reasonLabels)
                expect(reason.fits, `${locale} ${reason.label} isn't clipped`).toBe(true)
            }
            if (path === '/account/telegram')
              await expect(
                f.page.getByText(label('telegram', 'telegram.notConfigured.title'), {
                  exact: true,
                }),
              ).toBeVisible()
          }
        }
        expect(errors).toEqual([])
      } finally {
        await f.close()
      }
    })
  }
}
