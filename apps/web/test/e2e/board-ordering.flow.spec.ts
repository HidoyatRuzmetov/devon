import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import type { Board, Card } from '../../src/features/work/api.js'

test('@flow native card drags remain stable across columns and personal focus rises for head/member', async ({
  browser,
}, info) => {
  test.setTimeout(90_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  const third = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('ordering.head'),
      headPassword: examplePassword(),
      departmentName: uniqueLogin('ordering'),
    })
    for (const context of [member, third])
      await joinDepartmentAsNewUser(context, {
        login: uniqueLogin('ordering.member'),
        password: examplePassword(),
        joinKey: department.joinKey,
        joinPassword: department.joinPassword,
      })
    const users = await Promise.all(
      [head, member, third].map(
        async (context) =>
          ((await (await context.request.get('/api/v1/me')).json()) as { user: { id: string } })
            .user.id,
      ),
    )
    const [headId, memberId, thirdId] = users as [string, string, string]
    expect(
      (
        await head.request.put(`/api/v1/departments/${department.departmentId}/features`, {
          data: { features: { focus_list: true } },
          headers: { 'x-csrf-token': await csrfToken(head) },
        })
      ).ok(),
    ).toBeTruthy()
    for (const context of [head, member])
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).ok()).toBeTruthy()
    const create = async (assigneeUserId: string, label: string, dueAt: string | null = null) => {
      const response = await authedPost(head, '/api/v1/cards', {
        title: `Ordering ${label}`,
        assigneeUserId,
        dueAt,
      })
      expect(response.status()).toBe(201)
      return response.json() as Promise<Card>
    }
    const headCards = [
      await create(headId, 'head 1', '2030-10-01T00:00:00Z'),
      await create(headId, 'head 2'),
      await create(headId, 'head 3', '2029-10-01T00:00:00Z'),
    ]
    const memberCards = [
      await create(memberId, 'member 1'),
      await create(memberId, 'member 2'),
      await create(memberId, 'member 3'),
    ]
    const thirdCards = [await create(thirdId, 'third 1'), await create(thirdId, 'third 2')]
    const page = await head.newPage()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/work')
    const column = (id: string) => page.locator(`[data-dnd-column="${id}"]`)
    const positions = async (id: string) =>
      column(id)
        .locator('[data-dnd-card]')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-dnd-card')))
    await expect(column(headId).locator('[data-dnd-card]')).toHaveCount(3)
    expect(await positions(headId)).toEqual(headCards.map((card) => card.id))
    const columnOrder = await page
      .locator('[data-dnd-column]')
      .evaluateAll((columns) => columns.map((column) => column.getAttribute('data-dnd-column')))
    let moveCalls = 0
    const payloads: unknown[] = []
    let allowMove!: () => void
    const permit = new Promise<void>((resolve) => {
      allowMove = resolve
    })
    await page.route('**/api/v1/cards/*/move', async (route) => {
      moveCalls += 1
      payloads.push(route.request().postDataJSON())
      await permit
      await route.continue()
    })
    await page
      .locator(`[data-dnd-card="${headCards[2]!.id}"]`)
      .dragTo(page.locator(`[data-dnd-card="${memberCards[0]!.id}"]`), {
        targetPosition: { x: 40, y: 3 },
      })
    await expect.poll(() => moveCalls).toBe(1)
    await expect
      .poll(() => positions(memberId))
      .toEqual([headCards[2]!.id, ...memberCards.map((card) => card.id)])
    expect(await positions(headId)).toEqual(headCards.slice(0, 2).map((card) => card.id))
    expect(await positions(thirdId)).toEqual(thirdCards.map((card) => card.id))
    expect(
      await page
        .locator('[data-dnd-column]')
        .evaluateAll((columns) => columns.map((column) => column.getAttribute('data-dnd-column'))),
    ).toEqual(columnOrder)
    // Observe actual rendered frames throughout a delayed response. Neither polling nor an old
    // callback may reintroduce the old layout while the move is still optimistic.
    const snapshots = await page.evaluate(async () => {
      const values: string[] = []
      for (let i = 0; i < 30; i++) {
        await new Promise(requestAnimationFrame)
        values.push(
          JSON.stringify(
            [...document.querySelectorAll('[data-dnd-column]')].map((column) => ({
              id: column.getAttribute('data-dnd-column'),
              cards: [...column.querySelectorAll('[data-dnd-card]')].map((card) =>
                card.getAttribute('data-dnd-card'),
              ),
            })),
          ),
        )
      }
      return values
    })
    expect(new Set(snapshots).size).toBe(1)
    expect(moveCalls).toBe(1)
    expect(payloads[0]).toEqual({
      toUserId: memberId,
      targetCardId: memberCards[0]!.id,
      edge: 'before',
    })
    allowMove()
    await expect
      .poll(async () => {
        const board = (await (await head.request.get('/api/v1/board')).json()) as Board
        return board.columns
          .find((item) => item.member.userId === memberId)!
          .cards.map((card) => card.id)
      })
      .toEqual([headCards[2]!.id, ...memberCards.map((card) => card.id)])
    await page.unroute('**/api/v1/cards/*/move')
    await page
      .locator(`[data-dnd-card="${memberCards[2]!.id}"]`)
      .dragTo(page.locator(`[data-dnd-card="${memberCards[1]!.id}"]`), {
        targetPosition: { x: 40, y: 3 },
      })
    await expect
      .poll(() => positions(memberId))
      .toEqual([headCards[2]!.id, memberCards[0]!.id, memberCards[2]!.id, memberCards[1]!.id])
    await page.reload()
    await expect
      .poll(() => positions(memberId))
      .toEqual([headCards[2]!.id, memberCards[0]!.id, memberCards[2]!.id, memberCards[1]!.id])
    expect(await positions(thirdId)).toEqual(thirdCards.map((card) => card.id))

    let allowFocus!: () => void
    const focusPermit = new Promise<void>((resolve) => {
      allowFocus = resolve
    })
    await page.route('**/api/v1/work/focus', async (route) => {
      if (route.request().method() === 'POST') await focusPermit
      await route.continue()
    })
    await page
      .locator(`[data-dnd-card="${headCards[1]!.id}"]`)
      .getByRole('button', { name: headCards[1]!.title, exact: true })
      .click()
    await page.getByRole('button', { name: 'Add to focus', exact: true }).click()
    await expect.poll(() => positions(headId)).toEqual([headCards[1]!.id, headCards[0]!.id])
    allowFocus()
    await expect(page.getByRole('button', { name: 'Remove from focus', exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.unroute('**/api/v1/work/focus')
    const memberPage = await member.newPage()
    await memberPage.setViewportSize({ width: 1920, height: 1080 })
    await memberPage.goto('/work')
    const memberColumn = memberPage.locator(`[data-dnd-column="${memberId}"]`)
    await expect(
      memberPage.locator(`[data-dnd-column="${headId}"] [data-dnd-card]`).first(),
    ).toHaveAttribute('data-dnd-card', headCards[0]!.id)
    await memberPage
      .locator(`[data-dnd-card="${memberCards[1]!.id}"]`)
      .getByRole('button', { name: memberCards[1]!.title, exact: true })
      .click()
    await memberPage.getByRole('button', { name: 'Add to focus', exact: true }).click()
    await expect(memberColumn.locator('[data-dnd-card]').first()).toHaveAttribute(
      'data-dnd-card',
      memberCards[1]!.id,
    )
    await memberPage.getByRole('button', { name: 'Remove from focus', exact: true }).click()
    await expect(memberColumn.locator('[data-dnd-card]').last()).toHaveAttribute(
      'data-dnd-card',
      memberCards[1]!.id,
    )
    await memberPage.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.reload()
    await expect(column(headId).locator('[data-dnd-card]').first()).toHaveAttribute(
      'data-dnd-card',
      headCards[1]!.id,
    )
    await expect(column(memberId).locator('[data-dnd-card]').last()).toHaveAttribute(
      'data-dnd-card',
      memberCards[1]!.id,
    )
    const screenshot = info.outputPath('board-stable-order-and-focus.png')
    await page.screenshot({ path: screenshot, animations: 'disabled' })
    await info.attach('Stable board order and personal focus', {
      path: screenshot,
      contentType: 'image/png',
    })
    // Removing a member must not hide their unfinished work. The review bucket preserves the
    // original assignee and accepts target-aware drops beside these former-member cards.
    expect(
      (
        await head.request.post(
          `/api/v1/departments/${department.departmentId}/members/${thirdId}/remove`,
          { headers: { 'x-csrf-token': await csrfToken(head) } },
        )
      ).status(),
    ).toBe(204)
    await page.reload()
    const reviewColumn = column('unassigned')
    await expect(column(thirdId)).toHaveCount(0)
    await expect(reviewColumn.locator('[data-dnd-card]')).toHaveCount(2)
    await expect(
      reviewColumn.getByText('Former assignee is no longer in this department', { exact: true }),
    ).toHaveCount(2)
    const retained = (await (
      await head.request.get(`/api/v1/cards/${thirdCards[1]!.id}`)
    ).json()) as Card
    expect(retained.assigneeUserId).toBe(thirdId)
    await page
      .locator(`[data-dnd-card="${thirdCards[0]!.id}"]`)
      .dragTo(page.locator(`[data-dnd-card="${memberCards[0]!.id}"]`), {
        targetPosition: { x: 40, y: 3 },
      })
    await expect(reviewColumn.locator('[data-dnd-card]')).toHaveCount(1)
    await expect(column(memberId).locator(`[data-dnd-card="${thirdCards[0]!.id}"]`)).toBeVisible()
    await page
      .locator(`[data-dnd-card="${headCards[0]!.id}"]`)
      .dragTo(page.locator(`[data-dnd-card="${thirdCards[1]!.id}"]`), {
        targetPosition: { x: 40, y: 3 },
      })
    await expect.poll(() => positions('unassigned')).toEqual([headCards[0]!.id, thirdCards[1]!.id])
    await page.reload()
    await expect.poll(() => positions('unassigned')).toEqual([headCards[0]!.id, thirdCards[1]!.id])
    await expect(
      reviewColumn.getByText('Former assignee is no longer in this department', { exact: true }),
    ).toHaveCount(1)
    const orphanScreenshot = info.outputPath('board-orphan-review.png')
    await page.screenshot({ path: orphanScreenshot, animations: 'disabled' })
    await info.attach('Former assignee work remains reviewable', {
      path: orphanScreenshot,
      contentType: 'image/png',
    })
  } finally {
    await Promise.all([admin.close(), head.close(), member.close(), third.close()])
  }
})
