import { personnelDataSchema } from '@devon/contracts'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('real data loading follows each layout and imported personnel records require review and Save @flow', async ({
  browser,
}, info) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('loading.head'),
      headPassword: examplePassword(),
      departmentName: 'Loading and import QA',
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const me = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    /* eslint-disable no-restricted-syntax -- These navigations and interceptors share one page and must run sequentially. */
    for (const [path, endpoint, view] of [
      ['/account/personnel', '**/api/v1/accounts/personnel-record', 'personnel'],
      ['/people', '**/api/v1/departments/*/roster', 'people'],
      ['/analytics', '**/api/v1/checkins/**', 'checkin'],
    ]) {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(endpoint!, async (route) => {
        await gate
        await route.continue()
      })
      try {
        await page.goto(path!)
        const loading = page.locator('[data-loading-view="' + view + '"]')
        await expect(loading.first()).toBeVisible()
        await page.screenshot({ path: info.outputPath(view + '-loading.png') })
        release()
        await expect(loading).toHaveCount(0)
      } finally {
        release()
        await page.unroute(endpoint!)
      }
    }
    /* eslint-enable no-restricted-syntax */
    await page.goto('/account/personnel')
    const data = personnelDataSchema.parse({
      fio: 'Karimov Sardor Akmalovich',
      birthDate: '1995-05-12',
      birthPlace: 'Toshkent shahri',
      nationality: 'oʻzbek',
      eduLevel: 'ўрта',
      work: [
        {
          from: '2020',
          to: '',
          current: true,
          since: '2020-01-01',
          months: '',
          text: 'Raqamli texnologiyalar markazi bosh mutaxassisi',
        },
      ],
      relatives: [
        {
          rel: 'Отаси',
          name: 'Karimov Akmal Salimovich',
          year: '1965',
          place: 'Toshkent shahri',
          status: 'work',
          job: 'Maktab oʻqituvchisi',
          prevJob: '',
          deathYear: '',
          address: 'Toshkent shahri, Bogʻ koʻchasi, 12-uy',
        },
      ],
    })
    // The provider is isolated here; real parser/evidence/privacy checks are integration-tested.
    await page.route('**/api/v1/accounts/personnel-record/import', (route) =>
      route.fulfill({
        json: {
          data,
          warnings: ['Please review the employment dates.'],
          unverifiedFields: ['degree'],
        },
      }),
    )
    await page
      .getByRole('textbox', { name: 'Full legal name', exact: true })
      .fill('Previous local draft')
    const upload = page.locator('input[type=file][accept*=".pdf"]')
    await upload.setInputFiles({
      name: 'record.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Karimov Sardor Akmalovich'),
    })
    await expect(page.getByRole('textbox', { name: 'Full legal name', exact: true })).toHaveValue(
      data.fio,
    )
    await expect(
      page.getByText('Please review the employment dates.', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: /Review Academic degree/ }).click()
    await expect(page.getByRole('textbox', { name: 'Academic degree', exact: true })).toBeFocused()
    expect(
      (await (await head.request.get('/api/v1/accounts/personnel-record')).json()).version,
    ).toBe(0)
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Full legal name', exact: true })).toHaveValue(
      data.fio,
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await head.request.get('/api/v1/accounts/personnel-record')).json()).version,
      )
      .toBe(1)
    expect(
      (
        await authedPatch(head, '/api/v1/accounts/profile', {
          givenName: 'Sardor',
          familyName: 'Karimov',
        })
      ).status(),
    ).toBe(200)
    expect(
      (
        await head.request.put('/api/v1/accounts/professional-profile', {
          headers: { 'x-csrf-token': await csrfToken(head) },
          data: {
            version: 1,
            profile: {
              headline: 'Research analyst with 7 years of experience',
              phone: '+998 00 000 00 00',
              education: [
                {
                  institution: 'Example University',
                  degree: 'master',
                  field: 'Artificial Intelligence and Machine Learning',
                  startYear: 2020,
                  endYear: 2022,
                  current: false,
                },
              ],
            },
          },
        })
      ).status(),
    ).toBe(200)
    await page.goto('/people')
    const person = page.locator('[data-member-id="' + me.user.id + '"]')
    await expect(
      person.getByRole('button', { name: /^Résumé \([A-Z][a-z]+ \d{1,2}, \d{4}\)$/ }),
    ).toBeVisible()
    await expect(
      person.getByRole('button', { name: /^Personnel record \([A-Z][a-z]+ \d{1,2}, \d{4}\)$/ }),
    ).toBeVisible()
    await page.screenshot({ path: info.outputPath('separate-download-dates.png') })
    const downloads = person.getByTestId('people-document-downloads')
    const boxes = await downloads.locator('button').evaluateAll((elements) =>
      elements.map((el) => ({
        top: el.getBoundingClientRect().top,
        height: el.getBoundingClientRect().height,
        width: el.getBoundingClientRect().width,
        whiteSpace: getComputedStyle(el).whiteSpace,
      })),
    )
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.top).toBe(boxes[1]!.top)
    expect(boxes.every((box) => box.whiteSpace === 'nowrap')).toBe(true)
    const checkDownloadWidth = async (width: number) => {
      await page.setViewportSize({ width, height: 844 })
      const size = await downloads.evaluate((el) => ({
        client: el.clientWidth,
        scroll: el.scrollWidth,
      }))
      expect(
        size.scroll <= size.client,
        `Download controls at ${width}px: ${JSON.stringify(size)}`,
      ).toBe(true)
      await person.screenshot({ path: info.outputPath(`download-card-${width}.png`) })
    }
    await checkDownloadWidth(390)
    await checkDownloadWidth(320)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: info.outputPath('balanced-download-dates.png') })
    await person.screenshot({ path: info.outputPath('download-card-desktop.png') })
  } finally {
    await head.close()
    await admin.close()
  }
})
