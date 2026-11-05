import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  csrfToken,
} from './flow-api.js'

test('person workspace connects column header, pins, all lifecycle columns and persistent restore @flow', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  const artifacts = resolve(import.meta.dirname, '../../../../artifacts/review/2026-11-05')
  await mkdir(artifacts, { recursive: true })
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('person.head'),
      headPassword: examplePassword(),
      departmentName: 'Digital government team',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('person.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    for (const context of [head, member])
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    expect(
      (
        await authedPatch(head, '/api/v1/accounts/profile', {
          givenName: 'Malika',
          familyName: 'Ismoilova',
        })
      ).status(),
    ).toBe(200)
    expect(
      (
        await authedPatch(member, '/api/v1/accounts/profile', {
          givenName: 'Aziz',
          familyName: 'Karimov',
        })
      ).status(),
    ).toBe(200)
    const memberMe = (await (await member.request.get('/api/v1/me')).json()) as {
      user: { id: string }
    }
    const headMe = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const memberId = memberMe.user.id
    const create = async (title: string, priority = 'none') => {
      const response = await authedPost(head, '/api/v1/cards', {
        title,
        priority,
        assigneeUserId: memberId,
      })
      expect(response.status(), await response.text()).toBe(201)
      return ((await response.json()) as { id: string }).id
    }
    const pinned = await create('Prepare the stakeholder briefing', 'medium')
    const urgent = await create('Validate open data indicators', 'urgent')
    const doing = await create('Review digital service applications', 'high')
    const done = await create('Publish the weekly progress report', 'low')
    const deleted = await create('Previous draft for the service directory')
    await create('Compare three reporting options', 'medium')
    await create('Review the new dataset sources', 'low')
    await create('Prepare the consultation questions')
    for (const [id, text] of [
      [pinned, 'Collect stakeholder questions'],
      [pinned, 'Prepare the briefing notes'],
      [urgent, 'Check the source figures'],
      [doing, 'Review received applications'],
      [doing, 'Send the findings'],
    ]) {
      expect((await authedPost(head, `/api/v1/cards/${id}/checklist`, { text })).status()).toBe(201)
    }
    expect(
      (await authedPatch(head, `/api/v1/cards/${doing}`, { workStage: 'in_progress' })).status(),
    ).toBe(200)
    expect((await authedPatch(head, `/api/v1/cards/${done}`, { status: 'done' })).status()).toBe(
      200,
    )
    const deletion = await head.request.delete(`/api/v1/cards/${deleted}`, {
      headers: { 'x-csrf-token': await csrfToken(head) },
    })
    expect(deletion.status()).toBe(204)
    expect(
      (await authedPost(head, '/api/v1/work/focus', { cardId: pinned, userId: memberId })).status(),
    ).toBe(204)

    const page = await head.newPage()
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto('/work')
    await page.getByRole('button', { name: 'View Aziz Karimov’s tasks', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/work/person\\?person=${memberId}`))
    await expect(page.locator('[data-person-card]')).toHaveCount(8)
    await expect(page.locator('[data-stage="todo"] [data-person-card]').first()).toHaveAttribute(
      'data-person-card',
      pinned,
    )
    await expect(page.locator('[data-stage="in_progress"] [data-person-card]')).toHaveCount(1)
    await expect(page.locator('[data-stage="done"] [data-person-card]')).toHaveCount(1)
    await expect(page.locator('[data-stage="deleted"] [data-person-card]')).toHaveCount(1)
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByText('Collect stakeholder questions', { exact: true })).not.toBeVisible()
    await page.screenshot({
      path: resolve(artifacts, 'person-workspace-desktop.png'),
      fullPage: true,
    })

    await page.locator(`[data-person-card="${pinned}"] .person-task-open`).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const deletedCard = page.locator(`[data-person-card="${deleted}"]`)
    await expect(deletedCard.locator('.person-task-open')).toHaveCount(0)
    await deletedCard
      .getByRole('button', {
        name: 'Restore Previous draft for the service directory',
        exact: true,
      })
      .click()
    await expect(page.locator('[data-stage="deleted"] [data-person-card]')).toHaveCount(0)
    await expect(page.locator(`[data-stage="todo"] [data-person-card="${deleted}"]`)).toBeVisible()

    // The explicit person tab resets to the viewer; direct links retain the selected colleague.
    await page.getByRole('link', { name: 'By person', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Choose person', exact: true })).toContainText(
      'Malika Ismoilova',
    )
    await expect(page.locator('[data-person-card]')).toHaveCount(0)
    await page.goto(`/work/person?person=${memberId}`)
    await expect(page.locator('[data-person-card]')).toHaveCount(8)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: resolve(artifacts, 'person-workspace-phone.png'),
      fullPage: true,
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(accessibility.violations).toEqual([])

    const memberPage = await member.newPage()
    await memberPage.goto('/work/person')
    await expect(
      memberPage.getByRole('combobox', { name: 'Choose person', exact: true }),
    ).toContainText('Aziz Karimov')
    await memberPage.getByRole('button', { name: 'New card', exact: true }).click()
    const dialog = memberPage.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('My follow-up task')
    await expect(
      dialog.getByRole('combobox', { name: 'Assignee', exact: true }).locator('option'),
    ).toHaveCount(1)
    await dialog.getByRole('button', { name: 'New card', exact: true }).click()
    await expect(memberPage.getByRole('dialog')).toContainText('My follow-up task')
    const ownCreate = await authedPost(member, '/api/v1/cards', {
      title: 'Not another person’s task',
      assigneeUserId: headMe.user.id,
    })
    expect(ownCreate.status()).toBe(403)
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})

test('structure list and chart loading are distinct from People @flow', async ({ browser }) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('structure.loader'),
      headPassword: examplePassword(),
      departmentName: 'Structure loading review',
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const page = await head.newPage()
    await page.route('**/api/v1/departments/*/units**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.continue()
    })
    await page.goto('/structure')
    await expect(page.locator('[data-loading-view="structure"]')).toBeVisible()
    await expect(page.locator('[data-loading-view="structureChart"]')).toHaveCount(0)
    await expect(page.locator('[data-loading-view="people"]')).toHaveCount(0)
  } finally {
    await Promise.all([admin.close(), head.close()])
  }
})
