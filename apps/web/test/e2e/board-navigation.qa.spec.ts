import { expect, test, type Browser, type Locator } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  flowClientHeaders,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import type { Board, Card } from '../../src/features/work/api.js'
import { settleCapture } from './platform-capture.js'

async function fixture(browser: Browser, touch = false) {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const colleagues = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      index === 7 && touch
        ? browser.newContext({
            baseURL: FLOW_WEB_BASE_URL,
            extraHTTPHeaders: flowClientHeaders(),
            hasTouch: true,
          })
        : newFlowContext(browser),
    ),
  )
  const contexts = [admin, head, ...colleagues]
  const external: string[] = []
  await Promise.all(
    contexts.map((context) =>
      context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === FLOW_WEB_BASE_URL) return route.continue()
        external.push(new URL(route.request().url()).hostname)
        return route.abort('blockedbyclient')
      }),
    ),
  )
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('board.nav.head'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic board navigation',
  })
  expect(
    (
      await authedPatch(head, '/api/v1/accounts/profile', {
        givenName: 'Head',
        familyName: 'Navigator',
      })
    ).status(),
  ).toBe(200)
  await Promise.all(
    colleagues.map(async (context, index) => {
      await joinDepartmentAsNewUser(context, {
        login: uniqueLogin('board.nav.member'),
        password: examplePassword(),
        joinKey: department.joinKey,
        joinPassword: department.joinPassword,
      })
      expect(
        (
          await authedPatch(context, '/api/v1/accounts/profile', {
            givenName: index === 7 ? 'Zarina' : `Colleague ${index + 1}`,
            familyName: 'Navigator',
          })
        ).status(),
      ).toBe(200)
    }),
  )
  const member = colleagues[7]!
  await Promise.all(
    [head, member].map(async (context) => {
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    }),
  )
  const ids = await Promise.all(
    [head, ...colleagues].map(
      async (context) =>
        ((await (await context.request.get('/api/v1/me')).json()) as { user: { id: string } }).user
          .id,
    ),
  )
  const headId = ids[0]!
  const memberId = ids[8]!
  const create = async (assigneeUserId: string, title: string) => {
    const response = await authedPost(head, '/api/v1/cards', { title, assigneeUserId })
    expect(response.status()).toBe(201)
    return response.json() as Promise<Card>
  }
  await Promise.all([
    ...Array.from({ length: 14 }, (_, index) => create(headId, `Head delivery ${index + 1}`)),
    ...ids.slice(1).map((id, index) => create(id, `Colleague delivery ${index + 1}`)),
  ])
  const board = async () => {
    const response = await head.request.get('/api/v1/board')
    expect(response.status()).toBe(200)
    return response.json() as Promise<Board>
  }
  return {
    head,
    member,
    headId,
    memberId,
    board,
    close: async () => {
      await Promise.all(contexts.map((context) => context.close()))
      expect(external).toEqual([])
    },
  }
}

async function insideViewport(scroller: Locator, element: Locator) {
  const viewport = await scroller.boundingBox()
  const item = await element.boundingBox()
  return Boolean(
    viewport &&
    item &&
    item.x >= viewport.x + 2 &&
    item.x + item.width <= viewport.x + viewport.width - 2 &&
    item.y >= viewport.y &&
    item.y + item.height <= viewport.y + viewport.height,
  )
}

