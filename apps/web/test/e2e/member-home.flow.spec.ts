import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'

test('@flow member Home owns tasks, projects, event cues and its assistant on desktop and phone', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('home.head'),
      headPassword: examplePassword(),
      departmentName: 'Home design QA',
    })
    await registerUser(member, {
      login: uniqueLogin('home.member'),
      password: examplePassword(),
      givenName: 'Nodira',
      familyName: 'Karimova',
    })
    expect(
      (
        await authedPost(member, '/api/v1/departments/join', {
          key: department.joinKey,
          password: department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    expect(
      (
        await authedPatch(head, '/api/v1/ai/settings', {
          flags: { quick_add_parse: true },
          budgetUzsPerMonth: 1000000,
        })
      ).status(),
    ).toBe(200)
    const me = (await (await member.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const boss = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const unitResponse = await authedPost(
      head,
      `/api/v1/departments/${department.departmentId}/units`,
      { name: 'Research & delivery' },
    )
    expect(unitResponse.status()).toBe(201)
    const unit = (await unitResponse.json()) as { id: string }
    for (const userId of [me.user.id, boss.user.id])
      expect(
        (
          await authedPost(head, `/api/v1/departments/${department.departmentId}/unit-roles`, {
            unitId: unit.id,
            userId,
            role: 'member',
          })
        ).status(),
      ).toBe(201)
    const projectResponse = await authedPost(head, '/api/v1/projects', {
      title: 'Service quality review',
      ownerUserId: boss.user.id,
      members: [me.user.id],
    })
    expect(projectResponse.status()).toBe(201)
    const project = (await projectResponse.json()) as { id: string }
    const due = new Date(Date.now() + 2 * 86400000)
    const tasks = [
      {
        title: 'Prepare the evidence pack',
        projectId: project.id,
        projectScope: 'subjective',
        workStage: 'in_progress',
      },
      { title: 'Review the consultation notes', workStage: 'todo' },
      { title: 'Submitted report', status: 'done' },
      { title: 'Archived unfinished draft', status: 'archived' },
    ]
    let projectCard = ''
    for (const task of tasks) {
      const created = await authedPost(head, '/api/v1/cards', {
        title: task.title,
        assigneeUserId: me.user.id,
        dueAt: due.toISOString(),
        ...(task.projectId
          ? { projectId: task.projectId, projectScope: task.projectScope, kind: 'project_task' }
          : {}),
      })
      expect(created.status()).toBe(201)
      const card = (await created.json()) as { id: string }
      expect(
        (
          await authedPatch(head, `/api/v1/cards/${card.id}`, {
            ...(task.workStage ? { workStage: task.workStage } : {}),
            ...(task.status ? { status: task.status } : {}),
          })
        ).status(),
      ).toBe(200)
      if (task.projectId) projectCard = card.id
    }
    expect(
      (
        await authedPost(head, `/api/v1/cards/${projectCard}/checklist`, {
          text: 'Collect evidence',
        })
      ).status(),
    ).toBe(201)
    expect(
      (
        await authedPost(head, '/api/v1/cards', {
          title: 'Someone else’s task',
          assigneeUserId: boss.user.id,
        })
      ).status(),
    ).toBe(201)
    expect(
      (
        await authedPost(head, '/api/v1/events', {
          title: 'Research workshop',
          startsAt: due.toISOString(),
          endsAt: new Date(due.getTime() + 3600000).toISOString(),
        })
      ).status(),
    ).toBe(201)
    const counts = await (await member.request.get('/api/v1/analytics/personal')).json()
    expect(counts).toMatchObject({
      openCount: 2,
      toDoCount: 1,
      inProgressCount: 1,
      doneCount: 1,
      archivedCount: 1,
    })
    const page = await member.newPage()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const failures: string[] = [],
      briefingRequests: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    page.on('request', (request) => {
      if (request.url().includes('/ai/briefing')) briefingRequests.push(request.url())
    })
    await page.goto('/')
    const home = page.getByTestId('member-overview')
    await expect(home).toBeVisible()
    await expect(home.getByRole('link', { name: 'Research & delivery', exact: true })).toBeVisible()
    await expect(home.getByRole('button', { name: 'Active tasks 2', exact: true })).toBeVisible()
    await expect(
      home.getByRole('button', { name: 'Completed & archived 2', exact: true }),
    ).toBeVisible()
    await expect(
      home.getByRole('heading', { name: 'Your work assistant', exact: true }),
    ).toBeVisible()
    await expect(home.getByRole('link', { name: /Research workshop/ })).toContainText('Event')
    await expect(home.getByText('Someone else’s task', { exact: true })).toHaveCount(0)
    expect(briefingRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('member-home-desktop.png') })
    await home.getByRole('button', { name: 'Archived 1', exact: true }).click()
    await expect(home.getByText('Archived unfinished draft', { exact: true })).toBeVisible()
    await expect(home.getByRole('checkbox', { name: /Archived unfinished draft/ })).toBeDisabled()
    await expect(home.getByLabel('Archived · Not completed')).toBeVisible()
    await expect(home.getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
    await home.getByRole('radio', { name: 'My projects', exact: true }).click()
    await expect(home.getByRole('button', { name: /^Service quality review/ })).toBeVisible()
    await expect(
      home.getByRole('progressbar', { name: '0 of 1 checklist items completed' }),
    ).toBeVisible()
    await home.getByRole('link', { name: 'Open project', exact: true }).click()
    await expect(page.getByRole('link', { name: /Back to overview$/ })).toBeVisible()
    await page.getByRole('link', { name: /Back to overview$/ }).click()
    await expect(home).toBeVisible()
    await home.getByRole('button', { name: 'What needs attention?', exact: true }).click()
    await expect(home).toHaveAttribute('data-mode', 'conversation')
    await expect(
      home.getByRole('textbox', { name: 'Ask about your work', exact: true }),
    ).toHaveValue(/What should I focus on next/)
    await home.getByRole('button', { name: 'Back to overview', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(home).toHaveAttribute('data-mode', 'overview')
    const assistantDraft = home.getByRole('textbox', { name: 'Ask about your work', exact: true })
    await expect(assistantDraft).toHaveAttribute('wrap', 'off')
    expect((await assistantDraft.boundingBox())?.height).toBe(40)
    await assistantDraft.focus()
    await expect(home).toHaveAttribute('data-mode', 'conversation')
    await expect(assistantDraft).toHaveAttribute('wrap', 'soft')
    expect((await assistantDraft.boundingBox())?.height).toBeGreaterThan(40)
    await page.screenshot({ path: testInfo.outputPath('member-chat-phone.png') })
    await home.getByRole('button', { name: 'Back to overview', exact: true }).click()
    expect((await assistantDraft.boundingBox())?.height).toBe(40)
    await expect(home.getByRole('radio', { name: 'Coming up', exact: true })).toBeVisible()
    await home.getByRole('radio', { name: 'Coming up', exact: true }).click()
    await expect(home.getByRole('link', { name: /Research workshop/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('member-home-phone.png') })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const audit = await new AxeBuilder({ page })
      .include('[data-testid="member-overview"]')
      .analyze()
    expect(
      audit.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      ),
    ).toEqual([])
    expect(failures).toEqual([])
    // Exercise the normal API and deterministic local provider: preview never creates a task.
    await page.goto('/work')
    const column = page.locator(`[data-board-column="${me.user.id}"]`)
    await column.getByRole('button', { name: 'Add with AI', exact: true }).click()
    const quickAdd = page.getByRole('dialog', { name: 'Add with AI', exact: true })
    const composer = quickAdd.getByRole('textbox', { name: 'Describe the card', exact: true })
    await composer.fill('Prepare the monthly report\nby Friday, urgent')
    await expect(composer).toHaveAttribute('rows', '3')
    await page.screenshot({ path: testInfo.outputPath('ai-quick-add-phone.png') })
    await quickAdd.getByRole('button', { name: 'Preview card', exact: true }).click()
    await expect(quickAdd.getByText('Nodira Karimova', { exact: true })).toBeVisible()
    await expect(quickAdd.getByText('Urgent', { exact: true })).toBeVisible()
    const beforeAccept = (await (
      await member.request.get('/api/v1/cards?q=assignee%3A%40me')
    ).json()) as { items: { id: string }[] }
    expect(beforeAccept.items).toHaveLength(4)
    await quickAdd.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(composer).toHaveValue('Prepare the monthly report\nby Friday, urgent')
    await expect(composer).toBeFocused()
    await composer.press('Control+Enter')
    await expect(quickAdd.getByText('Urgent', { exact: true })).toBeVisible()
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/cards') && response.request().method() === 'POST',
    )
    await quickAdd.getByRole('button', { name: 'Create card', exact: true }).click()
    const created = await createdResponse
    expect(created.status()).toBe(201)
    expect(await created.json()).toMatchObject({ assigneeUserId: me.user.id, priority: 'urgent' })
    await expect(quickAdd).toHaveCount(0)
    // Private to-dos have notes, not scheduling fields: the preview and persisted data agree.
    await page.goto('/personal')
    const privateComposer = page.getByPlaceholder('Add a to-do for today')
    await privateComposer.fill('Prepare private notes by Friday, urgent')
    await page.getByRole('button', { name: 'Refine to-do with AI', exact: true }).click()
    await expect(page.getByText('Saved in notes', { exact: true })).toBeVisible()
    await expect(page.getByText(/Private tasks keep dates and priority in notes/)).toBeVisible()
    const privateCreated = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/personal/tasks') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    const privateResponse = await privateCreated
    expect(privateResponse.status()).toBe(201)
    expect(await privateResponse.json()).toMatchObject({
      notes: expect.stringContaining('Requested priority: Urgent'),
    })
    const privateTasks = (await (await member.request.get('/api/v1/personal/tasks')).json()) as {
      notes: string | null
    }[]
    expect(
      privateTasks.some((task) =>
        task.notes?.includes('Original request: Prepare private notes by Friday, urgent'),
      ),
    ).toBe(true)
    expect(
      (
        await authedPatch(head, '/api/v1/ai/settings', { flags: { quick_add_parse: false } })
      ).status(),
    ).toBe(200)
    await page.reload()
    await expect(privateComposer).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Refine to-do with AI', exact: true }),
    ).toHaveCount(0)
  } finally {
    await Promise.allSettled([member.close(), head.close(), admin.close()])
  }
})
