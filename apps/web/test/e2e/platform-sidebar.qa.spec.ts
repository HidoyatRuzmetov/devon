/* eslint-disable no-restricted-syntax -- Native keyboard and viewport transitions are sequential. */
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'

const examplePassword = 'Ishonchli#2026'
const locales = ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const
function label(locale: string, key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing localized key ${locale}:${key}`)
  return value
}
async function sidebarGeometry(navLocator: Locator) {
  return navLocator.evaluate((nav) => {
    const inbox = nav.querySelector('a[href="/inbox"]')!
    const label = inbox.querySelector('[data-shell-label]')!
    const badge = inbox.lastElementChild!
    const range = document.createRange()
    range.selectNodeContents(label)
    const textRects = [...range.getClientRects()].map((rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    }))
    const badgeRect = badge.getBoundingClientRect()
    const overlap = textRects.some(
      (rect) =>
        rect.left < badgeRect.right &&
        rect.right > badgeRect.left &&
        rect.top < badgeRect.bottom &&
        rect.bottom > badgeRect.top,
    )
    const scroller = nav.querySelector('.devon-nav-scroller')!
    return {
      label: label.textContent,
      count: badge.textContent,
      overlap,
      textRects,
      badge: { left: badgeRect.left, right: badgeRect.right },
      navHeight: scroller.clientHeight,
      navScrollHeight: scroller.scrollHeight,
      sidebarHeight: nav.clientHeight,
      sidebarScrollHeight: nav.scrollHeight,
    }
  })
}

test('@qa sidebar collision probe', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'uz-Cyrl' })).status()).toBe(200)
    await context.addInitScript(() => localStorage.setItem('devon_theme', 'light'))
    const page = await context.newPage()
    await page.setViewportSize({ width: 768, height: 600 })
    await page.goto('/help')
    await waitForLoadedRoute(page, '/help')
    await setTextScale(page, 2)
    await settleCapture(page, false)
    for (const height of [600, 480]) {
      await page.setViewportSize({ width: 768, height })
      await settleCapture(page, false)
      const geometry = await sidebarGeometry(page.locator('aside nav'))
      const screenshot = test.info().outputPath(`sidebar-before-768-${height}-text200.png`)
      await page.screenshot({ path: screenshot })
      appendFileSync(
        test.info().outputPath('captures.jsonl'),
        JSON.stringify({
          role: 'department-head',
          locale: 'uz-Cyrl',
          theme: 'light',
          width: 768,
          height,
          scale: 2,
          screenshot,
          geometry,
          pixelInspected: false,
        }) + '\n',
      )
      expect.soft(geometry.overlap, `768x${height}: label and count do not overlap`).toBe(false)
      expect
        .soft(geometry.navHeight, `768x${height}: navigation has usable visible height`)
        .toBeGreaterThanOrEqual(88)
    }
  } finally {
    await context.close()
  }
})

async function openSidebar(page: Page, locale: string, width: number): Promise<Locator> {
  if (width >= 768) return page.locator('aside nav')
  const opener = page.getByRole('button', { name: label(locale, 'shell.menu.open'), exact: true })
  await opener.focus()
  await opener.press('Enter')
  const nav = page
    .getByRole('dialog', { name: label(locale, 'shell.menu.open'), exact: true })
    .locator('nav')
  await expect(nav).toBeVisible()
  await settleCapture(page, false)
  return nav
}
test('@qa sidebar narrow Russian overflow probe', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'ru' })).status()).toBe(200)
    const page = await context.newPage()
    await page.setViewportSize({ width: 320, height: 480 })
    await page.goto('/help')
    await waitForLoadedRoute(page, '/help')
    await setTextScale(page, 2)
    await openSidebar(page, 'ru', 320)
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      text: [...document.querySelectorAll('body *')].flatMap((node) =>
        [...node.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .flatMap((child) => {
            const range = document.createRange()
            range.selectNode(child)
            return [...range.getClientRects()]
              .filter((rect) => rect.right > innerWidth + 1 || rect.left < -1)
              .map((rect) => ({
                text: child.textContent?.slice(0, 120),
                tag: node.tagName,
                className: node.getAttribute('class'),
                right: rect.right,
              }))
          }),
      ),
      nodes: [...document.querySelectorAll('body *')]
        .filter((node) => {
          const rect = node.getBoundingClientRect()
          return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1)
        })
        .map((node) => ({
          tag: node.tagName,
          text: node.textContent?.slice(0, 120),
          className: node.getAttribute('class'),
          right: node.getBoundingClientRect().right,
        })),
    }))
    appendFileSync(test.info().outputPath('overflow.jsonl'), JSON.stringify(overflow) + '\n')
    await page.screenshot({ path: test.info().outputPath('sidebar-russian-320-text200.png') })
    expect(overflow.documentWidth).toBeLessThanOrEqual(321)
  } finally {
    await context.close()
  }
})
async function visibleFocus(locator: Locator, page: Page) {
  await expect(locator).toBeFocused()
  const bounds = await locator.boundingBox()
  expect(bounds).not.toBeNull()
  const viewport = page.viewportSize()!
  expect(bounds!.y).toBeGreaterThanOrEqual(-1)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
}
test('@qa sidebar native link focus diagnostic', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/help')
    await waitForLoadedRoute(page, '/help')
    const nav = page.locator('aside nav')
    const knowledge = nav.locator('button[aria-controls="devon-nav-group-knowledge"]')
    await knowledge.focus()
    if ((await knowledge.getAttribute('aria-expanded')) === 'false') await knowledge.press('Enter')
    await expect(knowledge).toHaveAttribute('aria-expanded', 'true')
    const pages = nav.locator('a[href="/pages"]')
    await expect(pages).toBeVisible()
    const structure = await pages.evaluate((element) => ({
      outerHTML: element.outerHTML,
      tabIndex: element.tabIndex,
      ancestors: [
        element,
        ...(function* () {
          let ancestor = element.parentElement
          while (ancestor) {
            yield ancestor
            ancestor = ancestor.parentElement
          }
        })(),
      ].map((node) => ({
        tag: node.tagName,
        inert: node instanceof HTMLElement && node.inert,
        hidden: node instanceof HTMLElement && node.hidden,
        ariaHidden: node.getAttribute('aria-hidden'),
        display: getComputedStyle(node).display,
        visibility: getComputedStyle(node).visibility,
      })),
    }))
    expect(structure.tabIndex).toBe(0)
    expect(
      structure.ancestors.every(
        (node) =>
          !node.inert &&
          !node.hidden &&
          node.ariaHidden !== 'true' &&
          node.display !== 'none' &&
          node.visibility !== 'hidden',
      ),
    ).toBe(true)
    const sequence: unknown[] = []
    for (const key of ['Tab', 'Alt+Tab']) {
      await knowledge.focus()
      for (let index = 0; index < 5; index += 1) {
        await page.keyboard.press(key)
        sequence.push(
          await page.evaluate(
            ({ key, index }) => ({
              key,
              index,
              active: document.activeElement?.outerHTML,
            }),
            { key, index },
          ),
        )
      }
    }
    await pages.focus()
    await visibleFocus(pages, page)
    await page.screenshot({ path: test.info().outputPath('sidebar-pages-focus.png') })
    await pages.press('Enter')
    await waitForLoadedRoute(page, '/pages')
    await expect(nav.locator('a[href="/pages"]')).toHaveAttribute('aria-current', 'page')
    const diagnostic = await context.newPage()
    await diagnostic.setContent(
      '<button id="start">Start</button><a href="#a" id="ordinary">Ordinary link</a><a href="#b" id="explicit" tabindex="0">Explicit tab index link</a><button id="end">End</button>',
    )
    const native: unknown[] = []
    for (const key of ['Tab', 'Alt+Tab']) {
      await diagnostic.locator('#start').focus()
      for (let index = 0; index < 4; index += 1) {
        await diagnostic.keyboard.press(key)
        native.push(
          await diagnostic.evaluate(
            ({ key, index }) => ({
              key,
              index,
              active: document.activeElement?.id,
              tag: document.activeElement?.tagName,
            }),
            { key, index },
          ),
        )
      }
    }
    appendFileSync(
      test.info().outputPath('focus-diagnostic.json'),
      JSON.stringify({ browser: test.info().project.name, structure, sequence, native }, null, 2),
    )
  } finally {
    await context.close()
  }
})
async function capture(page: Page, nav: Locator, name: string, metadata: Record<string, unknown>) {
  await settleCapture(page, false)
  const screenshot = test.info().outputPath(`${name}.png`)
  const bounds = await nav.boundingBox()
  expect(bounds).not.toBeNull()
  const viewport = page.viewportSize()!
  await page.screenshot({
    path: screenshot,
    clip: {
      x: Math.max(0, bounds!.x),
      y: 0,
      width: Math.min(bounds!.width, viewport.width),
      height: viewport.height,
    },
  })
  appendFileSync(
    test.info().outputPath('captures.jsonl'),
    JSON.stringify({ ...metadata, screenshot, pixelInspected: false }) + '\n',
  )
}
for (const locale of locales) {
  for (const theme of ['light', 'dark'] as const) {
    test(`@qa sidebar matrix ${locale} ${theme}`, async ({ browser }) => {
      test.setTimeout(300_000)
      const context = await newFlowContext(browser)
      const errors: string[] = []
      try {
        await login(context, { login: 'demo.boshliq', password: examplePassword })
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        await context.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        const page = await context.newPage()
        page.on('pageerror', (error) => errors.push(error.message))
        const environments = [
          { width: 1440, height: 900, scale: 1 },
          { width: 768, height: 600, scale: 2 },
          { width: 768, height: 480, scale: 2 },
          { width: 390, height: 480, scale: 2 },
          { width: 320, height: 480, scale: 2 },
          { width: 360, height: 225, scale: 1 },
        ]
        for (const environment of environments) {
          const { width, height, scale } = environment
          await page.setViewportSize({ width, height })
          await page.goto('/help')
          await waitForLoadedRoute(page, '/help')
          await setTextScale(page, scale)
          let nav = await openSidebar(page, locale, width)
          const geometry = await sidebarGeometry(nav)
          expect(geometry.overlap).toBe(false)
          expect(geometry.navHeight).toBeGreaterThanOrEqual(88)
          const overflow = await page.evaluate(() => ({
            width: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            nodes: [...document.querySelectorAll('body *')]
              .filter((node) => {
                const rect = node.getBoundingClientRect()
                return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1)
              })
              .map((node) => ({
                tag: node.tagName,
                text: node.textContent?.slice(0, 120),
                className: node.getAttribute('class'),
                right: node.getBoundingClientRect().right,
              })),
          }))
          appendFileSync(
            test.info().outputPath('overflow.jsonl'),
            JSON.stringify({ locale, theme, ...environment, ...overflow }) + '\n',
          )
          expect(overflow.documentWidth).toBeLessThanOrEqual(width + 1)
          const metadata = { locale, theme, ...environment, role: 'department-head', geometry }
          await capture(page, nav, `sidebar-${width}-${height}-text${scale * 100}`, metadata)
          const axe = await new AxeBuilder({ page })
            .include(width >= 768 ? 'aside' : '[role="dialog"] nav')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
          expect(axe.violations).toEqual([])
          const knowledge = nav.locator('button[aria-controls="devon-nav-group-knowledge"]')
          await knowledge.focus()
          if ((await knowledge.getAttribute('aria-expanded')) === 'false')
            await knowledge.press('Enter')
          await expect(knowledge).toHaveAttribute('aria-expanded', 'true')
          const pages = nav.locator('a[href="/pages"]')
          await expect(pages).toBeVisible()
          await knowledge.press('Tab')
          await visibleFocus(pages, page)
          await pages.press('Enter')
          await expect(page).toHaveURL(/\/pages$/)
          await waitForLoadedRoute(page, '/pages')
          if (width < 768) nav = await openSidebar(page, locale, width)
          await expect(nav.locator('a[href="/pages"]')).toHaveAttribute('aria-current', 'page')
          const fold = nav.locator('button[aria-controls="devon-nav-group-knowledge"]')
          await fold.focus()
          await fold.press('Enter')
          await expect(fold).toHaveAttribute('aria-expanded', 'false')
          await fold.press('Tab')
          await visibleFocus(nav.locator('a[href="/pages"]'), page)
          expect(
            await page.evaluate(() =>
              JSON.parse(localStorage.getItem('devon_sidebar_groups') ?? '[]'),
            ),
          ).toContain('knowledge')
          const account = nav.getByRole('button', {
            name: label(locale, 'shell.account.aria'),
            exact: true,
          })
          await account.focus()
          await visibleFocus(account, page)
          await account.press('Enter')
          const menu = page.getByRole('menu')
          await expect(menu).toBeVisible()
          await settleCapture(page, false)
          const menuBounds = await menu.boundingBox()
          const screenshot = test
            .info()
            .outputPath(`account-menu-${width}-${height}-text${scale * 100}.png`)
          await page.screenshot({ path: screenshot })
          appendFileSync(
            test.info().outputPath('captures.jsonl'),
            JSON.stringify({
              ...metadata,
              surface: 'account-menu',
              screenshot,
              menuBounds,
              pixelInspected: false,
            }) + '\n',
          )
          expect.soft(menuBounds!.x).toBeGreaterThanOrEqual(-1)
          expect.soft(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width + 1)
          expect.soft(menuBounds!.y).toBeGreaterThanOrEqual(-1)
          expect.soft(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(height + 1)
          await expect(menu.getByRole('menuitem')).toHaveCount(3)
          await page.keyboard.press('End')
          await visibleFocus(
            menu.getByRole('menuitem', {
              name: label(locale, 'shell.account.signout'),
              exact: true,
            }),
            page,
          )
          await page.keyboard.press('Home')
          const settings = menu.getByRole('menuitem', {
            name: label(locale, 'shell.account.settings'),
            exact: true,
          })
          await visibleFocus(settings, page)
          await page.keyboard.press('Escape')
          await expect(menu).not.toBeVisible()
          await expect(account).toBeFocused()
          await account.press('Enter')
          await settings.press('Enter')
          await expect(page).toHaveURL(/\/account$/)
          await waitForLoadedRoute(page, '/account')
          const me = await context.request.get('/api/v1/me')
          expect(me.status()).toBe(200)
          expect((await me.json()).user.locale).toBe(locale)
          if (width === 768 && height === 600) {
            await page.reload()
            await waitForLoadedRoute(page, '/account')
          }
          expect(
            await page.evaluate(() =>
              JSON.parse(localStorage.getItem('devon_sidebar_groups') ?? '[]'),
            ),
          ).toContain('knowledge')
          if (width === 1440) {
            const collapse = page.getByRole('button', {
              name: label(locale, 'shell.sidebar.toggle'),
              exact: true,
            })
            await collapse.focus()
            await collapse.press('Enter')
            await expect(page.locator('aside nav')).toHaveCSS('width', '64px')
            expect(await page.evaluate(() => localStorage.getItem('devon_sidebar_collapsed'))).toBe(
              '1',
            )
            await page.reload()
            await waitForLoadedRoute(page, '/account')
            await expect(page.locator('aside nav')).toHaveCSS('width', '64px')
            const railInbox = page.locator('aside nav a[href="/inbox"]')
            await railInbox.focus()
            await railInbox.hover()
            await expect(page.getByRole('tooltip')).toContainText(label(locale, 'inbox.title'))
            const expand = page.getByRole('button', {
              name: label(locale, 'shell.sidebar.expand'),
              exact: true,
            })
            await expand.focus()
            await expand.press('Enter')
            await expect(page.locator('aside nav')).toHaveCSS('width', '264px')
            expect(await page.evaluate(() => localStorage.getItem('devon_sidebar_collapsed'))).toBe(
              '0',
            )
          }
        }
        const nav = await openSidebar(page, locale, 360)
        const account = nav.getByRole('button', {
          name: label(locale, 'shell.account.aria'),
          exact: true,
        })
        await account.focus()
        await account.press('Enter')
        await expect(page.getByRole('menu')).toBeVisible()
        await expect(
          page.getByRole('menuitem', {
            name: label(locale, 'shell.account.settings'),
            exact: true,
          }),
        ).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(
          page.getByRole('menuitem', { name: label(locale, 'shell.shortcuts.title'), exact: true }),
        ).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(
          page.getByRole('dialog', { name: label(locale, 'shell.shortcuts.title'), exact: true }),
        ).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(
          page.getByRole('dialog', { name: label(locale, 'shell.shortcuts.title'), exact: true }),
        ).not.toBeVisible()
        await settleCapture(page, false)
        await account.focus()
        await account.press('Enter')
        await expect(page.getByRole('menu')).toBeVisible()
        await expect(
          page.getByRole('menuitem', {
            name: label(locale, 'shell.account.settings'),
            exact: true,
          }),
        ).toBeFocused()
        await page.keyboard.press('End')
        await expect(
          page.getByRole('menuitem', { name: label(locale, 'shell.account.signout'), exact: true }),
        ).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/\/login(?:\?|$)/)
        expect((await context.request.get('/api/v1/me')).status()).toBe(401)
        await page.reload()
        await expect(page).toHaveURL(/\/login(?:\?|$)/)
        await expect(page.locator('nav')).toHaveCount(0)
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}

test('@qa sidebar short-menu final pixels and shortcut console', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await newFlowContext(browser)
  const consoleErrors: string[] = []
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    await context.addInitScript(() => localStorage.setItem('devon_theme', 'light'))
    for (const locale of locales) {
      expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
      const page = await context.newPage()
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      page.on('pageerror', (error) => consoleErrors.push(error.message))
      await page.setViewportSize({ width: 360, height: 225 })
      await page.goto('/help')
      await waitForLoadedRoute(page, '/help')
      const nav = await openSidebar(page, locale, 360)
      const account = nav.getByRole('button', {
        name: label(locale, 'shell.account.aria'),
        exact: true,
      })
      await account.focus()
      await account.press('Enter')
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: label(locale, 'shell.account.settings'), exact: true }),
      ).toBeFocused()
      await page.keyboard.press('End')
      await visibleFocus(
        menu.getByRole('menuitem', { name: label(locale, 'shell.account.signout'), exact: true }),
        page,
      )
      await settleCapture(page, false)
      const screenshot = test.info().outputPath(`account-menu-end-${locale}.png`)
      await page.screenshot({ path: screenshot })
      appendFileSync(
        test.info().outputPath('captures.jsonl'),
        JSON.stringify({
          surface: 'account-menu-end',
          locale,
          theme: 'light',
          width: 360,
          height: 225,
          scale: 1,
          screenshot,
          pixelInspected: false,
        }) + '\n',
      )
      await page.keyboard.press('Escape')
      await expect(account).toBeFocused()
      await account.press('Enter')
      await expect(menu).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: label(locale, 'shell.account.settings'), exact: true }),
      ).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(
        menu.getByRole('menuitem', { name: label(locale, 'shell.shortcuts.title'), exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('dialog', { name: label(locale, 'shell.shortcuts.title'), exact: true }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(
        page.getByRole('dialog', { name: label(locale, 'shell.shortcuts.title'), exact: true }),
      ).not.toBeVisible()
      await settleCapture(page, false)
      if (locale === 'ru') {
        await page.keyboard.press('Escape')
        await expect(
          page.getByRole('dialog', { name: label(locale, 'shell.menu.open'), exact: true }),
        ).not.toBeVisible()
        await page.setViewportSize({ width: 320, height: 480 })
        await setTextScale(page, 2)
        const heading = page.getByRole('heading', {
          name: label(locale, 'help.groups.account'),
          exact: true,
        })
        await heading.scrollIntoViewIfNeeded()
        await settleCapture(page, false)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          321,
        )
        const faqScreenshot = test.info().outputPath('faq-russian-320-text200.png')
        await page.screenshot({ path: faqScreenshot })
        appendFileSync(
          test.info().outputPath('captures.jsonl'),
          JSON.stringify({
            surface: 'faq-narrow-heading',
            locale,
            theme: 'light',
            width: 320,
            height: 480,
            scale: 2,
            screenshot: faqScreenshot,
            pixelInspected: false,
          }) + '\n',
        )
      }
      await page.close()
    }
    expect(consoleErrors).toEqual([])
  } finally {
    await context.close()
  }
})
