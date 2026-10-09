/* eslint-disable no-restricted-syntax -- The same real session visits ordered tab/viewport states; these browser transitions cannot run independently. */
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { authedPost } from './flow-api.js'
import { eventFixture } from './event-nested-fixtures.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { setTextScale, settleCapture } from './platform-capture.js'
import { visualLabel } from './visual-label.js'

for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`event populated nested tabs ${locale} ${theme} reflow and keyboard targets`, async ({
      browser,
    }, testInfo) => {
      const f = await eventFixture(browser, locale, theme)
      try {
        const issues: Array<{ tab: string; width: number; scale: number; problem: unknown }> = []
        const path = `/api/v1/events/${f.event.id}`
        const long = `Synthetic ${'verylongword'.repeat(14)}`
        for (const [context, resource, body, status] of [
          [f.head, 'rsvp', { status: 'yes', guests: 0 }, 200],
          [f.member, 'rsvp', { status: 'yes', guests: 2, note: long }, 200],
          [f.head, 'comments', { body: long }, 201],
          [f.head, 'items', { label: long, quantity: 3 }, 201],
          [f.head, 'carpools', { seats: 3, departurePlace: long, note: long }, 201],
          [
            f.head,
            'polls',
            {
              kind: 'single',
              question: long,
              options: [{ label: 'Synthetic option A' }, { label: 'Synthetic option B' }],
            },
            201,
          ],
          [
            f.head,
            'photos',
            { url: `${FLOW_WEB_BASE_URL}/qa-visual-event.png`, caption: long },
            201,
          ],
          [f.head, 'feedback', { rating: 4, comment: long, anonymous: true }, 204],
        ] as const) {
          expect((await authedPost(context, `${path}/${resource}`, body)).status()).toBe(status)
        }
        const pixels = await readFile(new URL('./fixtures/account-avatar.png', import.meta.url))
        await f.headPage.route('**/qa-visual-event.png', (route) =>
          route.fulfill({ status: 200, contentType: 'image/png', body: pixels }),
        )
        for (const size of [
          { width: 320, height: 640, scale: 1 },
          { width: 768, height: 800, scale: 1 },
          { width: 1280, height: 600, scale: 2 },
        ]) {
          await f.headPage.setViewportSize({ width: size.width, height: size.height })
          await f.headPage.goto(`/events?event=${f.event.id}`)
          const detail = f.headPage.getByRole('dialog', {
            name: 'Synthetic Nested Event',
            exact: true,
          })
          await expect(detail).toBeVisible()
          await setTextScale(f.headPage, size.scale)
          for (const tab of [
            'rsvp',
            'comments',
            'items',
            'carpool',
            'polls',
            'photos',
            'feedback',
          ] as const) {
            await detail
              .getByRole('tab', {
                name: visualLabel('events', locale, `events.tabs.${tab}`),
                exact: true,
              })
              .click()
            const panel = detail.getByRole('tabpanel', {
              name: visualLabel('events', locale, `events.tabs.${tab}`),
              exact: true,
            })
            await expect(panel).toBeVisible()
            await expect(detail.locator('.devon-shimmer')).toHaveCount(0)
            await panel.evaluate((element) => element.scrollIntoView({ block: 'start' }))
            await settleCapture(f.headPage, false)
            await f.headPage.screenshot({
              path: testInfo.outputPath(`${tab}-${size.width}-${size.scale}.png`),
            })
            const geometry = await detail.evaluate((element) => ({
              width: element.clientWidth,
              scroll: element.scrollWidth,
              page: document.documentElement.scrollWidth,
            }))
            if (geometry.page > size.width + 1 || geometry.scroll > geometry.width + 1)
              issues.push({
                tab,
                width: size.width,
                scale: size.scale,
                problem: { reason: 'content overflow or clipping', geometry },
              })
            if (tab === 'items' || tab === 'carpool') {
              const ordinaryWord =
                tab === 'items'
                  ? panel.locator('li').first().locator('span').first()
                  : panel.getByText(
                      visualLabel('events', locale, 'events.carpool.driver').replace(
                        '{name}',
                        'Test Head',
                      ),
                      { exact: true },
                    )
              const lines = await ordinaryWord.evaluate((element) => {
                const node = element.firstChild
                if (!node || node.nodeType !== Node.TEXT_NODE)
                  throw new Error('The actual label no longer begins with its own text node')
                const word = /^\S+/.exec(node.textContent ?? '')?.[0] ?? ''
                const range = document.createRange()
                range.setStart(node, 0)
                range.setEnd(node, word.length)
                return range.getClientRects().length
              })
              if (lines !== 1)
                issues.push({
                  tab,
                  width: size.width,
                  scale: size.scale,
                  problem: { reason: 'adjacent action fragments an ordinary word', lines },
                })
            }
            const axe = await new AxeBuilder({ page: f.headPage })
              .include('[role="dialog"]')
              .analyze()
            const violations = axe.violations.filter((issue) =>
              ['serious', 'critical'].includes(issue.impact ?? ''),
            )
            if (violations.length)
              issues.push({ tab, width: size.width, scale: size.scale, problem: violations })
          }
        }
        await testInfo.attach('event-visual-failures.json', {
          contentType: 'application/json',
          body: JSON.stringify(issues),
        })
        expect(issues, 'Each populated tab must reflow and pass scoped accessibility').toEqual([])
      } finally {
        await f.close()
      }
    })
  }
}
