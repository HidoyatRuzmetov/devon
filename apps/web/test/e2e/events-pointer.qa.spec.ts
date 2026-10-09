import { test, expect } from '@playwright/test'
import { eventFixture } from './event-nested-fixtures.js'

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`discussion loading completion preserves a native held Post gesture (${reducedMotion})`, async ({
    browser,
  }, testInfo) => {
    const f = await eventFixture(browser)
    let release = () => {}
    try {
      await f.memberPage.emulateMedia({ reducedMotion })
      let readCommitted = false
      let posted = 0
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await f.memberPage.route(`**/api/v1/events/${f.event.id}/comments`, async (route) => {
        if (route.request().method() === 'POST') {
          posted += 1
          return route.continue()
        }
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        readCommitted = true
        await gate
        await route.fulfill({ response })
      })
      const detail = await f.open(f.memberPage, 'Discussion')
      await expect.poll(() => readCommitted).toBe(true)
      await detail
        .getByPlaceholder('Write a comment', { exact: true })
        .fill('Synthetic held native gesture')
      const post = detail.getByRole('button', { name: 'Post', exact: true })
      await post.scrollIntoViewIfNeeded()
      await f.memberPage.evaluate(() => {
        const events: Array<{
          type: string
          tag: string | undefined
          button: string | null | undefined
          y: number | undefined
        }> = []
        Object.assign(window, { eventNativePointerLog: events })
        for (const type of ['pointerdown', 'pointerup', 'click', 'submit'])
          document.addEventListener(
            type,
            (event) => {
              const target = event.target instanceof Element ? event.target : null
              events.push({
                type,
                tag: target?.tagName,
                button: target?.closest('button')?.textContent,
                y: event instanceof PointerEvent ? event.clientY : undefined,
              })
            },
            true,
          )
      })
      const before = await post.boundingBox()
      expect(before).not.toBeNull()
      const point = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 }
      await f.memberPage.mouse.move(point.x, point.y)
      await f.memberPage.mouse.down()
      release()
      await expect(
        detail.getByText('No comments yet. Be the first.', { exact: true }),
      ).toBeVisible()
      // Holding a real pointer through the actual skeleton exit is an ordinary supported gesture.
      // It deliberately measures the settled transition rather than treating visible text as exit completion.
      await expect(detail.locator('.devon-shimmer')).toHaveCount(0)
      const after = await post.boundingBox()
      const releasedOver = await f.memberPage.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y)
        return { tag: element?.tagName, button: element?.closest('button')?.textContent }
      }, point)
      await f.memberPage.mouse.up()
      const native = await f.memberPage.evaluate(
        () => Reflect.get(window, 'eventNativePointerLog') as unknown,
      )
      await f.memberPage.screenshot({
        path: testInfo.outputPath('discussion-transition-gesture.png'),
      })
      await testInfo.attach('discussion-transition-gesture.json', {
        contentType: 'application/json',
        body: JSON.stringify({ before, after, releasedOver, native, reducedMotion }),
      })
      await expect.poll(() => posted, { timeout: 5_000 }).toBe(1)
      await expect(
        detail.getByRole('paragraph').filter({ hasText: /^Synthetic held native gesture$/ }),
      ).toBeVisible()
      expect(
        (await (await f.member.request.get(`/api/v1/events/${f.event.id}/comments`)).json()).items,
      ).toHaveLength(1)
    } finally {
      release()
      await f.close()
    }
  })
}
