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

test.use({ actionTimeout: 15000 })

test('check-in selection, grouped tasks, progress, timer and drawers work on desktop and phone @flow', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('checkin.head'),
      headPassword: examplePassword(),
      departmentName: 'Check-in workspace QA',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('checkin.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const me = (await (await member.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const headMe = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const projectResponse = await authedPost(head, '/api/v1/projects', {
      title: 'Unified project',
      ownerUserId: headMe.user.id,
      members: [me.user.id],
    })
    expect(projectResponse.status(), await projectResponse.text()).toBe(201)
    const project = (await projectResponse.json()) as { id: string }
    const tasks = await Promise.all(
      ['Urgent research', 'Second project task', 'Independent task'].map(async (title, index) => {
        const response = await authedPost(head, '/api/v1/cards', {
          title,
          assigneeUserId: me.user.id,
          priority: index === 0 ? 'urgent' : index === 1 ? 'high' : 'none',
          ...(index < 2 ? { projectId: project.id } : {}),
        })
        expect(response.status(), await response.text()).toBe(201)
        const card = (await response.json()) as { id: string }
        await Promise.all(
          ['First deliverable', 'Second deliverable'].map((text) =>
            authedPost(head, `/api/v1/cards/${card.id}/checklist`, { text: `${title}: ${text}` }),
          ),
        )
        return card
      }),
    )
    const completed = await authedPost(head, '/api/v1/cards', {
      title: 'Already completed',
      assigneeUserId: me.user.id,
    })
    expect(completed.status()).toBe(201)
    const completedId = ((await completed.json()) as { id: string }).id
    await authedPost(head, `/api/v1/cards/${completedId}/checklist`, { text: 'Old delivery' })
    expect(
      (await authedPatch(head, `/api/v1/cards/${completedId}`, { status: 'done' })).status(),
    ).toBe(200)
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/analytics?member=' + me.user.id)
    await expect(page.getByRole('button', { name: 'Save selection', exact: true })).toBeVisible()
    await expect(page.locator('.checkin-group-bar h2', { hasText: 'Unified project' })).toHaveCount(
      1,
    )
    await expect(page.locator('.checkin-task')).toHaveCount(3)
    await expect(page.getByText('Already completed', { exact: true })).toHaveCount(0)
    await page
      .getByRole('button', { name: 'Urgent research: First deliverable', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Second project task: Second deliverable', exact: true })
      .click()
    await page.getByRole('button', { name: 'Save selection', exact: true }).click()
    await expect(page.locator('.checkin-row')).toHaveCount(2)
    await expect(page.locator('.checkin-group-bar h2', { hasText: 'Unified project' })).toHaveCount(
      1,
    )
    await page.locator('.checkin-row-status').first().selectOption('blocked')
    await expect(page.locator('.checkin-person-summary')).toContainText('0 done')
    await page.locator('.checkin-row-status').first().selectOption('done')
    await expect(page.locator('.checkin-person-summary')).toContainText('1 done')
    const cardBody = (await page.locator('.checkin-task').first().boundingBox())!
    await page.mouse.click(cardBody.x + 5, cardBody.y + cardBody.height - 5)
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Delete', exact: true }).first()).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    // Sample actual rendered text through the transition: layout may move it, never scale it.
    await page.evaluate(() => {
      const text = document.querySelector('.checkin-group-bar h2')!
      const range = document.createRange()
      range.selectNodeContents(text)
      const samples: number[] = []
      ;(window as unknown as { checkinTextHeights: number[] }).checkinTextHeights = samples
      const start = performance.now()
      function sample() {
        samples.push(range.getBoundingClientRect().height)
        if (performance.now() - start < 700) requestAnimationFrame(sample)
      }
      sample()
    })
    await page.getByRole('button', { name: 'Choose deliverables', exact: true }).click()
    await page.waitForTimeout(750)
    const heights = await page.evaluate(() =>
      (window as unknown as { checkinTextHeights: number[] }).checkinTextHeights.filter(
        (height) => height > 0,
      ),
    )
    expect(heights.length).toBeGreaterThan(5)
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5)
    await expect(page.locator('.checkin-task')).toHaveCount(3)
    const grip = await page.locator('.checkin-drag-handle').last().boundingBox()
    const targetGroup = await page.locator('.checkin-group').first().boundingBox()
    const sourceId = await page.locator('.checkin-group').last().getAttribute('data-checkin-group')
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetGroup!.x + 30, targetGroup!.y + 30, { steps: 15 })
    await page.mouse.up()
    await expect(page.locator('.checkin-group').first()).toHaveAttribute(
      'data-checkin-group',
      sourceId!,
    )
    await expect(page.getByRole('button', { name: /Manual order/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.reload()
    await page.getByRole('button', { name: 'Choose deliverables', exact: true }).click()
    await expect(page.locator('.checkin-group').first()).toHaveAttribute(
      'data-checkin-group',
      sourceId!,
    )
    await page.locator('.checkin-drag-handle').last().focus()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('button', { name: /Manual order/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: 'Save selection', exact: true }).click()
    await expect(page.locator('.checkin-task')).toHaveCount(2)
    await page.getByRole('button', { name: 'New card', exact: true }).click()
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Created during check-in')
    await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
    await page
      .getByRole('textbox', { name: 'Deliverables', exact: true })
      .fill('Prepare draft\nReview draft')
    const creationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/members/') &&
        response.url().endsWith('/tasks'),
    )
    await page.getByRole('button', { name: 'Create and add to check-in', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.checkin-task')).toHaveCount(3)
    await expect(page.locator('.checkin-row')).toHaveCount(4)
    await expect(
      page
        .locator('.checkin-task', { hasText: 'Created during check-in' })
        .locator('.checkin-row')
        .first(),
    ).toContainText('Prepare draft')
    const created = (await (await creationResponse).json()) as { id: string }
    expect(
      (await (await head.request.get('/api/v1/cards/' + created.id)).json()).projectId,
    ).toBeNull()
    expect(
      (await authedPatch(head, `/api/v1/cards/${created.id}`, { status: 'done' })).status(),
    ).toBe(200)
    await page.reload()
    const completedRecord = page.locator('.checkin-task', { hasText: 'Created during check-in' })
    await expect(completedRecord).toHaveCount(1)
    await page.getByRole('button', { name: 'Choose deliverables', exact: true }).click()
    await expect(completedRecord).toHaveCount(0)
    await page.getByRole('button', { name: 'Save selection', exact: true }).click()
    await expect(completedRecord).toHaveCount(1)
    // Let the selection exit/layout spring settle before installing the synthetic timer clock.
    await page.waitForTimeout(600)
    await page.clock.install()
    await page.getByRole('button', { name: 'Start timer', exact: true }).click()
    await page.clock.fastForward(100_000)
    await expect(page.locator('.checkin-timer')).toHaveAttribute('data-phase', 'warning')
    await page.clock.fastForward(10_000)
    await expect(page.locator('.checkin-timer')).toHaveAttribute('data-phase', 'urgent')
    await page.clock.fastForward(10_000)
    await expect(page.getByRole('timer')).toHaveText('0:00')
    await page.getByRole('button', { name: 'Stop and reset timer', exact: true }).click()
    await expect(page.getByRole('timer')).toHaveText('2:00')
    await page.clock.runFor(600)
    await page.screenshot({ path: testInfo.outputPath('checkin-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.checkin-person-chooser')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const a11y = await new AxeBuilder({ page }).analyze()
    expect(a11y.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''))).toEqual(
      [],
    )
    await page.screenshot({ path: testInfo.outputPath('checkin-mobile.png'), fullPage: true })
    const source = (await (await head.request.get('/api/v1/cards/' + tasks[0]!.id)).json()) as {
      workStage: string
    }
    expect(source.workStage).toBe('in_progress')
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})
