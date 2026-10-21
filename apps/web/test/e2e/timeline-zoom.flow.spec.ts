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

type ZoomFrame = { scale: number; barScale: number; scrollWidth: number; scrollTop: number }
type ZoomWindow = Window & { __zoomFrames?: Promise<ZoomFrame[]> }

test('@flow timeline zoom keeps text, bars and scroll geometry stable with motion enabled', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('timeline.head'),
      headPassword: examplePassword(),
      departmentName: 'Timeline motion QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const me = (await (await context.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const cards = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        authedPost(context, '/api/v1/cards', {
          title: `Timeline task ${index + 1}`,
          assigneeUserId: me.user.id,
          startAt: new Date(Date.now() - 86_400_000).toISOString(),
          dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        }),
      ),
    )
    for (const response of cards) expect(response.status()).toBe(201)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 760 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/work/timeline')
    const bar = page.getByRole('button', { name: /^Timeline task 1 Change start date/ })
    await expect(bar).toBeVisible()
    const zoom = page.getByRole('group', { name: 'Zoom', exact: true })
    // Wait for the one-time arrival animation before measuring only the zoom interaction.
    await expect
      .poll(() => bar.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a))
      .toBe(1)
    for (const next of ['Month', 'Day', 'Week', 'Month', 'Day']) {
      // eslint-disable-next-line no-restricted-syntax -- Each zoom starts from the previous zoom's scroll geometry.
      await bar.evaluate((taskBar, nextZoom) => {
        const scroller =
          document.querySelector<HTMLElement>('[data-timeline-scroller]') ??
          taskBar.closest<HTMLElement>('.overflow-auto')!
        scroller.scrollTo({ left: 280, top: 140, behavior: 'instant' })
        ;(window as ZoomWindow).__zoomFrames = new Promise((resolve) => {
          const frames: ZoomFrame[] = []
          const capture = () => {
            const canvas = scroller.firstElementChild!
            const task = [...scroller.querySelectorAll<HTMLElement>('[role="button"]')].find(
              (node) => node.textContent?.trim() === 'Timeline task 1',
            )!
            frames.push({
              scale: new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a,
              barScale: new DOMMatrixReadOnly(getComputedStyle(task).transform).a,
              scrollWidth: scroller.scrollWidth,
              scrollTop: scroller.scrollTop,
            })
          }
          capture()
          const trigger = [
            ...document.querySelectorAll('[role="group"][aria-label="Zoom"] button'),
          ].find((node) => node.textContent === nextZoom)!
          // Sample the actual scale change, even if CI delays the pointer action.
          const observer = new MutationObserver(() => {
            observer.disconnect()
            const start = performance.now()
            const tick = () => {
              capture()
              if (performance.now() - start < 500) requestAnimationFrame(tick)
              else resolve(frames)
            }
            tick()
          })
          observer.observe(trigger, { attributes: true, attributeFilter: ['aria-pressed'] })
        })
      }, next)
      // eslint-disable-next-line no-restricted-syntax -- This click must follow this iteration's frame sampler.
      await zoom.getByRole('button', { name: next, exact: true }).click()
      const frames = await page.evaluate(async () => (await (window as ZoomWindow).__zoomFrames)!)
      expect(frames.length).toBeGreaterThan(3)
      expect(Math.max(...frames.map((frame) => Math.abs(frame.scale - 1)))).toBeLessThan(0.01)
      expect(Math.max(...frames.map((frame) => Math.abs(frame.barScale - 1)))).toBeLessThan(0.01)
      // Allow the final date label/drag handle beyond the 2200px day canvas, never a scaled canvas.
      expect(Math.max(...frames.map((frame) => frame.scrollWidth))).toBeLessThanOrEqual(2300)
      expect(
        Math.max(...frames.map((frame) => frame.scrollTop)) -
          Math.min(...frames.map((frame) => frame.scrollTop)),
      ).toBeLessThanOrEqual(1)
    }
    await page
      .locator('[data-timeline-scroller]')
      .evaluate((node) => node.scrollTo({ left: 0, top: 0, behavior: 'instant' }))
    await page.screenshot({ path: test.info().outputPath('timeline-day.png') })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await zoom.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(zoom.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(bar).toBeAttached()
  } finally {
    await context.close()
    await admin.close()
  }
})
