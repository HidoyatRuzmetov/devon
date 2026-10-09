import { mkdir, writeFile } from 'node:fs/promises'
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

const evidenceRoot = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/visual-controls')
const phase = process.env['VISUAL_CONTROLS_PHASE'] ?? 'after'
const matrix = process.env['VISUAL_CONTROLS_MATRIX'] === 'true'
const textOnly = process.env['VISUAL_CONTROLS_TEXT_ONLY'] === 'true'
const themeLabels = {
  'uz-Latn': 'Koʻrinish',
  'uz-Cyrl': 'Кўриниш',
  ru: 'Оформление',
  en: 'Appearance',
}
const groupLabels = {
  'uz-Latn': 'Guruh yaratish',
  'uz-Cyrl': 'Гуруҳ яратиш',
  ru: 'Создать группу',
  en: 'Create group',
}

test('@flow visual controls: calendar alignment, separated selection, contextual milestone editing and group conversion', async ({
  browser,
}) => {
  test.setTimeout(matrix ? 360_000 : 180_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('visual.head'),
      headPassword: examplePassword(),
      departmentName: 'Mahalliy sinov boshqarmasi',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('visual.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    const me = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const colleague = (await (await member.request.get('/api/v1/me')).json()) as {
      user: { id: string }
    }
    const cardTitle =
      'Hamkor tashkilotlar bilan ochiq maʼlumotlar rejasini kelishish va yakuniy jadvalni tayyorlash'
    const response = await authedPost(head, '/api/v1/cards', {
      title: cardTitle,
      assigneeUserId: me.user.id,
      dueAt: '2030-10-08T09:00:00Z',
      priority: 'high',
    })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    await authedPost(head, `/api/v1/cards/${card.id}/checklist`, {
      text: 'Maʼlumotlarni tekshirish',
    })
    await authedPost(head, `/api/v1/cards/${card.id}/comments`, {
      text: 'Faqat mahalliy sinov maʼlumotlari.',
      mentions: [],
    })
    const projectTitle =
      'Ochiq maʼlumotlar bo‘yicha hamkor tashkilotlarning uzoq muddatli umumiy rejasi'
    const projectResponse = await authedPost(head, '/api/v1/projects', {
      title: projectTitle,
      ownerUserId: me.user.id,
      members: [me.user.id, colleague.user.id],
      status: 'active',
      description: 'Hamkorlar bilan kelishilgan reja, muddatlar va natijalarni bir joyda kuzatish.',
      milestones: [
        {
          title:
            'Hamkor tashkilotlar bilan ishchi jadvalni toʻliq kelishish va masʼul xodimlarni belgilash',
          dueOn: '2030-10-10',
        },
        { title: 'Yakuniy natijani ko‘rib chiqish', dueOn: null },
      ],
    })
    expect(projectResponse.status()).toBe(201)
    const project = (await projectResponse.json()) as { id: string; milestones: { id: string }[] }
    const page = await head.newPage()
    const captureRoot =
      phase === 'before' ? evidenceRoot : join(evidenceRoot, test.info().project.name)
    await mkdir(captureRoot, { recursive: true })

    const locales =
      matrix && !textOnly ? (['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const) : (['uz-Latn'] as const)
    const themes = matrix && !textOnly ? (['light', 'dark'] as const) : (['light'] as const)
    // These mutate one browser and one account's preference, so the configurations are sequential.
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const locale = locales[localeIndex]!
      for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
        const theme = themes[themeIndex]!
        expect((await authedPatch(head, '/api/v1/me', { locale })).status()).toBe(200)
        await page.goto('/account')
        await page
          .getByRole('combobox', { name: themeLabels[locale], exact: true })
          .selectOption(theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const widths = textOnly
          ? []
          : phase === 'before'
            ? [1440, 390, 320]
            : [1440, 1024, 768, 390, 320]
        for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
          const width = widths[widthIndex]!
          await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
          await page.goto('/work')
          const tile = page.locator(`[data-dnd-card="${card.id}"]`)
          await expect(tile).toBeVisible()
          await tile.hover()
          await page.screenshot({
            path: join(captureRoot, `${phase}-board-${width}-${theme}-${locale}.png`),
            fullPage: true,
          })
          await tile.screenshot({
            path: join(captureRoot, `${phase}-card-${width}-${theme}-${locale}.png`),
          })
          if (phase !== 'before') {
            const positions = await tile.evaluate((element) => {
              const icon = element.querySelector('.lucide-calendar-clock')!
              const chip = icon.closest('span[class*="rounded-full"]')!
              const iconRect = icon.getBoundingClientRect()
              const chipRect = chip.getBoundingClientRect()
              const selection = element.querySelector('[role="checkbox"]')!.getBoundingClientRect()
              const menu = element
                .querySelector('button[aria-haspopup="menu"]')!
                .getBoundingClientRect()
              const checkboxBox = element.querySelector('[data-slot="checkbox-box"]')!
              const colors = getComputedStyle(checkboxBox)
              const canvas = document.createElement('canvas')
              canvas.width = canvas.height = 1
              const context = canvas.getContext('2d')!
              const luminance = (color: string) => {
                context.fillStyle = color
                context.fillRect(0, 0, 1, 1)
                const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
                  .slice(0, 3)
                  .map((channel) => {
                    const value = channel / 255
                    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
                  })
                return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722
              }
              const border = luminance(colors.borderTopColor)
              const background = luminance(colors.backgroundColor)
              return {
                outlineContrast:
                  (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05),
                deltaY: Math.abs(
                  iconRect.y + iconRect.height / 2 - chipRect.y - chipRect.height / 2,
                ),
                overlap:
                  selection.left < menu.right &&
                  selection.right > menu.left &&
                  selection.top < menu.bottom &&
                  selection.bottom > menu.top,
                targetWidth: selection.width,
                targetHeight: selection.height,
              }
            })
            expect(positions.deltaY).toBeLessThanOrEqual(1)
            expect(positions.overlap).toBe(false)
            expect(positions.outlineContrast).toBeGreaterThanOrEqual(3)
            // Engines can report a 24px CSS target as23.999969px after layout transforms.
            expect(positions.targetWidth).toBeGreaterThanOrEqual(24 - 0.01)
            expect(positions.targetHeight).toBeGreaterThanOrEqual(24 - 0.01)
          }
          await page.goto(`/projects/view?id=${project.id}`)
          await expect(page.getByRole('heading', { name: projectTitle, exact: true })).toBeVisible()
          await page.screenshot({
            path: join(captureRoot, `${phase}-project-${width}-${theme}-${locale}.png`),
            fullPage: true,
          })
          if (phase !== 'before') {
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            const milestone = page.getByRole('checkbox', {
              name: 'Hamkor tashkilotlar bilan ishchi jadvalni toʻliq kelishish va masʼul xodimlarni belgilash',
              exact: true,
            })
            const box = await milestone.boundingBox()
            expect(box!.width).toBeGreaterThanOrEqual(24 - 0.01)
            expect(box!.height).toBeGreaterThanOrEqual(24 - 0.01)
          }
        }
        if (matrix && !textOnly) {
          const editor = page.getByRole('button', {
            name: /Hamkor tashkilotlar bilan ishchi jadvalni/,
          })
          await editor.focus()
          await expect(page.getByRole('tooltip')).toBeVisible()
          await page.screenshot({
            path: join(captureRoot, `after-milestone-focus-320-${theme}-${locale}.png`),
          })
          await editor.press('Enter')
          await expect(page.getByRole('dialog')).toBeVisible()
          await expect
            .poll(() => page.getByRole('dialog').evaluate((el) => getComputedStyle(el).opacity))
            .toBe('1')
          await page.screenshot({
            path: join(captureRoot, `after-milestone-editor-320-${theme}-${locale}.png`),
          })
          await page.getByRole('dialog').press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await expect(editor).toBeFocused()
          await page.goto(`/work/card?id=${card.id}`)
          const trigger = page
            .getByRole('button', { name: groupLabels[locale], exact: true })
            .and(page.locator('[aria-haspopup="dialog"]'))
          await expect(trigger).toBeVisible()
          await expect
            .poll(() =>
              page
                .locator('textarea')
                .first()
                .evaluate((el) => el.scrollHeight - el.clientHeight),
            )
            .toBeLessThanOrEqual(1)
          await page.screenshot({
            path: join(captureRoot, `after-card-detail-320-${theme}-${locale}.png`),
            fullPage: true,
          })
          await trigger.click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await expect
            .poll(() => page.getByRole('dialog').evaluate((el) => getComputedStyle(el).opacity))
            .toBe('1')
          await page.screenshot({
            path: join(captureRoot, `after-create-group-320-${theme}-${locale}.png`),
          })
          await page.getByRole('dialog').press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
      }
    }
    if (phase === 'before') return

    // The expanded checkbox hit area must not open the card or the movement menu.
    await page.goto('/work')
    const selectable = page.locator(`[data-dnd-card="${card.id}"]`)
    await selectable.hover()
    const selection = selectable.getByRole('checkbox')
    await selection.check()
    await expect(selection).toBeChecked()
    await expect
      .poll(() =>
        page
          .locator('main [role="toolbar"]')
          .evaluate((el) => getComputedStyle(el.parentElement!).opacity),
      )
      .toBe('1')
    const bulkToolbar = page.locator('main [role="toolbar"]')
    const actions = bulkToolbar.locator('button[aria-expanded][aria-controls]')
    await expect(actions).toHaveAttribute('aria-expanded', 'false')
    expect((await bulkToolbar.boundingBox())!.height).toBeLessThanOrEqual(64)
    await actions.click()
    await expect(actions).toHaveAttribute('aria-expanded', 'true')
    await expect(bulkToolbar.locator('button[aria-haspopup="menu"]').first()).toBeVisible()
    await page.screenshot({
      path: join(captureRoot, 'after-board-selected-expanded-320.png'),
      fullPage: true,
    })
    await actions.click()
    await expect(actions).toHaveAttribute('aria-expanded', 'false')
    const selectedGeometry = await selectable.evaluate((element) => {
      const check = element.querySelector('[role="checkbox"]')!.getBoundingClientRect()
      const toolbar = document.querySelector('main [role="toolbar"]')!.getBoundingClientRect()
      return { toolbarBottom: toolbar.bottom, checkboxTop: check.top }
    })
    expect(selectedGeometry.toolbarBottom).toBeLessThanOrEqual(selectedGeometry.checkboxTop)
    await page.screenshot({
      path: join(captureRoot, 'after-board-selected-320.png'),
      fullPage: true,
    })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe('/work')
    await selection.uncheck()
    const movement = selectable.locator('button[aria-haspopup="menu"]')
    await movement.focus()
    await movement.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menu').press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(movement).toBeFocused()

    await authedPatch(head, '/api/v1/me', { locale: 'uz-Latn' })
    await page.goto(`/projects/view?id=${project.id}`)

    // A title click completes exactly this milestone; pencil focus announces the complete label.
    const title =
      'Hamkor tashkilotlar bilan ishchi jadvalni toʻliq kelishish va masʼul xodimlarni belgilash'
    await page.getByText(title, { exact: true }).click()
    await expect(page.getByRole('checkbox', { name: title, exact: true })).toBeChecked()
    await page.reload()
    await expect(page.getByRole('checkbox', { name: title, exact: true })).toBeChecked()
    const edit = page.getByRole('button', { name: `Bosqichni tahrirlash: ${title}`, exact: true })
    await edit.focus()
    await expect(page.getByRole('tooltip')).toContainText('Bosqichni tahrirlash')
    await edit.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Bosqich nomi', { exact: true })).toBeVisible()
    await dialog.getByLabel('Bosqich nomi', { exact: true }).fill('Yangilangan bosqich')
    let releaseFailure!: () => void
    const failure = new Promise<void>((resolve) => {
      releaseFailure = resolve
    })
    const path = `**/api/v1/projects/${project.id}/milestones/${project.milestones[0]!.id}`
    await page.route(
      path,
      async (route) => {
        await failure
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'LOCAL_QA_FAILURE',
            message: 'Local synthetic save failure',
          }),
        })
      },
      { times: 1 },
    )
    await dialog.getByRole('button', { name: 'Saqlash', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Saqlash', exact: true })).toBeDisabled()
    await expect(dialog.getByLabel('Bosqich nomi', { exact: true })).toBeDisabled()
    releaseFailure()
    await expect(dialog.getByRole('button', { name: 'Saqlash', exact: true })).toBeEnabled()
    await expect(dialog.getByLabel('Bosqich nomi', { exact: true })).toHaveValue(
      'Yangilangan bosqich',
    )
    const unchangedProject = (await (
      await head.request.get(`/api/v1/projects/${project.id}`)
    ).json()) as { milestones: { id: string; title: string }[] }
    expect(
      unchangedProject.milestones.find((item) => item.id === project.milestones[0]!.id)?.title,
    ).toBe(title)
    await dialog.getByRole('button', { name: 'Saqlash', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('Yangilangan bosqich', { exact: true })).toBeVisible()

    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/work/card?id=${card.id}`)
    const groupAction = page
      .getByRole('button', { name: 'Create group', exact: true })
      .and(page.locator('[aria-haspopup="dialog"]'))
    await expect(groupAction).toBeVisible()
    const cardTitleField = page.getByRole('textbox', { name: 'Title', exact: true })
    await expect(cardTitleField).toHaveValue(cardTitle)
    await expect
      .poll(() => cardTitleField.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(1)
    const editedTitle = `${cardTitle} — barcha hamkorlar uchun yangilangan reja`
    await cardTitleField.fill(editedTitle)
    await cardTitleField.press('Tab')
    await expect
      .poll(
        async () =>
          ((await (await head.request.get(`/api/v1/cards/${card.id}`)).json()) as { title: string })
            .title,
      )
      .toBe(editedTitle)
    await page.reload()
    await expect(cardTitleField).toHaveValue(editedTitle)
    await expect
      .poll(() => cardTitleField.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(1)
    await groupAction.click()
    await expect(page.getByRole('dialog')).toContainText('This card becomes the first shared card')
    await page
      .getByRole('dialog')
      .getByRole('checkbox', { name: 'Test Member', exact: true })
      .check()
    await page.getByRole('dialog').press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(groupAction).toBeFocused()
    await groupAction.click()
    await expect(
      page.getByRole('dialog').getByRole('checkbox', { name: 'Test Member', exact: true }),
    ).not.toBeChecked()
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Create group', exact: true }),
    ).toBeDisabled()
    const unchangedCard = await head.request.get(`/api/v1/cards/${card.id}`)
    expect((await unchangedCard.json()) as { projectId: string | null }).toMatchObject({
      projectId: null,
    })
    await page.getByRole('dialog').press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    if (matrix || textOnly) {
      await authedPatch(head, '/api/v1/me', { locale: 'ru' })
      await page.goto('/account')
      await page.getByRole('combobox', { name: themeLabels.ru, exact: true }).selectOption('light')
      await page.setViewportSize({ width: 320, height: 640 })
      await page.goto(`/projects/view?id=${project.id}`)
      await expect(page.getByRole('heading', { name: projectTitle, exact: true })).toBeVisible()
      // These typography tokens use px. Enlarging html's font-size only enlarges rem spacing,
      // so double the actual text and line-height tokens to exercise text-only enlargement.
      await page.evaluate(() => {
        const root = document.documentElement
        const computed = getComputedStyle(root)
        for (const name of ['eyebrow', 'caption', 'small', 'body', 'lead', 'h3', 'h2', 'h1']) {
          for (const suffix of ['', '--line-height']) {
            const token = `--text-${name}${suffix}`
            const value = parseFloat(computed.getPropertyValue(token))
            if (Number.isFinite(value)) root.style.setProperty(token, `${value * 2}px`)
          }
        }
      })
      const textPhase = process.env['VISUAL_CONTROLS_TEXT_BASELINE'] === 'true' ? 'before' : 'after'
      await page.screenshot({
        path: join(captureRoot, `${textPhase}-project-320-text200-light-ru.png`),
        fullPage: true,
      })
      const clippedButtons = await page.locator('main footer button').evaluateAll((buttons) =>
        buttons.flatMap((button) => {
          const label = button.querySelector('span')
          if (!label) return []
          const box = button.getBoundingClientRect()
          const text = label.getBoundingClientRect()
          return text.top < box.top - 1 || text.bottom > box.bottom + 1
            ? [{ text: button.textContent, box: box.height, label: text.height }]
            : []
        }),
      )
      await writeFile(
        join(captureRoot, `${textPhase}-text200-metrics.json`),
        JSON.stringify({ clippedButtons }, null, 2),
      )
      if (textPhase !== 'before') expect(clippedButtons).toEqual([])
      await page.evaluate(() => {
        for (const name of ['eyebrow', 'caption', 'small', 'body', 'lead', 'h3', 'h2', 'h1']) {
          for (const suffix of ['', '--line-height'])
            document.documentElement.style.removeProperty(`--text-${name}${suffix}`)
        }
      })
      await page.setViewportSize({ width: 1280, height: 480 })
      await page.screenshot({ path: join(captureRoot, 'after-project-1280-short480-light-ru.png') })
    }
  } finally {
    // Close each owned context after its trace/network flush; each suite also owns a separate
    // output directory so a concurrent suite cannot remove these trace streams.
    await admin.close()
    await head.close()
    await member.close()
  }
})