test('normal desktop board reaches distant people and keeps quick add visible while native card moves retain order', async ({
  browser,
}, info) => {
  const f = await fixture(browser)
  try {
    const before = await f.board()
    const page = await f.member.newPage()
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto('/work')
    const viewport = page.getByRole('region', { name: 'People board', exact: true })
    const column = (id: string) => page.locator(`[data-board-column="${id}"]`)
    const ownAdd = column(f.memberId).getByRole('textbox', { name: '+ Add card', exact: true })
    await expect(viewport).toBeVisible()
    await expect(viewport.locator('[data-board-column]')).toHaveCount(10)
    expect((await column(f.memberId).boundingBox())!.x).toBeGreaterThan(
      (await viewport.boundingBox())!.x + (await viewport.boundingBox())!.width,
    )
    await expect(page.getByRole('button', { name: 'Previous columns', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Next columns', exact: true })).toBeEnabled()
    await expect
      .poll(() =>
        insideViewport(
          viewport,
          column(f.headId).getByRole('textbox', { name: '+ Add card', exact: true }),
        ),
      )
      .toBe(true)
    await settleCapture(page, false)
    await page.screenshot({ path: info.outputPath('board-navigation-start.png') })

    await viewport.hover({ position: { x: 120, y: 160 } })
    await page.mouse.wheel(0, 700)
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(200)
    await expect
      .poll(() =>
        insideViewport(
          viewport,
          column(f.headId).getByRole('textbox', { name: '+ Add card', exact: true }),
        ),
      )
      .toBe(true)
    await settleCapture(page, false)
    await page.screenshot({ path: info.outputPath('sticky-quick-add.png') })
    await page.getByRole('button', { name: 'My column', exact: true }).click()
    await expect.poll(() => insideViewport(viewport, ownAdd)).toBe(true)
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
    await ownAdd.fill('Created directly in my distant column')
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/cards',
    )
    await ownAdd.press('Enter')
    const response = await created
    expect(response.status()).toBe(201)
    const card = (await response.json()) as Card
    expect(card.assigneeUserId).toBe(f.memberId)
    expect(
      (await f.board()).columns
        .find((item) => item.member.userId === f.memberId)
        ?.cards.some((item) => item.id === card.id),
    ).toBe(true)
    await expect(
      column(f.memberId).getByRole('button', { name: card.title, exact: true }),
    ).toBeVisible()
    await settleCapture(page, false)
    await page.screenshot({ path: info.outputPath('own-column-created.png') })

    await page.getByRole('combobox', { name: 'Jump to a person', exact: true }).click()
    await page.getByPlaceholder('Search people…', { exact: true }).fill('no such colleague')
    await expect(page.getByText('No matching people', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('combobox', { name: 'Jump to a person', exact: true }),
    ).toBeFocused()
    await page.getByRole('combobox', { name: 'Jump to a person', exact: true }).click()
    await page.getByPlaceholder('Search people…', { exact: true }).fill('Head Navigator')
    await page.getByRole('option', { name: /^Head Navigator\b/ }).click()
    await expect
      .poll(() =>
        insideViewport(
          viewport,
          column(f.headId).getByRole('textbox', { name: '+ Add card', exact: true }),
        ),
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Next columns', exact: true }).click()
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(300)
    await page.getByRole('button', { name: 'Previous columns', exact: true }).click()
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0)

    const headPage = await f.head.newPage()
    await headPage.setViewportSize({ width: 1366, height: 900 })
    await headPage.goto('/work')
    await expect(headPage.locator('[data-board-column]')).toHaveCount(10)
    const moved = before.columns.find((item) => item.member.userId === f.headId)!.cards[0]!
    const targetColumn = before.columns.find(
      (item) => item.member.userId !== f.headId && item.member.userId !== f.memberId,
    )!
    const target = targetColumn.cards[0]!
    const order = await headPage
      .locator('[data-board-column]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-board-column')),
      )
    const saved = headPage.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        new URL(res.url()).pathname.endsWith(`/cards/${moved.id}/move`),
    )
    await headPage
      .locator(`[data-dnd-card="${moved.id}"]`)
      .dragTo(headPage.locator(`[data-dnd-card="${target.id}"]`), {
        targetPosition: { x: 40, y: 3 },
      })
    expect((await saved).status()).toBe(200)
    const after = await f.board()
    expect(
      after.columns
        .find((item) => item.member.userId === targetColumn.member.userId)
        ?.cards.map((item) => item.id),
    ).toEqual([moved.id, target.id])
    expect(
      after.columns.find((item) => item.member.userId === f.headId)?.cards.map((item) => item.id),
    ).toEqual(
      before.columns
        .find((item) => item.member.userId === f.headId)!
        .cards.slice(1)
        .map((item) => item.id),
    )
    await headPage.reload()
    await expect(
      headPage.locator(
        `[data-dnd-column="${targetColumn.member.userId}"] [data-dnd-card="${moved.id}"]`,
      ),
    ).toBeVisible()
    expect(
      await headPage
        .locator('[data-board-column]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-board-column')),
        ),
    ).toEqual(order)
  } finally {
    await f.close()
  }
})

test('normal phone touch navigation searches a colleague from Mine and preserves native keyboard scrolling', async ({
  browser,
}, info) => {
  const f = await fixture(browser, true)
  try {
    const page = await f.member.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/work')
    const viewport = page.getByRole('region', { name: 'People board', exact: true })
    await expect(viewport).toBeVisible()
    await page.getByRole('button', { name: 'My column', exact: true }).tap()
    const ownAdd = page
      .locator(`[data-board-column="${f.memberId}"]`)
      .getByRole('textbox', { name: '+ Add card', exact: true })
    await expect.poll(() => insideViewport(viewport, ownAdd)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await settleCapture(page, false)
    await page.screenshot({ path: info.outputPath('phone-own-column.png') })
    await page.getByRole('radio', { name: 'Mine', exact: true }).check()
    await expect(viewport.locator('[data-board-column]')).toHaveCount(2)
    await page.getByRole('combobox', { name: 'Jump to a person', exact: true }).tap()
    await page.getByPlaceholder('Search people…', { exact: true }).fill('Colleague 3')
    await page.getByRole('option', { name: /^Colleague 3 Navigator\b/ }).tap()
    await expect(page.getByRole('radio', { name: 'Everyone', exact: false })).toBeChecked()
    await expect(viewport.locator('[data-board-column]')).toHaveCount(10)
    const other = page
      .locator('[data-board-column]')
      .filter({ has: page.getByText('Colleague 3 Navigator', { exact: true }) })
      .getByRole('textbox', { name: '+ Add card', exact: true })
    await expect.poll(() => insideViewport(viewport, other)).toBe(true)
    await settleCapture(page, false)
    await page.screenshot({ path: info.outputPath('phone-person-search.png') })
    const beforePrevious = await viewport.evaluate((element) => element.scrollLeft)
    const expectedPrevious = await viewport.evaluate((element) =>
      Math.max(0, element.scrollLeft - Math.max(240, element.clientWidth * 0.8)),
    )
    await page.getByRole('button', { name: 'Previous columns', exact: true }).tap()
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollLeft))
      .toBeLessThan(beforePrevious)
    await expect
      .poll(() =>
        viewport.evaluate(
          (element, expected) => Math.abs(element.scrollLeft - expected),
          expectedPrevious,
        ),
      )
      .toBeLessThanOrEqual(1)
    // Arrow keys remain native browser scrolling when the board region has focus.
    await viewport.focus()
    const left = await viewport.evaluate((element) => element.scrollLeft)
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(left)
    const overflow = await viewport
      .locator('[data-dnd-column]')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).overflowY))
    expect(overflow.every((value) => value === 'visible')).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    expect((await f.board()).columns.reduce((count, item) => count + item.cards.length, 0)).toBe(22)
  } finally {
    await f.close()
  }
})
