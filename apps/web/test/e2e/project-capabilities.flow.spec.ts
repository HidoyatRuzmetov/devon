import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
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
import { settleCapture } from './platform-capture.js'
import { visualLabel } from './visual-label.js'

test('@flow project conversion/edit preserve original card and persist members/status/dates/colour', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('project.capabilities.head'),
      headPassword: examplePassword(),
      departmentName: 'Local project capabilities',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('project.capabilities.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    const owner = (
      (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    ).user.id
    const colleague = (
      (await (await member.request.get('/api/v1/me')).json()) as { user: { id: string } }
    ).user.id
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const card = await authedPost(head, '/api/v1/cards', {
      title: 'Preserved original individual card',
      kind: 'project_task',
      assigneeUserId: owner,
    })
    expect(card.status()).toBe(201)
    const cardId = ((await card.json()) as { id: string }).id
    expect(
      (
        await authedPost(head, `/api/v1/cards/${cardId}/checklist`, { text: 'Preserved checklist' })
      ).status(),
    ).toBe(201)
    const page = await head.newPage()
    await page.goto(`/work/card?id=${cardId}`)
    await page.getByRole('button', { name: 'Create group', exact: true }).click()
    const conversion = page.getByRole('dialog', { name: 'Create group', exact: true })
    await conversion.getByRole('checkbox', { name: 'Test Member', exact: true }).check()
    let releaseConversion!: () => void
    const conversionGate = new Promise<void>((resolve) => {
      releaseConversion = resolve
    })
    let conversionStarted!: () => void
    const reachedConversion = new Promise<void>((resolve) => {
      conversionStarted = resolve
    })
    await page.route('**/api/v1/projects/from-card', async (route) => {
      conversionStarted()
      await conversionGate
      await route.continue()
    })
    await conversion.getByRole('button', { name: 'Create group', exact: true }).click()
    await reachedConversion
    await expect
      .soft(conversion.getByRole('checkbox', { name: 'Test Member', exact: true }))
      .toBeDisabled()
    await conversion.press('Escape')
    await expect.soft(conversion).toBeVisible()
    releaseConversion()
    await expect(page).toHaveURL(/\/projects\/view\?id=/)
    await page.unroute('**/api/v1/projects/from-card')
    const id = new URL(page.url()).searchParams.get('id')!
    const read = async () =>
      (await (await head.request.get(`/api/v1/projects/${id}`)).json()) as {
        members: string[]
        ownerUserId: string
        title: string
        milestones: unknown[]
        status: string
        colour: string
        startOn: string
        targetOn: string
      }
    expect(await read()).toMatchObject({
      title: 'Preserved original individual card',
      members: [owner, colleague],
      ownerUserId: owner,
      milestones: [],
    })
    const detail = (await (await head.request.get(`/api/v1/cards/${cardId}`)).json()) as {
      projectId: string
      checklist: { text: string }[]
    }
    expect(detail.projectId).toBe(id)
    expect(detail.checklist.map((item) => item.text)).toContain('Preserved checklist')
    const edit = page.getByRole('button', { name: 'Edit project', exact: true })
    await edit.focus()
    await edit.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Edit project', exact: true })
    await dialog
      .getByLabel('Title', { exact: true })
      .fill('Edited project with a retained original task')
    await dialog
      .getByLabel('Description', { exact: true })
      .fill('The same project and full card history remain linked.')
    await dialog.getByRole('combobox', { name: /^Status/ }).selectOption('on_hold')
    await dialog.getByLabel('Start date', { exact: true }).fill('2030-10-01')
    await dialog.getByLabel('Target date', { exact: true }).fill('2030-11-01')
    await dialog.getByLabel('Colour', { exact: true }).fill('#0891b2')
    await dialog.getByRole('checkbox', { name: 'Test Member', exact: true }).uncheck()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(`**/api/v1/projects/${id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await gate
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 503,
          code: 'service_unavailable',
          title: 'Local edit refusal',
        }),
      })
    })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog.getByLabel('Title', { exact: true })).toBeDisabled()
    await expect(dialog.getByRole('checkbox', { name: 'Test Member', exact: true })).toBeDisabled()
    await dialog.press('Escape')
    await expect.soft(dialog).toBeVisible()
    release()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(
      'Edited project with a retained original task',
    )
    expect((await read()).title).toBe('Preserved original individual card')
    await page.unroute(`**/api/v1/projects/${id}`)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(edit).toBeFocused()
    expect(await read()).toMatchObject({
      title: 'Edited project with a retained original task',
      members: [owner],
      status: 'on_hold',
      colour: '#0891b2',
      startOn: '2030-10-01',
      targetOn: '2030-11-01',
    })
    expect(
      ((await (await head.request.get(`/api/v1/cards/${cardId}`)).json()) as { projectId: string })
        .projectId,
    ).toBe(id)
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
      'nested',
    )
    await mkdir(root, { recursive: true })
    const locales = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const
    const themes = ['light', 'dark']
    const widths = [1440, 320]
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const locale = locales[localeIndex]!
      const label = (key: string) => visualLabel('profile-project-edit', locale, key)
      await authedPatch(head, '/api/v1/me', { locale })
      await page.goto(`/projects/view?id=${id}`)
      for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
        const theme = themes[themeIndex]!
        await page.evaluate((theme) => {
          document.documentElement.dataset['theme'] = theme
        }, theme)
        for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
          const width = widths[widthIndex]!
          await page.setViewportSize({ width, height: 900 })
          await page.getByRole('button', { name: label('projectEdit.edit'), exact: true }).click()
          const form = page.getByRole('dialog', { name: label('projectEdit.edit'), exact: true })
          await expect(
            form.getByRole('checkbox', { name: 'Test Member', exact: true }),
          ).not.toBeChecked()
          await settleCapture(page, false)
          await page.screenshot({
            path: join(root, `project-edit-${locale}-${theme}-${width}.png`),
          })
          const box = await form.boundingBox()
          expect(box!.x).toBeGreaterThanOrEqual(-1)
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
          if (width === 320) {
            await page.evaluate(() => {
              const root = document.documentElement
              const style = getComputedStyle(root)
              for (const name of ['body', 'small', 'caption', 'eyebrow', 'h1', 'h2', 'h3']) {
                for (const suffix of ['', '--line-height']) {
                  const token = `--text-${name}${suffix}`
                  const value = Number.parseFloat(style.getPropertyValue(token))
                  if (Number.isFinite(value)) root.style.setProperty(token, `${value * 2}px`)
                }
              }
            })
            await settleCapture(page, false)
            await page.screenshot({
              path: join(root, `project-edit-${locale}-${theme}-320-text200.png`),
            })
            const enlarged = await form.boundingBox()
            expect(enlarged!.y).toBeGreaterThanOrEqual(0)
            expect(enlarged!.y + enlarged!.height).toBeLessThanOrEqual(900)
            const titleGeometry = await form.evaluate((el) => {
              const heading = el.querySelector('h2')!
              const close = el.querySelector('button.absolute')!.getBoundingClientRect()
              const range = document.createRange()
              range.selectNodeContents(heading)
              return {
                horizontalOverflow: el.scrollWidth - el.clientWidth,
                obscured: [...range.getClientRects()].some(
                  (text) =>
                    text.left < close.right &&
                    text.right > close.left &&
                    text.top < close.bottom &&
                    text.bottom > close.top,
                ),
              }
            })
            expect(titleGeometry.horizontalOverflow).toBeLessThanOrEqual(1)
            expect(titleGeometry.obscured).toBe(false)
            const saveButton = form.locator('button[type="submit"]')
            await saveButton.scrollIntoViewIfNeeded()
            await expect(saveButton).toBeInViewport()
            await page.evaluate(() => {
              for (const name of ['body', 'small', 'caption', 'eyebrow', 'h1', 'h2', 'h3']) {
                document.documentElement.style.removeProperty(`--text-${name}`)
                document.documentElement.style.removeProperty(`--text-${name}--line-height`)
              }
            })
          }
          await form.press('Escape')
        }
      }
    }
  } finally {
    await head.close()
    await member.close()
    await admin.close()
  }
})
