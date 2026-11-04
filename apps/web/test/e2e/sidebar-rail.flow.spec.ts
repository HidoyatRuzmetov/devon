import { expect, test, type Page } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('collapsed sidebar centers every icon inside its button @flow', async ({ browser }, info) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('rail.head'),
      headPassword: examplePassword(),
      departmentName: 'Sidebar alignment QA',
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/work')
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible()
    const links = page.locator('aside .devon-nav-scroller a[href]')
    await expect.poll(() => links.count()).toBeGreaterThan(8)
    await expect
      .poll(() =>
        links.evaluateAll((rows) =>
          Math.max(
            ...rows.map((row) => {
              const icon = row.querySelector('svg')!.getBoundingClientRect()
              const button = row.getBoundingClientRect()
              return Math.max(
                Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2),
                Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2),
              )
            }),
          ),
        ),
      )
      .toBeLessThan(1)
    await page.screenshot({ path: info.outputPath('centered-sidebar.png') })
    const people = page.locator('aside a[href="/people"]')
    await people.focus()
    await expect(page.getByRole('tooltip')).toContainText('People')
    await people.press('Enter')
    await expect(people).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await expect(people.locator('[data-shell-label]')).toBeVisible()
  } finally {
    await Promise.all([head.close(), admin.close()])
  }
})

type SidebarFrame = { rail: number; page: number; iconX: number; overflow: number }
type SamplingWindow = Window & { sidebarTransition?: Promise<Animation> }

async function sampleSidebarToggle(page: Page) {
  await expect(page.locator('[data-sidebar-collapsed]')).toBeVisible()
  await expect(page.locator('[data-devon-page-transition]').first()).toBeVisible()
  await expect(page.locator('aside .devon-nav-scroller a[href] svg').first()).toBeVisible()
  // Pause the real CSS transition as React commits the shortcut. CI can skip rendering whole
  // animation frames under load, so inspect its actual 0/25/50/75/100% geometry deterministically.
  await page.evaluate(() => {
    const sidebar = document.querySelector('[data-sidebar-collapsed]')!
    void sidebar.getBoundingClientRect()
    ;(window as SamplingWindow).sidebarTransition = new Promise<Animation>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        observer.disconnect()
        clearTimeout(timeout)
        const animation = sidebar
          .getAnimations()
          .find((entry) => entry instanceof CSSTransition && entry.transitionProperty === 'width')
        if (!animation) {
          reject(new Error(`Sidebar has no width transition at ${location.pathname}`))
          return
        }
        animation.pause()
        resolve(animation)
      })
      const timeout = setTimeout(() => {
        observer.disconnect()
        reject(new Error(`Sidebar shortcut did not change state at ${location.pathname}`))
      }, 10_000)
      observer.observe(sidebar, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    })
  })
  await page.keyboard.press('Control+b')
  return page.evaluate(async () => {
    const state = window as SamplingWindow
    try {
      const animation = await state.sidebarTransition!
      await animation.ready
      const duration = Number(animation.effect!.getComputedTiming().duration)
      if (duration < 100) throw new Error('Sidebar transition unexpectedly disabled')
      const samples: SidebarFrame[] = []
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        animation.currentTime = duration * progress
        // eslint-disable-next-line no-restricted-syntax -- Flush each sampled animation position before measuring.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const rail = document.querySelector('aside')!.getBoundingClientRect()
        const content = document
          .querySelector('[data-devon-page-transition]')!
          .getBoundingClientRect()
        const icon = document
          .querySelector('aside .devon-nav-scroller a[href] svg')!
          .getBoundingClientRect()
        samples.push({
          rail: rail.width,
          page: content.width,
          iconX: icon.x + icon.width / 2,
          overflow: document.documentElement.scrollWidth - innerWidth,
        })
      }
      animation.finish()
      return samples
    } finally {
      delete state.sidebarTransition
    }
  })
}

test('sidebar reflows wide workspaces in both directions without a width cap or icon swing @flow', async ({
  browser,
}, info) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('rail.resize'),
      headPassword: examplePassword(),
      departmentName: 'Sidebar resize QA',
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const page = await head.newPage()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 1920, height: 1080 })
    for (const route of [
      '/work',
      '/work/table',
      '/work/timeline',
      '/work/calendar',
      '/people',
      '/projects',
      '/structure',
      '/events',
      '/analytics',
      '/personal',
    ]) {
      // eslint-disable-next-line no-restricted-syntax -- Each route reuses the same browser page and sidebar state.
      await page.goto(route)
      // eslint-disable-next-line no-restricted-syntax -- Wait for this navigation before sampling its animation.
      await expect(
        page.getByRole('button', { name: 'Collapse sidebar', exact: true }),
      ).toBeVisible()
      for (const collapsing of [true, false]) {
        const frames = await sampleSidebarToggle(page)
        const end = frames.at(-1)!
        expect(end.rail, route).toBeCloseTo(collapsing ? 64 : 264, 0)
        expect(end.page, route).toBeCloseTo(1920 - end.rail - 64, 0)
        expect(
          frames.some((frame) => frame.rail > 65 && frame.rail < 263),
          route,
        ).toBe(true)
        for (const frame of frames) {
          expect(Math.abs(frame.page + frame.rail + 64 - 1920), route).toBeLessThan(1)
          expect(Math.abs(frame.iconX - 32), route).toBeLessThan(1)
          expect(frame.overflow, route).toBeLessThanOrEqual(1)
        }
        if (route === '/work' && collapsing) {
          await expect(page.locator('.devon-board-scroller')).toBeVisible()
          expect((await page.locator('.devon-board-scroller').boundingBox())!.width).toBeCloseTo(
            end.page,
            0,
          )
          await page.screenshot({ path: info.outputPath('wide-collapsed-cards.png') })
        }
      }
    }
    await page.goto('/work')
    for (const width of [1024, 1440]) {
      // eslint-disable-next-line no-restricted-syntax -- Resize the same page sequentially.
      await page.setViewportSize({ width, height: 900 })
      for (const collapsing of [true, false]) {
        const frames = await sampleSidebarToggle(page)
        expect(frames.at(-1)!.rail).toBeCloseTo(collapsing ? 64 : 264, 0)
        expect(frames.every((frame) => Math.abs(frame.page + frame.rail + 64 - width) < 1)).toBe(
          true,
        )
        expect(frames.every((frame) => frame.overflow <= 1)).toBe(true)
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 })
    // Reading/settings pages keep their maximum measure and smoothly re-center in the new space.
    await page.goto('/account')
    const bounded = await sampleSidebarToggle(page)
    expect(bounded.at(-1)!.page).toBeCloseTo(1280, 0)
    expect(bounded.every((frame) => frame.overflow <= 1)).toBe(true)
    // Holding the shortcut must not repeatedly reverse the layout.
    await page.keyboard.down('Control')
    await page.keyboard.down('b')
    await page.keyboard.down('b')
    await page.keyboard.up('b')
    await page.keyboard.up('Control')
    await expect(page.locator('[data-sidebar-collapsed]')).toHaveAttribute(
      'data-sidebar-collapsed',
      'false',
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.keyboard.press('Control+b')
    await expect.poll(async () => (await page.locator('aside').boundingBox())!.width).toBe(64)
  } finally {
    await Promise.all([head.close(), admin.close()])
  }
})
