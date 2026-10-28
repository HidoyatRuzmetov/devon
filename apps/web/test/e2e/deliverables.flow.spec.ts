import AxeBuilder from '@axe-core/playwright'
import type { CheckinBoard } from '@devon/contracts'
import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
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

test('@flow deliverables, Progress, private calendar and timer work on desktop and mobile', async ({
  browser,
}, info) => {
  test.setTimeout(120000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const dept = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('deliverables.head'),
      headPassword: examplePassword(),
      departmentName: 'Service delivery',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('deliverables.member'),
      password: examplePassword(),
      joinKey: dept.joinKey,
      joinPassword: dept.joinPassword,
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    await authedPatch(member, '/api/v1/me', { locale: 'en' })
    const me = (await (await member.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const unitResponse = await authedPost(head, `/api/v1/departments/${dept.departmentId}/units`, {
      name: 'Service delivery and evidence',
    })
    expect(unitResponse.status()).toBe(201)
    const unit = (await unitResponse.json()) as { id: string }
    expect(
      (
        await authedPost(head, `/api/v1/departments/${dept.departmentId}/unit-roles`, {
          unitId: unit.id,
          userId: me.user.id,
          role: 'member',
        })
      ).status(),
    ).toBe(201)
    const projectResponse = await authedPost(head, '/api/v1/projects', {
      title: 'Digital services improvement',
      ownerUserId: me.user.id,
      members: [me.user.id],
    })
    expect(projectResponse.status(), await projectResponse.text()).toBe(201)
    const project = (await projectResponse.json()) as { id: string }
    const initial = await member.request.get('/api/v1/checkins/')
    expect(initial.ok(), await initial.text()).toBeTruthy()
    const board = (await initial.json()) as CheckinBoard

    for (const [index, count] of [3, 7, 5, 5].entries()) {
      const created = await member.request.post('/api/v1/cards/with-checklist', {
        headers: { 'x-csrf-token': await csrfToken(member), 'x-operation-id': randomUUID() },
        data: {
          create: {
            title: [
              'Service quality review',
              'Evidence and delivery report',
              'Data validation',
              'Stakeholder briefing',
            ][index],
            assigneeUserId: me.user.id,
            ...(index % 2 ? { projectId: project.id, projectScope: 'subjective' } : {}),
          },
          checklist: Array.from({ length: count }, (_, n) => ({
            key: 'item' + n,
            text: `Deliverable ${index + 1}.${n + 1} — prepare and review the agreed evidence`,
          })),
        },
      })
      expect(created.status(), await created.text()).toBe(200)
      const card = (await created.json()) as { id: string }
      const detail = (await (await member.request.get(`/api/v1/cards/${card.id}`)).json()) as {
        checklist: { id: string }[]
      }
      const checklist = detail.checklist
      for (const item of checklist) {
        const added = await authedPost(
          member,
          `/api/v1/checkins/cycles/${board.currentCycleId}/entries`,
          { checklistItemId: item.id },
        )
        expect(added.status(), await added.text()).toBe(201)
      }
    }
    const page = await member.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Test Member', exact: true })).toBeVisible()
    await expect(page.getByText('20 deliverables', { exact: true })).toBeVisible()
    await expect(page.locator('.checkin-project-title')).toHaveCount(2)
    expect(
      (
        await new AxeBuilder({ page })
          .include('.checkins-page')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    const statuses = page.getByRole('combobox', { name: /^Status:/ })
    await statuses.first().selectOption('done')
    await expect(page.getByText('1 done', { exact: true })).toBeVisible()
    await statuses.nth(1).selectOption('blocked')
    await expect(page.locator('.checkin-deliverable[data-state=blocked]')).toHaveCount(1)
    await page.screenshot({
      path: info.outputPath('checkin-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('tab', { name: 'Progress', exact: true }).click()
    await expect(page.getByRole('button', { name: /Test Member.*1 of 20 done/ })).toBeVisible()
    await expect(page.locator('.checkin-progress thead th')).toHaveCount(14)
    await expect(page.locator('.checkin-progress-future')).toHaveCount(12)
    expect(
      await page
        .locator('.checkin-progress-scroll')
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath('progress-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: /Test Member.*1 of 20 done/ }).click()
    await page.getByRole('button', { name: 'Open card', exact: true }).first().click()
    await expect(page).toHaveURL(/from=analytics/)
    await page.getByRole('link', { name: 'Check-in / out', exact: true }).first().click()
    await expect(page.getByText('20 deliverables', { exact: true })).toBeVisible()
    const headPage = await head.newPage()
    await headPage.goto('/analytics')
    await headPage.getByRole('button', { name: 'Agree check-in', exact: true }).click()
    await headPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Agree check-in', exact: true })
      .click()
    await expect(headPage.getByText('Check-in agreed', { exact: true })).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Remove from check-in', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: /^Status:/ }).first()).toBeEnabled()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: info.outputPath('checkin-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.goto('/personal?tab=calendar&month=2027-04')
    await page.getByRole('button', { name: 'Add personal entry', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Private planning appointment')
    await dialog.getByLabel('Starts', { exact: true }).fill('2027-04-05T09:00')
    await dialog.getByLabel('Ends', { exact: true }).fill('2027-04-05T10:00')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const own = (await (
      await member.request.get('/api/v1/personal/calendar?from=2027-04-01&to=2027-05-01')
    ).json()) as { title: string }[]
    expect(own.some((row) => row.title === 'Private planning appointment')).toBe(true)
    const foreign = (await (
      await head.request.get('/api/v1/personal/calendar?from=2027-04-01&to=2027-05-01')
    ).json()) as { title: string }[]
    expect(foreign.some((row) => row.title === 'Private planning appointment')).toBe(false)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.reload()
    await expect(page.getByRole('button', { name: /Private planning appointment/ })).toBeVisible()
    await page.screenshot({
      path: info.outputPath('calendar-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    const dayCell = page.getByRole('button', { name: 'Add an entry on April 6, 2027', exact: true })
    const cell = await dayCell.boundingBox()
    await dayCell.click({ position: { x: cell!.width / 2, y: cell!.height - 12 } })
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').press('Escape')
    await page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    const timer = page.getByRole('timer')
    await expect(timer).toHaveText('25:00')
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2),
    ).toBe(true)
    await expect(
      page.locator('.pomodoro-character-layer[data-active="true"] canvas'),
    ).toHaveAttribute('data-ready', 'true')
    expect(
      (
        await new AxeBuilder({ page })
          .include('.pomodoro-studio')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    expect((await timer.boundingBox())!.height).toBeGreaterThan(90)
    await page.screenshot({
      path: info.outputPath('pomodoro-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(page.getByText('Paused. Resume when you’re ready.', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    const resume = page.getByRole('button', { name: 'Resume', exact: true })
    await resume.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath('pomodoro-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  } finally {
    await Promise.allSettled([admin.close(), head.close(), member.close()])
  }
})
