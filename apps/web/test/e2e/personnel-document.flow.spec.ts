import AxeBuilder from '@axe-core/playwright'
import { personnelDataSchema, preparePersonnelExport } from '@devon/contracts'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('personnel record edits on two paper pages, previews in place and exports an isolated AI-assisted copy @flow', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('document.head'),
      headPassword: examplePassword(),
      departmentName: 'Personnel document QA',
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.goto('/account/professional')
    await page.getByRole('link', { name: 'Personnel record', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Study mode', exact: true })).toHaveValue('')
    await expect(page.getByRole('combobox', { name: 'Study mode', exact: true })).toContainText(
      'Choose…',
    )
    await expect(page.getByRole('textbox', { name: 'Military rank', exact: true })).toBeVisible()
    await expect(
      page.getByRole('textbox', { name: 'Academic degree', exact: true }),
    ).toHaveAttribute('placeholder', /PhD/)
    await expect(
      page.getByRole('textbox', { name: 'Academic title', exact: true }),
    ).toHaveAttribute('placeholder', /professor/)
    await expect(page.getByText('Names to keep unchanged', { exact: true })).toHaveCount(0)
    await page
      .getByRole('textbox', { name: 'Full legal name', exact: true })
      .fill('Karimov Sardor Akmalovich')
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(page.locator('.template-paper')).toHaveCount(2)
    await page
      .getByRole('button', { name: 'Karimov Sardor Akmalovich', exact: true })
      .first()
      .click()
    await expect(page.getByRole('textbox', { name: 'Full legal name', exact: true })).toBeFocused()
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('button', { name: 'Edit document', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeFocused()
    const data = personnelDataSchema.parse({
      fio: 'Karimov Sardor Akmalovich',
      birthDate: '1990-03-15',
      birthPlace: 'Toshkent shahri, Yunusobod tumani',
      nationality: 'o‘zbek',
      eduLevel: 'олий',
      specialty: 'dasturiy injiniring',
      degree: 'texnika fanlari bo‘yicha falsafa doktori (PhD)',
      title: 'dotsent',
      languages: 'ingliz, rus tillari',
      schools: [
        {
          year: '2012',
          name: 'Toshkent axborot texnologiyalari universiteti',
          form: 'кундузги',
          master: false,
        },
      ],
      work: [
        {
          from: '2012',
          to: '2020',
          current: false,
          since: '',
          months: '',
          text: 'Cola kompaniyasi yetakchi mutaxassisi',
        },
        {
          from: '2020',
          to: '',
          current: true,
          since: '',
          months: '',
          text: 'Raqamli texnologiyalar vazirligi huzuridagi Raqamli hukumat loyihalarini boshqarish markazi iqtisodiy rivojlanish va moliyaviy texnologiyalar tahlili bo‘limi bosh mutaxassisi',
        },
      ],
      relatives: [
        {
          rel: 'Отаси',
          name: 'Karimov Akmal Anvarovich',
          year: '1965',
          place: 'Samarqand shahri',
          status: 'retired',
          job: '',
          prevJob: 'Maktab o‘qituvchisi',
          deathYear: '',
          address: 'Toshkent shahri, Navoiy ko‘chasi, 12-uy',
        },
        {
          rel: 'Онаси',
          name: 'Karimova Dilbar Olimovna',
          year: '1967',
          place: 'Samarqand shahri',
          status: 'housewife',
          job: '',
          prevJob: '',
          deathYear: '',
          address: 'Toshkent shahri, Navoiy ko‘chasi, 12-uy',
        },
      ],
    })
    // Load a complete recoverable draft; saves still use the real API and template validation.
    await page.evaluate((next) => {
      const key = Object.keys(localStorage).find((key) => key.startsWith('devon.personnel.v1:'))!
      const draft = JSON.parse(localStorage.getItem(key)!)
      localStorage.setItem(key, JSON.stringify({ ...draft, value: next }))
    }, data)
    await page.reload()
    await page.getByRole('link', { name: 'Personnel record', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Academic title', exact: true })).toHaveValue(
      'dotsent',
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await head.request.get('/api/v1/accounts/personnel-record')).json()).version,
      )
      .toBe(1)
    await page.screenshot({
      path: testInfo.outputPath('document-edit-desktop.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const workLines = await page
      .locator('.paper-work .paper-edit')
      .last()
      .evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return Array.from(range.getClientRects())
          .filter((r) => r.width > 0)
          .map((r) => ({ left: r.left, top: r.top }))
      })
    expect(workLines.length).toBeGreaterThan(1)
    expect(workLines[1]!.left - workLines[0]!.left).toBeGreaterThan(90)
    await page.screenshot({
      path: testInfo.outputPath('document-preview-desktop.png'),
      fullPage: true,
    })
    let preparations = 0
    await page.route('**/api/v1/accounts/personnel-record/prepare-export', async (route) => {
      preparations++
      const request = route.request().postDataJSON() as {
        data: typeof data
        script: 'latin' | 'cyrillic'
      }
      if (preparations === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
        return
      }
      await route.fulfill({
        json: {
          data: preparePersonnelExport(
            { ...request.data, protectedNames: ['Cola', 'PhD'] },
            request.script,
          ),
          script: request.script,
        },
      })
    })
    await page.getByRole('button', { name: 'Word · Cyrillic', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Your draft is safe' })).toBeVisible()
    await page.getByRole('button', { name: 'Word · Cyrillic', exact: true }).click()
    await expect(page.getByText('Word export preview', { exact: true })).toBeVisible()
    await expect(page.locator('.template-paper').first()).toContainText('Cola')
    await page.locator('[data-preview-field="title"]').click()
    await page.getByRole('textbox', { name: 'Academic title', exact: true }).fill('профессор')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download reviewed Word file', exact: true }).click()
    expect((await download).suggestedFilename()).toMatch(/cyrillic\.docx$/)
    await page.getByRole('button', { name: 'Back to record', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Academic title', exact: true })).toHaveValue(
      'dotsent',
    )
    expect(
      (await (await head.request.get('/api/v1/accounts/personnel-record')).json()).data.title,
    ).toBe('dotsent')
    await page.getByRole('button', { name: 'Add relative', exact: true }).click()
    const last = page.locator('.personnel-family-table tbody tr').last()
    await last
      .getByRole('combobox', { name: 'Employment status', exact: true })
      .selectOption('dead')
    await expect(last.getByRole('textbox', { name: 'Year of death', exact: true })).toBeVisible()
    await expect(
      last.getByRole('textbox', { name: 'Residential address', exact: true }),
    ).toHaveCount(0)
    await last.getByRole('button', { name: 'Remove entry — Close relatives', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('document-edit-mobile.png'), fullPage: true })
    const a11y = await new AxeBuilder({ page }).analyze()
    expect(a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
      [],
    )
  } finally {
    await Promise.all([admin.close(), head.close()])
  }
})
