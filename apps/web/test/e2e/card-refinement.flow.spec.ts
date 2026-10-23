import { expect, test } from '@playwright/test'
import { settleCapture } from './platform-capture.js'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow card drawer keeps primary work reachable and board controls discoverable', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  const colleague = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('card.refinement'),
      headPassword: examplePassword(),
      departmentName: 'Card refinement QA',
    })
    await joinDepartmentAsNewUser(colleague, {
      login: uniqueLogin('card.colleague'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await authedPatch(context, '/api/v1/me', { locale: 'en' })
    const me = (await (await context.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const response = await authedPost(context, '/api/v1/cards', {
      title: 'Coordinate the quarterly service delivery review',
      description:
        'Review the updated indicators, confirm the evidence with the team and prepare the final summary for the department.',
      assigneeUserId: me.user.id,
      giverUserId: me.user.id,
      priority: 'high',
      dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    await authedPost(context, `/api/v1/cards/${card.id}/checklist`, {
      text: 'Confirm the evidence and source links',
    })
    const commentResponse = await authedPost(context, `/api/v1/cards/${card.id}/comments`, {
      text: 'The updated figures are ready for review. Please confirm the final sources before sharing.',
      mentions: [],
    })
    const comment = (await commentResponse.json()) as { id: string }
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/work?card=${card.id}`)
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Coordinate the quarterly service delivery review',
    )
    const dialog = page.getByRole('dialog', { name: 'Card details', exact: true })
    const scroll = dialog.locator('[data-card-detail-scroll]')
    const title = dialog.getByRole('textbox', { name: 'Title', exact: true })
    const close = dialog.getByRole('button', { name: 'Close', exact: true })
    await settleCapture(page, false)
    await expect(dialog).toHaveCSS('max-height', 'none')
    expect((await dialog.boundingBox())!.height).toBe(1000)
    const titleBox = (await title.boundingBox())!
    const closeBox = (await close.boundingBox())!
    expect(titleBox.y).toBeGreaterThanOrEqual(closeBox.y + closeBox.height)
    await expect(dialog.getByRole('button', { name: 'More details', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(dialog.getByRole('region', { name: /^Checklist/ })).toBeInViewport()
    const row = dialog.locator(`#comment-${comment.id}`)
    await expect(row).toBeInViewport()
    const edit = row.getByRole('button', { name: 'Edit comment', exact: true })
    await expect(edit).toHaveText('')
    await edit.focus()
    await expect(page.getByRole('tooltip', { name: 'Edit comment', exact: true })).toBeVisible()
    await edit.press('Enter')
    await row.getByRole('textbox').fill('Sources confirmed. Ready for review.')
    await row.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      row.getByText('Sources confirmed. Ready for review.', { exact: true }),
    ).toBeVisible()
    await expect(row.getByText('Edited', { exact: true })).toBeVisible()
    await scroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await settleCapture(page, false)
    await page.screenshot({ path: testInfo.outputPath('drawer-desktop.png') })
    await dialog.getByRole('button', { name: 'More details', exact: true }).click()
    await expect(dialog.getByRole('button', { name: /^Giver:/ })).toBeVisible()
    await dialog.getByRole('button', { name: 'More actions', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await scroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await settleCapture(page, false)
    expect((await dialog.boundingBox())!.height).toBe(844)
    expect(
      await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('drawer-mobile.png') })
    await edit.scrollIntoViewIfNeeded()
    expect((await edit.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    await expect(close).toBeInViewport()
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(row).toHaveCount(0)
    await page.evaluate(() => {
      document.documentElement.dataset['theme'] = 'dark'
    })
    await scroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await settleCapture(page, false)
    await page.screenshot({ path: testInfo.outputPath('drawer-mobile-dark.png') })
    await page.setViewportSize({ width: 320, height: 480 })
    await scroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await settleCapture(page, false)
    expect(
      await scroll.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1)
    await dialog
      .getByRole('textbox', { name: 'Write a comment, @ to mention someone', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(close).toBeInViewport()
    expect((await scroll.boundingBox())!.height).toBeGreaterThan(150)
    await page.screenshot({ path: testInfo.outputPath('drawer-short-mobile.png') })
    await close.click()
    await expect(dialog).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => {
      document.documentElement.dataset['theme'] = 'light'
    })
    const toolbar = page.locator('[data-board-toolbar]')
    const layout = toolbar.locator('[data-board-layout-controls]')
    await expect(layout).toBeVisible()
    const columns = page.locator('[data-board-column]')
    await expect(columns).toHaveCount(3)
    const compactWidth = (await columns.first().boundingBox())!.width
    await layout.getByRole('button', { name: 'Roomy', exact: true }).click()
    await expect
      .poll(async () => (await columns.first().boundingBox())!.width)
      .toBeGreaterThan(compactWidth)
    await layout.getByRole('button', { name: 'Compact', exact: true }).click()
    await layout.getByRole('button', { name: 'Collapse every column', exact: true }).click()
    await expect
      .poll(async () => (await columns.first().boundingBox())!.width)
      .toBeLessThan(compactWidth)
    await layout.getByRole('button', { name: 'Expand all', exact: true }).click()
    const board = page.getByRole('region', { name: 'People board', exact: true })
    await page.evaluate(() => {
      const readings: number[] = []
      ;(window as unknown as { scopeOpacities: number[] }).scopeOpacities = readings
      const end = performance.now() + 1000
      const record = () => {
        const surface = document.querySelector('[data-board-scope]')
        if (surface) readings.push(Number(getComputedStyle(surface).opacity))
        if (performance.now() < end) requestAnimationFrame(record)
      }
      record()
    })
    await toolbar.getByRole('radio', { name: 'Mine', exact: true }).click()
    await expect(columns).toHaveCount(2)
    await settleCapture(page, false)
    expect(
      await page.evaluate(() =>
        (window as unknown as { scopeOpacities: number[] }).scopeOpacities.some(
          (opacity) => opacity > 0 && opacity < 1,
        ),
      ),
    ).toBe(true)
    await toolbar.getByRole('radio', { name: /^Everyone/ }).click()
    await expect(columns).toHaveCount(3)
    await settleCapture(page, false)
    await expect(board).toHaveCSS('opacity', '1')
    await page.screenshot({ path: testInfo.outputPath('board-toolbar.png') })
    // Rapid reversal must cancel the pending update without leaving a transparent canvas.
    await toolbar.getByRole('radio', { name: 'Mine', exact: true }).click()
    await toolbar.getByRole('radio', { name: /^Everyone/ }).click()
    await settleCapture(page, false)
    await expect(columns).toHaveCount(3)
    await expect(board).toHaveCSS('opacity', '1')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toolbar.getByRole('radio', { name: 'Mine', exact: true }).click()
    await expect(columns).toHaveCount(2)
    expect(await board.evaluate((element) => element.getAnimations().length)).toBe(0)
    await expect(board).toHaveCSS('opacity', '1')
  } finally {
    await Promise.all([context.close(), colleague.close(), admin.close()])
  }
})
