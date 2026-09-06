// spec.md §12 A/C/D/E/F -- the baseline grid, locale sweep, shell-component gallery, header proof and
// Storybook shots. `tests/states.spec.ts` covers §12.B (forced states). Every combination that needs a
// live `apps/api` and/or a `super_admin` session skips with a specific reason when `global-setup.ts`
// could not produce one, rather than failing -- see `fixtures.ts`'s header comment.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, BrowserContext } from '@playwright/test'
import {
  backendReady,
  expect,
  storybookReady,
  superAdminSessionAvailable,
  test,
} from '../fixtures.js'
import { loadRoutes, type RouteEntry } from '../lib/routes.js'
import {
  screenshotName,
  type ScreenshotLocaleShort,
  type ScreenshotTheme,
} from '../lib/screenshot-naming.js'
import { recordBaselineRoute } from '../lib/manifest.js'
import { QA_VISUAL_DIR, STORYBOOK_BASE_URL, TMP_DIR } from '../lib/env.js'
import { presetLocale, type TestLocale } from '../lib/locale.js'
import { message } from '../lib/messages.js'
import { DEFAULT_CREDENTIALS } from '../lib/backend.js'

const routes = loadRoutes()

const WIDTHS: readonly { width: number; height: number }[] = [
  { width: 1440, height: 900 },
  { width: 1024, height: 800 },
  { width: 390, height: 844 },
]
const THEMES: readonly ScreenshotTheme[] = ['light', 'dark']
const LOCALES: readonly { locale: TestLocale; short: ScreenshotLocaleShort }[] = [
  { locale: 'uz-Latn', short: 'uz' },
  { locale: 'ru', short: 'ru' },
]

const SUPERADMIN_STATE_PATH = join(TMP_DIR, 'superadmin-storage-state.json')

async function openContext(
  browser: Browser,
  opts: { width: number; height: number; theme?: ScreenshotTheme; authed?: boolean },
): Promise<BrowserContext> {
  // Built up rather than passed as one literal with possibly-`undefined` values: Playwright's
  // `BrowserContextOptions.colorScheme`/`storageState` are optional-but-not-`| undefined`, and
  // `tsconfig.base.json`'s `exactOptionalPropertyTypes` rejects assigning `undefined` to those.
  const contextOptions: Parameters<Browser['newContext']>[0] = {
    viewport: { width: opts.width, height: opts.height },
  }
  if (opts.theme) contextOptions.colorScheme = opts.theme
  if (opts.authed) contextOptions.storageState = SUPERADMIN_STATE_PATH
  return browser.newContext(contextOptions)
}

function needsSuperAdmin(route: RouteEntry): boolean {
  return route.chrome === 'app'
}

