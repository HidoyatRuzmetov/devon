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
test('private drafts recover, photos crop and invitations reach the attendee calendar @flow', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('upgrade.head'),
      headPassword: examplePassword(),
      departmentName: 'Profile and calendar QA',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('upgrade.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await Promise.all([
      authedPatch(head, '/api/v1/me', { locale: 'en' }),
      authedPatch(member, '/api/v1/me', { locale: 'en' }),
    ])
    const memberMe = (await (await member.request.get('/api/v1/me')).json()) as {
      user: { id: string }
    }
    const unit = (await (
      await authedPost(head, `/api/v1/departments/${department.departmentId}/units`, {
        name: 'Research unit',
      })
    ).json()) as { id: string }
    expect(
      (
        await authedPost(head, `/api/v1/departments/${department.departmentId}/unit-roles`, {
          unitId: unit.id,
          userId: memberMe.user.id,
          role: 'member',
        })
      ).status(),
    ).toBe(201)
    const page = await member.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/account/professional')
    await page
      .getByRole('textbox', { name: 'Headline', exact: true })
      .fill('Unpublished recovery draft')
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Headline', exact: true })).toHaveValue(
      'Unpublished recovery draft',
    )
    const published = await (
      await member.request.get('/api/v1/accounts/professional-profile')
    ).json()
    expect(JSON.stringify(published)).not.toContain('Unpublished recovery draft')
    await page.getByRole('button', { name: 'Discard recovered draft' }).click()
    await expect(page.getByRole('textbox', { name: 'Headline', exact: true })).toHaveValue('')
    await page.getByRole('tab', { name: 'Personnel record', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Full legal name', exact: true })
      .fill('Karimov Sardor Akmalovich')
    await page.reload()
    await page.getByRole('tab', { name: 'Personnel record', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Full legal name', exact: true })).toHaveValue(
      'Karimov Sardor Akmalovich',
    )
    const privateRecord = (await (
      await member.request.get('/api/v1/accounts/personnel-record')
    ).json()) as { version: number }
    expect(privateRecord.version).toBe(0)
    await page.getByRole('button', { name: 'Discard recovered draft' }).click()
    await expect(page.getByRole('textbox', { name: 'Full legal name', exact: true })).toHaveValue(
      '',
    )
    await page.screenshot({ path: testInfo.outputPath('personnel-desktop.png'), fullPage: true })
    const desktopA11y = await new AxeBuilder({ page }).analyze()
    expect(
      desktopA11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
    ).toEqual([])
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('personnel-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/account')
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 300
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#182c5b'
      ctx.fillRect(0, 0, 400, 300)
      ctx.fillStyle = '#a6d6e8'
      ctx.fillRect(30, 30, 140, 240)
      return canvas.toDataURL('image/png').split(',')[1]!
    })
    await page.locator('input[type=file]').setInputFiles({
      name: 'synthetic-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
    const crop = page.getByRole('dialog', { name: 'Edit profile photo' })
    await expect(crop).toBeVisible()
    await expect(crop.getByRole('button', { name: 'Use photo' })).toBeEnabled()
    await crop.getByRole('slider', { name: 'Zoom' }).fill('1.5')
    await crop.getByRole('button', { name: 'Rotate 90°' }).click()
    await crop.getByRole('button', { name: 'Flip horizontally' }).click()
    await page.screenshot({ path: testInfo.outputPath('photo-crop.png') })
    await crop.getByRole('button', { name: 'Use photo' }).click()
    await expect
      .poll(async () => {
        const me = (await (await member.request.get('/api/v1/me')).json()) as {
          user: { avatarKey: string | null }
        }
        return me.user.avatarKey
      })
      .toBeTruthy()
    await page.goto('/people')
    await page
      .getByRole('main')
      .getByRole('button', { name: /Test Member/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'View photo', exact: true }).click()
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const headPage = await head.newPage()
    await headPage.goto('/people')
    const personCard = headPage.locator(`[data-member-id="${memberMe.user.id}"]`)
    const downloading = headPage.waitForEvent('download')
    await personCard.getByRole('button', { name: 'Résumé', exact: true }).click()
    const downloaded = await downloading
    expect(downloaded.suggestedFilename()).toMatch(/\.docx$/)
    expect(await downloaded.failure()).toBeNull()
    await personCard.getByRole('button', { name: 'Personnel record', exact: true }).click()
    await expect(headPage.getByRole('dialog', { name: 'Personnel record' })).toBeVisible()
    await headPage.keyboard.press('Escape')
    const unitFilter = headPage.getByRole('button', { name: 'Filter by unit' })
    await unitFilter.click()
    await headPage.getByRole('checkbox', { name: 'Research unit' }).check()
    await headPage.keyboard.press('Escape')
    await expect(headPage.locator('[data-member-id]')).toHaveCount(1)
    await expect(personCard).toBeVisible()
    await headPage.screenshot({ path: testInfo.outputPath('people-downloads.png'), fullPage: true })
    expect(
      (await new AxeBuilder({ page: headPage }).analyze()).violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      ),
    ).toEqual([])
    await headPage.goto('/personal')
    await headPage.getByRole('button', { name: 'Add personal entry', exact: true }).click()
    const appointment = headPage.getByRole('dialog', { name: 'Add personal entry' })
    await appointment
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Shared planning appointment')
    await appointment.getByRole('combobox', { name: 'Attendees' }).click()
    await headPage.getByRole('option', { name: 'Test Member', exact: true }).click()
    await appointment.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(appointment).toHaveCount(0)
    await page.goto('/personal')
    await page
      .getByRole('button', { name: /Shared planning appointment/ })
      .first()
      .click()
    const invited = page.getByRole('dialog', { name: 'Edit personal entry' })
    await expect(invited.getByRole('textbox', { name: 'Title', exact: true })).toBeDisabled()
    await expect(invited).toContainText('Only the organizer can edit or cancel it')
    await page.screenshot({ path: testInfo.outputPath('invited-calendar.png') })
    await page.keyboard.press('Escape')
    await expect(invited).toHaveCount(0)
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})
