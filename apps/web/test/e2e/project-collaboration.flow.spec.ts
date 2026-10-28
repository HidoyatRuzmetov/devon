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

test('@flow project discussion, mentions, revisions and downloadable files', async ({
  browser,
}, info) => {
  test.setTimeout(180000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('discussion.head'),
      headPassword: examplePassword(),
      departmentName: 'Evidence team',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('discussion.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    await authedPatch(member, '/api/v1/me', { locale: 'en' })
    const headId = (
      (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    ).user.id
    const memberId = (
      (await (await member.request.get('/api/v1/me')).json()) as { user: { id: string } }
    ).user.id
    const response = await authedPost(head, '/api/v1/projects', {
      title: 'Public service evidence',
      ownerUserId: headId,
      members: [headId, memberId],
    })
    expect(response.status(), await response.text()).toBe(201)
    const project = (await response.json()) as { id: string }
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/projects/view?id=${project.id}&tab=discussion`)
    const composer = page.getByRole('textbox', { name: 'Send message', exact: true })
    await composer.fill('Please review @Test Member')
    await page
      .getByRole('group', { name: 'Mention a colleague' })
      .getByRole('button', { name: 'Test Member', exact: true })
      .click()
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(
      page.getByRole('log').getByText('Please review @Test Member', { exact: true }),
    ).toBeVisible()
    const comments = (await (
      await head.request.get(`/api/v1/projects/${project.id}/comments`)
    ).json()) as { id: string; mentions: string[] }[]
    expect(comments[0]?.mentions).toEqual([memberId])
    const reader = await member.newPage()
    await reader.goto(`/projects/view?id=${project.id}&tab=discussion`)
    await expect(
      reader.getByRole('log').getByText('Please review @Test Member', { exact: true }),
    ).toBeVisible()
    await expect(reader.getByRole('button', { name: 'Edit comment', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit comment', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Save', exact: true })
      .fill('Evidence approved. Upload the final pack here.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.getByText('Evidence approved. Upload the final pack here.', { exact: true }),
    ).toBeVisible()
    const revised = (await (
      await head.request.get(`/api/v1/projects/${project.id}/comments`)
    ).json()) as typeof comments
    expect(revised[0]?.mentions).toEqual([])
    if (process.env['FLOW_REALTIME'] === '1') {
      await expect(
        reader
          .getByRole('log')
          .getByText('Evidence approved. Upload the final pack here.', { exact: true }),
      ).toBeVisible()
    }
    expect(
      (
        await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await page.screenshot({
      path: info.outputPath('project-discussion-desktop.png'),
      fullPage: true,
    })
    await page.getByRole('tab', { name: 'Files', exact: true }).click()
    await reader.getByRole('tab', { name: 'Files', exact: true }).click()
    await page.locator('input[type=file]').setInputFiles({
      name: 'evidence.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<!doctype html><title>Evidence</title><p>Final report</p>'),
    })
    const file = page.getByRole('link', { name: 'evidence.html', exact: true })
    await expect(file).toBeVisible()
    if (process.env['FLOW_REALTIME'] === '1')
      await expect(reader.getByRole('link', { name: 'evidence.html', exact: true })).toBeVisible()
    const download = page.waitForEvent('download')
    await file.click()
    expect((await download).suggestedFilename()).toBe('evidence.html')
    await page.screenshot({ path: info.outputPath('project-files-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('tab', { name: 'Discussion', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: info.outputPath('project-discussion-mobile.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await expect(page.getByText('Start the conversation', { exact: true })).toBeVisible()
  } finally {
    await Promise.allSettled([admin.close(), head.close(), member.close()])
  }
})