// ---------------------------------------------------------------------------------------------
// A. Baseline grid -- 5 routes x {1440,1024,390} x {light,dark} x {uz-Latn,ru} = 60 shots.
// ---------------------------------------------------------------------------------------------
for (const route of routes) {
  for (const size of WIDTHS) {
    for (const theme of THEMES) {
      for (const { locale, short } of LOCALES) {
        test(`baseline ${route.path} @ ${size.width} ${theme} ${locale}`, async ({ browser }) => {
          test.skip(
            needsSuperAdmin(route) && !(backendReady() && superAdminSessionAvailable()),
            'needs apps/api + a super_admin session (see global-setup.ts log)',
          )
          await mkdir(QA_VISUAL_DIR, { recursive: true })
          const context = await openContext(browser, {
            width: size.width,
            height: size.height,
            theme,
            authed: needsSuperAdmin(route),
          })
          const page = await context.newPage()
          await presetLocale(page, locale)
          await page.goto(route.path)
          if (route.heading) {
            await expect(page.getByText(message(locale, route.heading))).toBeVisible({
              timeout: 15_000,
            })
          } else {
            await page.waitForLoadState('domcontentloaded')
          }
          const filename = screenshotName(route.slug, size.width, theme, short)
          await page.screenshot({ path: join(QA_VISUAL_DIR, filename), fullPage: true })
          await recordBaselineRoute(route.slug)
          await context.close()
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// C. Locale sweep -- `/` at {1440,390} x light x {uz-Latn,uz-Cyrl,ru,en} = 8, plus one
// `root__1440__light__ru__after-reload.png` after a full reload + re-login on the same account.
// ---------------------------------------------------------------------------------------------
const SWEEP_LOCALES: readonly { locale: TestLocale; short: string }[] = [
  { locale: 'uz-Latn', short: 'uzlatn' },
  { locale: 'uz-Cyrl', short: 'uzcyrl' },
  { locale: 'ru', short: 'ru' },
  { locale: 'en', short: 'en' },
]

for (const width of [1440, 390]) {
  for (const { locale, short } of SWEEP_LOCALES) {
    test(`locale sweep / @ ${width} light ${locale}`, async ({ browser }) => {
      test.skip(
        !(backendReady() && superAdminSessionAvailable()),
        'needs apps/api + a super_admin session',
      )
      await mkdir(QA_VISUAL_DIR, { recursive: true })
      const context = await openContext(browser, {
        width,
        height: width === 390 ? 844 : 900,
        theme: 'light',
        authed: true,
      })
      const page = await context.newPage()
      await presetLocale(page, locale)
      await page.goto('/')
      await expect(page.getByText(message(locale, 'home.eyebrow'))).toBeVisible({ timeout: 15_000 })
      const filename = `root__${width}__light__${short}.png`
      await page.screenshot({ path: join(QA_VISUAL_DIR, filename), fullPage: true })
      await context.close()
    })
  }
}

test('locale sweep / @ 1440 light ru, after a full reload and a new session on the same account', async ({
  browser,
}) => {
  test.skip(
    !(backendReady() && superAdminSessionAvailable()),
    'needs apps/api + a super_admin session',
  )
  await mkdir(QA_VISUAL_DIR, { recursive: true })
  // AC-4's disproof: "a locale that resets to default after reload, or ... a new session on the same
  // account." A fresh context reusing the same storageState is the "new session" half; `page.reload()`
  // (not just a second `goto`) is the "full page reload" half.
  const context = await openContext(browser, {
    width: 1440,
    height: 900,
    theme: 'light',
    authed: true,
  })
  const page = await context.newPage()
  await presetLocale(page, 'ru')
  await page.goto('/')
  await page.reload()
  await expect(page.getByText(message('ru', 'home.eyebrow'))).toBeVisible({ timeout: 15_000 })
  await page.screenshot({
    path: join(QA_VISUAL_DIR, 'root__1440__light__ru__after-reload.png'),
    fullPage: true,
  })
  await context.close()
})

// ---------------------------------------------------------------------------------------------
// D. Shell components -- search overlay, locale menu, avatar menu, shortcut overlay, at
// {1440 light uz-Latn, 390 light ru}.
// ---------------------------------------------------------------------------------------------
const SHELL_COMPONENT_CONFIGS = [
  {
    width: 1440,
    height: 900,
    theme: 'light' as const,
    locale: 'uz-Latn' as const,
    short: 'uz' as const,
  },
  { width: 390, height: 844, theme: 'light' as const, locale: 'ru' as const, short: 'ru' as const },
]

async function openShellPage(browser: Browser, config: (typeof SHELL_COMPONENT_CONFIGS)[number]) {
  const context = await openContext(browser, {
    width: config.width,
    height: config.height,
    theme: config.theme,
    authed: true,
  })
  const page = await context.newPage()
  await presetLocale(page, config.locale)
  await page.goto('/')
  await expect(page.getByText(message(config.locale, 'home.eyebrow'))).toBeVisible({
    timeout: 15_000,
  })
  return { context, page }
}

for (const config of SHELL_COMPONENT_CONFIGS) {
  test(`shell component: search overlay @ ${config.width} ${config.locale}`, async ({
    browser,
  }) => {
    test.skip(
      !(backendReady() && superAdminSessionAvailable()),
      'needs apps/api + a super_admin session',
    )
    await mkdir(QA_VISUAL_DIR, { recursive: true })
    const { context, page } = await openShellPage(browser, config)
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder(message(config.locale, 'cmd.placeholder'))).toBeVisible()
    const filename = screenshotName(
      'shell_search_overlay',
      config.width,
      config.theme,
      config.short,
    )
    await page.screenshot({ path: join(QA_VISUAL_DIR, filename) })
    await context.close()
  })

  test(`shell component: locale menu @ ${config.width} ${config.locale}`, async ({ browser }) => {
    test.skip(
      !(backendReady() && superAdminSessionAvailable()),
      'needs apps/api + a super_admin session',
    )
    await mkdir(QA_VISUAL_DIR, { recursive: true })
    const { context, page } = await openShellPage(browser, config)
    await page.getByRole('button', { name: message(config.locale, 'shell.locale.aria') }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    const filename = screenshotName('shell_locale_menu', config.width, config.theme, config.short)
    await page.screenshot({ path: join(QA_VISUAL_DIR, filename) })
    await context.close()
  })

  test(`shell component: avatar menu @ ${config.width} ${config.locale}`, async ({ browser }) => {
    test.skip(
      !(backendReady() && superAdminSessionAvailable()),
      'needs apps/api + a super_admin session',
    )
    await mkdir(QA_VISUAL_DIR, { recursive: true })
    const { context, page } = await openShellPage(browser, config)
    // The avatar trigger's accessible name is the signed-in user's full name
    // (`packages/ui/src/shell/avatar-menu.tsx`'s `avatarLabel`), not a fixed i18n key --
    // `lib/backend.ts`'s `DEFAULT_CREDENTIALS` is who `global-setup.ts` bootstraps.
    await page
      .getByRole('button', {
        name: `${DEFAULT_CREDENTIALS.givenName} ${DEFAULT_CREDENTIALS.familyName}`,
      })
      .click()
    await expect(page.getByRole('menu')).toBeVisible()
    const filename = screenshotName('shell_avatar_menu', config.width, config.theme, config.short)
    await page.screenshot({ path: join(QA_VISUAL_DIR, filename) })
    await context.close()
  })

  test(`shell component: shortcut overlay @ ${config.width} ${config.locale}`, async ({
    browser,
  }) => {
    test.skip(
      !(backendReady() && superAdminSessionAvailable()),
      'needs apps/api + a super_admin session',
    )
    await mkdir(QA_VISUAL_DIR, { recursive: true })
    const { context, page } = await openShellPage(browser, config)
    await page.keyboard.press('?')
    await expect(page.getByText(message(config.locale, 'shell.shortcuts.title'))).toBeVisible()
    const filename = screenshotName(
      'shell_shortcut_overlay',
      config.width,
      config.theme,
      config.short,
    )
    await page.screenshot({ path: join(QA_VISUAL_DIR, filename) })
    await context.close()
  })
}

// ---------------------------------------------------------------------------------------------
// E. Header proof -- AC-1/AC-2: the demo chip present on a demo boot, absent on a non-demo boot.
// This suite's own bootstrap (`global-setup.ts`, `lib/backend.ts`) never sets `DEVON_DEMO=1` --
// it always produces a *non*-demo instance, so only `demo-off` is reachable here; `demo-on` needs
// the demo seed (`@devon/db seed:demo`, a separate, later-landing work item) and is left to
// `wp-qa-visual` to capture once that exists, per spec.md §12.E's own two-shot pairing.
// ---------------------------------------------------------------------------------------------
test('header proof: demo chip absent on a non-demo boot', async ({ browser }) => {
  test.skip(
    !(backendReady() && superAdminSessionAvailable()),
    'needs apps/api + a super_admin session',
  )
  await mkdir(QA_VISUAL_DIR, { recursive: true })
  const context = await openContext(browser, {
    width: 1440,
    height: 900,
    theme: 'light',
    authed: true,
  })
  const page = await context.newPage()
  await presetLocale(page, 'uz-Latn')
  await page.goto('/')
  await expect(page.getByText(message('uz-Latn', 'home.eyebrow'))).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(message('uz-Latn', 'shell.demo.chip.label'))).toHaveCount(0)
  await page.screenshot({
    path: join(QA_VISUAL_DIR, 'header__1440__light__uz__demo-off.png'),
    clip: { x: 0, y: 0, width: 1440, height: 56 },
  })
  await context.close()
})

// ---------------------------------------------------------------------------------------------
// F. Storybook -- `Foundations/Glyphs` and `Foundations/Formatting` (packages/ui, read-only here).
// ---------------------------------------------------------------------------------------------
for (const theme of ['light', 'dark'] as const) {
  test(`storybook glyphs page (${theme})`, async ({ browser }) => {
    test.skip(!storybookReady(), 'Storybook did not come up this run (see global-setup.ts log)')
    await mkdir(QA_VISUAL_DIR, { recursive: true })
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1400 },
      colorScheme: theme,
    })
    const page = await context.newPage()
    await page.goto(
      `${STORYBOOK_BASE_URL}/iframe.html?id=foundations-glyphs--default&viewMode=story`,
    )
    await expect(page.locator('[data-font-loaded="true"]')).toBeVisible({ timeout: 20_000 })
    await page.screenshot({
      path: join(QA_VISUAL_DIR, `storybook-glyphs__${theme}.png`),
      fullPage: true,
    })
    await context.close()
  })
}

for (const short of ['uz', 'ru'] as const) {
  test(`storybook formatting page (${short})`, async ({ browser }) => {
    test.skip(!storybookReady(), 'Storybook did not come up this run (see global-setup.ts log)')
    await mkdir(QA_VISUAL_DIR, { recursive: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } })
    const page = await context.newPage()
    await page.goto(
      `${STORYBOOK_BASE_URL}/iframe.html?id=foundations-formatting--default&viewMode=story`,
    )
    await page.waitForLoadState('domcontentloaded')
    // The page renders every locale's section on one screen (`formatting.stories.tsx`) -- both
    // filenames spec.md §12.F asks for are the same evidence, captured twice for the naming contract.
    await page.screenshot({
      path: join(QA_VISUAL_DIR, `storybook-formatting__${short}.png`),
      fullPage: true,
    })
    await context.close()
  })
}
