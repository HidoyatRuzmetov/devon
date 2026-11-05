import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
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

test('project task checklists and their discussions stay connected to cards and check-in @flow', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('checklist.head'),
      headPassword: examplePassword(),
      departmentName: 'Connected checklist review',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('checklist.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await Promise.all([
      authedPatch(head, '/api/v1/me', { locale: 'en' }),
      authedPatch(member, '/api/v1/me', { locale: 'en' }),
    ])
    const headMe = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const memberMe = (await (await member.request.get('/api/v1/me')).json()) as {
      user: { id: string }
    }
    const projectResponse = await authedPost(head, '/api/v1/projects', {
      title: 'Open data publication',
      ownerUserId: headMe.user.id,
      members: [memberMe.user.id],
    })
    expect(projectResponse.status(), await projectResponse.text()).toBe(201)
    const project = (await projectResponse.json()) as { id: string }
    const taskResponse = await authedPost(head, '/api/v1/cards', {
      title: 'Prepare the quarterly dataset',
      projectId: project.id,
      assigneeUserId: memberMe.user.id,
      kind: 'project_task',
      priority: 'high',
    })
    expect(taskResponse.status(), await taskResponse.text()).toBe(201)
    const task = (await taskResponse.json()) as { id: string }
    const activeResponse = await authedPost(head, `/api/v1/cards/${task.id}/checklist`, {
      text: 'Reconcile source figures',
    })
    const activeItem = (await activeResponse.json()) as { id: string }
    const doneResponse = await authedPost(head, `/api/v1/cards/${task.id}/checklist`, {
      text: 'Already published figures',
    })
    const doneItem = (await doneResponse.json()) as { id: string }
    expect(
      (
        await authedPatch(head, `/api/v1/cards/${task.id}/checklist/${doneItem.id}`, { done: true })
      ).status(),
    ).toBe(204)
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/projects/view?id=${project.id}`)
    const projectTask = page.locator(`[data-project-task="${task.id}"]`)
    await expect(projectTask.getByRole('checkbox')).toHaveCount(2)
    await expect(
      projectTask.getByRole('checkbox', { name: 'Prepare the quarterly dataset' }),
    ).toHaveCount(0)
    await expect(projectTask.getByRole('button', { name: /^Checklist/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await projectTask
      .getByRole('textbox', { name: 'Add checklist item' })
      .fill('Write the methodology note')
    await projectTask.getByRole('textbox', { name: 'Add checklist item' }).press('Enter')
    await expect(
      projectTask.getByRole('checkbox', { name: 'Write the methodology note' }),
    ).toBeVisible()
    const projectRow = projectTask.locator(`[data-checklist-id="${activeItem.id}"]`)
    await expect(projectRow.getByRole('textbox', { name: 'Add a comment' })).toHaveCount(0)
    await projectRow.getByRole('button', { name: 'Actions for Reconcile source figures' }).click()
    await page.getByRole('menuitem', { name: 'Add a comment', exact: true }).click()
    await projectRow
      .getByRole('textbox', { name: 'Add a comment' })
      .fill('Finance confirmed the November source figures.')
    await projectRow.getByRole('button', { name: 'Send comment', exact: true }).click()
    await expect(projectRow.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('')
    await expect(
      projectRow
        .locator('li')
        .getByText('Finance confirmed the November source figures.', { exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('project-task-checklist-discussion.png'),
      animations: 'disabled',
      fullPage: true,
    })
    await projectRow.getByRole('button', { name: 'Collapse comments' }).click()
    await expect(
      projectRow.getByText('Finance confirmed the November source figures.', { exact: true }),
    ).toHaveCount(0)
    await projectRow.getByRole('button', { name: 'Actions for Reconcile source figures' }).click()
    await page.getByRole('menuitem', { name: 'Add to check-in', exact: true }).click()
    await expect
      .poll(async () => {
        const data = (await (await head.request.get('/api/v1/checkins/')).json()) as {
          entries: { checklistItemId: string; state: string }[]
        }
        return data.entries.find((entry) => entry.checklistItemId === activeItem.id)?.state
      })
      .toBe('pending')
    await projectRow.getByRole('checkbox', { name: 'Reconcile source figures' }).click()
    await expect(
      projectRow.getByRole('checkbox', { name: 'Reconcile source figures' }),
    ).toBeChecked()
    await expect
      .poll(async () => {
        const data = (await (await head.request.get('/api/v1/checkins/')).json()) as {
          entries: { checklistItemId: string; state: string }[]
        }
        return data.entries.find((entry) => entry.checklistItemId === activeItem.id)?.state
      })
      .toBe('done')
    await projectTask
      .getByRole('button', { name: 'Prepare the quarterly dataset', exact: true })
      .click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    const drawerRow = drawer.locator(`[data-checklist-id="${activeItem.id}"]`)
    await expect(drawerRow.getByRole('checkbox')).toBeChecked()
    await drawerRow.getByRole('button', { name: 'Actions for Reconcile source figures' }).click()
    await page.getByRole('menuitem', { name: 'Comments (1)', exact: true }).click()
    await expect(
      drawerRow.getByText('Finance confirmed the November source figures.', { exact: true }),
    ).toBeVisible()
    await drawerRow
      .getByRole('textbox', { name: 'Add a comment' })
      .fill('Checked against the published totals.')
    await drawerRow.getByRole('textbox', { name: 'Add a comment' }).press('Control+Enter')
    await expect(drawerRow.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('')
    await expect(
      drawerRow.locator('li').getByText('Checked against the published totals.', { exact: true }),
    ).toBeVisible()
    await expect(drawer.getByRole('button', { name: /^Card discussion/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await page.screenshot({
      path: testInfo.outputPath('card-checklist-discussion.png'),
      animations: 'disabled',
      fullPage: true,
    })
    await page.goto(`/analytics?member=${memberMe.user.id}`)
    await expect(page.locator('.checkin-row-status').first()).toHaveValue('done')
    await page.getByRole('button', { name: 'Actions for Reconcile source figures' }).click()
    await page.getByRole('menuitem', { name: 'Comments (2)', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Add a comment' })).toBeFocused()
    await expect(
      page.getByText('Finance confirmed the November source figures.', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Checked against the published totals.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Add a comment' }).focus()
    await page.screenshot({
      path: testInfo.outputPath('checkin-checklist-discussion.png'),
      animations: 'disabled',
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Choose deliverables', exact: true }).click()
    await expect(page.getByText('Already published figures', { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Reconcile source figures', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Write the methodology note', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Save selection', exact: true }).click()
    const board = (await (await head.request.get('/api/v1/checkins/')).json()) as {
      currentCycleId: string
    }
    expect(
      (
        await authedPost(head, `/api/v1/checkins/cycles/${board.currentCycleId}/lock`, {
          phase: 'checkin',
          memberUserId: memberMe.user.id,
        })
      ).status(),
    ).toBe(204)
    await page.goto(`/projects/view?id=${project.id}`)
    await projectRow.getByRole('button', { name: 'Actions for Reconcile source figures' }).click()
    await expect(page.getByRole('menuitem', { name: 'Edit checklist item' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(page.getByRole('menuitem', { name: 'Comments (2)' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(projectTask).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await projectTask.scrollIntoViewIfNeeded()
    await projectTask.getByRole('textbox', { name: 'Add checklist item' }).focus()
    await projectTask.getByRole('textbox', { name: 'Add checklist item' }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath('project-task-checklist-mobile.png'),
      animations: 'disabled',
      fullPage: false,
    })
    const a11y = await new AxeBuilder({ page }).analyze()
    expect(
      a11y.violations.filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      ),
    ).toEqual([])
    const memberPage = await member.newPage()
    await memberPage.goto('/analytics')
    await memberPage.getByRole('button', { name: 'New card', exact: true }).click()
    await memberPage
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('My individual follow-up')
    await memberPage
      .getByRole('textbox', { name: 'Deliverables', exact: true })
      .fill('Send the final note')
    const creation = memberPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/members/${memberMe.user.id}/tasks`),
    )
    await memberPage
      .getByRole('button', { name: 'Create and add to check-in', exact: true })
      .click()
    expect((await creation).status()).toBe(201)
    await expect(
      memberPage.getByRole('button', { name: 'My individual follow-up', exact: true }),
    ).toBeVisible()
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})
