/* eslint-disable no-restricted-syntax -- Each browser step depends on the preceding screen and saved state. */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import AxeBuilder from '@axe-core/playwright'
import { personnelDataSchema, professionalProfileSchema } from '@devon/contracts'
import {
  applySetCookies,
  authedPatch,
  authedPost,
  csrfToken,
  examplePassword,
  loginAsSuperAdmin,
  login,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'

const evidence = resolve(import.meta.dirname, '../../../../artifacts/qa/onboarding')
const scratch = resolve(import.meta.dirname, '.tmp/devon_qa_onboarding_docker')
function database(statement: string) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'devon-onboarding-review-postgres-1',
      'psql',
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'devon_qa_onboarding_docker',
    ],
    { input: statement, encoding: 'utf8', timeout: 15_000 },
  )
  if (result.status !== 0) throw new Error(`Review database fixture failed: ${result.stderr}`)
  return result.stdout
}
const introduction = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Our department</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#172d3e;font:16px/1.6 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:5vw}small{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:#39758a}h1{font-size:clamp(36px,5vw,64px);line-height:1.05;letter-spacing:-.04em;max-width:600px;margin:24px 0}p{max-width:620px;color:#576a79}.line{height:1px;background:#cfdae2;margin:42px 0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}article{background:white;border:1px solid #dbe3e9;border-radius:14px;padding:24px}article b{color:#39758a;font-size:13px}article h2{font-size:20px;line-height:1.3}article p{font-size:14px}button{margin-top:28px;border:0;border-radius:8px;padding:14px 20px;background:#173d50;color:white;font:inherit;cursor:pointer}#detail{padding:20px;background:#e5edf2;border-radius:10px;margin-top:18px}@media(max-width:650px){.grid{grid-template-columns:1fr}main{padding:28px}h1{margin-top:18px}}
</style></head><body><main><small>Example onboarding HTML · Digital services department</small><h1>Good work starts with a shared understanding.</h1><p>Welcome to the team. We make public services simpler, support one another, and keep our commitments visible.</p><div class="line"></div><div class="grid"><article><b>01 / OUR PURPOSE</b><h2>Make services work for people.</h2><p>Start with a clear outcome and understand who it helps.</p></article><article><b>02 / OUR HABITS</b><h2>Share progress early.</h2><p>Keep tasks current, raise blockers, and leave a useful handover.</p></article><article><b>03 / YOUR FIRST WEEK</b><h2>Meet your team.</h2><p>Learn the department, complete your profile, and explore Devon.</p></article></div><button id="more" onclick="document.getElementById('detail').hidden=false">A note from the team</button><div id="detail" hidden>Ask when something is unclear. Good questions help everyone work better.</div></main><script>try{parent.document.body.dataset.onboardingEscaped='yes';document.body.dataset.isolated='no'}catch{document.body.dataset.isolated='yes'}</script></body></html>`

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.onboarding-reading-complete')).toHaveCount(0)
  await page.screenshot({
    path: resolve(evidence, name + '.png'),
    fullPage: (await page.locator('.driver-popover').count()) === 0,
    animations: 'disabled',
  })
}
async function user(context: BrowserContext, name: string, established = false) {
  const credentials = {
    login: uniqueLogin('onboard.' + name.toLowerCase()),
    password: examplePassword(),
  }
  await registerUser(context, {
    ...credentials,
    givenName: name,
    familyName: 'Review',
  })
  const me = await (await context.request.get('/api/v1/me')).json()
  if (established)
    database(`update app.users set onboarding_required=false where id='${me.user.id}';`)
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  return { ...credentials, id: me.user.id as string }
}

test('Docker: approval, required setup, seven chapters, safe practice and responsive screenshots', async ({
  browser,
}) => {
  test.setTimeout(420_000)
  mkdirSync(evidence, { recursive: true })
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    cohead = await newFlowContext(browser),
    member = await newFlowContext(browser),
    newcomer = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const headUser = await user(head, 'Anvar', true)
    const req = await authedPost(head, '/api/v1/departments/requests', {
      name: 'Digital services · Onboarding review',
      locale: 'en',
      units: [{ name: 'Service delivery' }],
    })
    expect(req.status()).toBe(201)
    const approval = await admin.request.post(
      `/api/v1/departments/requests/${(await req.json()).id}/approve`,
      { headers: { 'x-csrf-token': await csrfToken(admin) } },
    )
    expect(approval.status()).toBe(200)
    const department = await approval.json()
    const coheadUser = await user(cohead, 'Nodira', true)
    const memberUser = await user(member, 'Aziza', true)
    for (const context of [cohead, member])
      expect(
        (
          await authedPost(context, '/api/v1/departments/join', {
            key: department.joinKey,
            password: department.joinPassword,
          })
        ).status(),
      ).toBe(200)
    const members = await (
      await head.request.get(`/api/v1/departments/${department.departmentId}/members`)
    ).json()
    const coMembership = members.members.find((m: { userId: string }) => m.userId === coheadUser.id)
    expect(
      (
        await authedPatch(
          head,
          `/api/v1/departments/${department.departmentId}/members/${coheadUser.id}/role`,
          { role: 'head', expectedVersion: coMembership.version },
        )
      ).status(),
    ).toBe(204)

    const uploadPage = await member.newPage()
    await uploadPage.goto('/help?tab=materials')
    await uploadPage
      .getByLabel('Title', { exact: true })
      .fill('Welcome to the digital services department')
    await uploadPage.getByLabel('HTML file', { exact: true }).setInputFiles({
      name: 'department-welcome.html',
      mimeType: 'text/html',
      buffer: Buffer.from(introduction),
    })
    await uploadPage.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(uploadPage.getByText('Awaiting approval', { exact: true })).toBeVisible()
    await expect(uploadPage.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0)
    await capture(uploadPage, '01-member-html-submission')
    const documents = await (await head.request.get('/api/v1/onboarding/documents')).json()
    const documentId = documents.items[0].id
    expect(
      (
        await authedPost(member, `/api/v1/onboarding/documents/${documentId}/decision`, {
          action: 'publish',
          revision: 0,
        })
      ).status(),
    ).toBe(403)

    const headPage = await head.newPage()
    await headPage.goto('/help?tab=materials')
    await headPage.getByRole('button', { name: 'Preview', exact: true }).click()
    const frame = headPage.frameLocator('iframe')
    await expect(frame.locator('body')).toHaveAttribute('data-isolated', 'yes')
    await frame.getByRole('button', { name: 'A note from the team' }).click()
    await expect(frame.locator('#detail')).toBeVisible()
    expect(
      await headPage.evaluate(() => document.body.dataset['onboardingEscaped']),
    ).toBeUndefined()
    await capture(headPage, '02-isolated-html-preview')
    await headPage.getByRole('button', { name: 'Close preview', exact: true }).click()
    await capture(headPage, '03-head-approval')
    await headPage.getByRole('button', { name: 'Approve and publish' }).click()
    await expect(headPage.getByText('Published', { exact: true })).toBeVisible()
    expect(
      (
        await authedPost(cohead, `/api/v1/onboarding/documents/${documentId}/decision`, {
          action: 'publish',
          revision: 0,
        })
      ).status(),
    ).toBe(409)
    await headPage.goto(`/department?id=${department.departmentId}&tab=members`)
    await expect(
      headPage.getByRole('button', { name: 'Leave department', exact: true }),
    ).toBeVisible()
    await capture(headPage, '04-compact-red-leave')

    const newcomerUser = await user(newcomer, 'Sardor')
    expect((await authedPost(newcomer, '/api/v1/onboarding/session', {})).status()).toBe(403)
    expect(
      (
        await authedPost(newcomer, '/api/v1/departments/join', {
          key: department.joinKey,
          password: department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => authedPost(newcomer, '/api/v1/onboarding/session', {})),
    )
    for (const response of concurrent) expect(response.status(), await response.text()).toBe(200)
    const sessions = await Promise.all(concurrent.map((r) => r.json()))
    expect(new Set(sessions.map((s) => s.run.cardId)).size).toBe(1)
    const cardId = sessions[0].run.cardId
    expect(sessions[0].run.documentId).toBe(documentId)
    expect((await newcomer.request.get('/api/v1/cards')).status()).toBe(403)
    const page = await newcomer.newPage()
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => consoleErrors.push(error.message))
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Finished reading' })).toBeEnabled()
    await capture(page, '05-new-member-html-first')
    await page.getByRole('button', { name: 'Finished reading' }).click()
    await expect(page.getByRole('heading', { name: 'Make your account ready' })).toBeVisible()
    await capture(page, '06-required-setup-telegram')
    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: 'Make your account ready' })).toBeVisible()
    await page.getByRole('button', { name: 'Account details' }).click()
    await expect(page.locator('input[autocomplete=given-name]')).toBeVisible()
    // The existing forms have their own validation coverage. These real API saves exercise the same contract.
    expect(
      (
        await authedPatch(newcomer, '/api/v1/accounts/profile', {
          givenName: 'Sardor',
          familyName: 'Karimov',
          patronymic: 'Akmalovich',
          title: 'chief_specialist',
          dateOfBirth: '1992-07-31',
          workStartDate: '2023-01-09',
        })
      ).status(),
    ).toBe(200)
    await page.reload()
    await capture(page, '07-required-account-details')
    const csrf = await csrfToken(newcomer)
    const professionalBefore = await (
      await newcomer.request.get('/api/v1/accounts/professional-profile')
    ).json()
    const professional = professionalProfileSchema.parse({
      position: 'chief_specialist',
      about: 'I help teams deliver clear and reliable digital public services.',
      skills: ['Service design', 'Analysis'],
      experience: [
        {
          organization: 'Digital services department',
          role: 'Chief specialist',
          description: '',
          startYear: 2023,
          endYear: null,
          current: true,
        },
      ],
    })
    expect(
      (
        await newcomer.request.put('/api/v1/accounts/professional-profile', {
          headers: { 'x-csrf-token': csrf },
          data: { profile: professional, version: professionalBefore.version },
        })
      ).status(),
    ).toBe(200)
    await page.goto('/account/professional')
    await expect(page.getByRole('heading', { name: 'Résumé', exact: true }).first()).toBeVisible()
    await capture(page, '08-required-resume')
    const photo = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 3
      c.height = 4
      return c.toDataURL('image/jpeg')
    })
    const personnel = personnelDataSchema.parse({
      photo,
      fio: 'Каримов Сардор Акмалович',
      birthDate: '1992-07-31',
      birthPlace: 'Тошкент шаҳри, Юнусобод тумани',
      nationality: 'ўзбек',
      eduLevel: 'олий',
      specialty: 'дастурий инжиниринг',
      militaryRank: 'йўқ',
      languages: 'инглиз, рус тиллари',
      schools: [
        {
          year: '2014',
          name: 'Тошкент ахборот технологиялари университети',
          form: 'кундузги',
          master: false,
        },
      ],
      work: [
        {
          from: '2023',
          to: '',
          current: true,
          since: '',
          months: '',
          text: 'Рақамли хизматлар бошқармаси бош мутахассиси',
        },
      ],
      relatives: [
        {
          rel: 'Отаси',
          name: 'Каримов Акмал Анварович',
          year: '1965',
          place: 'Самарқанд шаҳри',
          status: 'retired',
          job: '',
          prevJob: 'Мактаб ўқитувчиси',
          deathYear: '',
          address: 'Тошкент шаҳри, Навоий кўчаси, 12-уй',
        },
      ],
    })
    const personnelResult = await newcomer.request.put('/api/v1/accounts/personnel-record', {
      headers: { 'x-csrf-token': csrf },
      data: { data: personnel, version: 0 },
    })
    expect(personnelResult.status(), await personnelResult.text()).toBe(200)
    await page.goto('/account/personnel')
    await expect(page.getByRole('heading', { name: 'Personnel record', exact: true })).toBeVisible()
    await capture(page, '09-required-personnel-record')
    const beforeLink = await (await authedPost(newcomer, '/api/v1/onboarding/session', {})).json()
    expect(beforeLink.facts).toEqual({
      telegram: false,
      account: true,
      resume: true,
      personnel: true,
    })
    expect(beforeLink.required).toBe(true)
    // Local review has no live bot. Seed only Telegram's verified-link record; all account saves and gates are real.
    database(
      `insert into app.telegram_links(user_id,chat_id,locale_at_link) values('${newcomerUser.id}',${Date.now()},'en');`,
    )
    // Saving the final section or a background refresh must not consume the user's Continue.
    const ready = await (await authedPost(newcomer, '/api/v1/onboarding/session', {})).json()
    expect(Object.values(ready.facts).every(Boolean)).toBe(true)
    expect(ready.required).toBe(true)
    expect(ready.run.setupCompleted).toBe(false)
    expect((await newcomer.request.get('/api/v1/cards')).status()).toBe(403)
    await page.getByRole('button', { name: 'Check and continue' }).click()
    await expect(page.locator('.driver-popover-title')).toHaveText('Get to know WorkPortal')
    await expect(
      page.locator('.onboarding-chapter-label, .onboarding-keyboard-hint, .onboarding-page-number'),
    ).toHaveCount(0)
    await expect(page.locator('.driver-popover-description')).not.toContainText(/Enter|Escape|pace/)
    await capture(page, '10a-walkthrough-welcome')
    await page.locator('.driver-popover-close-btn').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.driver-popover-title')).toHaveText('Account details')
    await capture(page, '10-tour-profile')
    const names = [
      '10b-tour-resume',
      '10c-tour-personnel-record',
      '10d-tour-settings',
      '11-tour-home',
      '12-tour-assistant',
      '13-tour-your-column',
      '14-tour-collapse',
      '15-tour-expand',
      '16-tour-onboarding-task',
      '17-tour-task-drawer',
      '18-tour-convert-pointer',
      '19-tour-group-projects',
    ]
    for (const name of names) {
      const previous = await page.locator('.driver-popover-title').textContent()
      await page.locator('.driver-popover-next-btn').click()
      await expect(page.locator('.driver-popover-title')).not.toHaveText(previous!)
      await expect(page.locator('.driver-popover')).toBeVisible()
      await expect(page.locator('.driver-popover-description')).not.toContainText(
        'unavailable in your current view',
      )
      if (name === '10b-tour-resume' || name === '10c-tour-personnel-record') {
        const clip = await page.locator('[data-onboarding-connected] path').last().getAttribute('d')
        const floor = await page
          .locator('[data-onboarding-topbar]')
          .evaluate((el) => el.getBoundingClientRect().bottom)
        const top = Number(clip!.match(/^M[\d.]+ ([\d.]+)/)?.[1])
        expect(top).toBeGreaterThan(floor)
        const card = await page.locator('.driver-popover').boundingBox()
        const panel = await page.locator('[data-onboarding="settings-panel"]').boundingBox()
        expect(card!.x + card!.width).toBeLessThanOrEqual(panel!.x)
      }
      if (name === '17-tour-task-drawer') {
        const shape = await page
          .locator('[data-onboarding-connected] path')
          .last()
          .getAttribute('d')
        expect(shape!.match(/M/g)!.length).toBeGreaterThanOrEqual(2)
      }
      await capture(page, name)
    }
    await page.locator('.driver-popover-next-btn').click()
    await expect(page.getByText('Practice only', { exact: true })).toBeVisible()
    const projectWrites: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET' && /\/api\/v1\/(projects|cards)/.test(request.url()))
        projectWrites.push(request.url())
    })
    await page.getByLabel('Project name', { exact: true }).fill('Prepare the team workshop')
    await capture(page, '20-practice-project')
    await page.getByRole('button', { name: 'Create example', exact: true }).click()
    await page.getByLabel('Add an individual card', { exact: true }).fill('Prepare the agenda')
    await capture(page, '21-practice-individual-task')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByLabel('Checklist item', { exact: true }).fill('List three discussion topics')
    await page.getByRole('button', { name: 'Add checklist item', exact: true }).click()
    await page.getByRole('checkbox', { name: 'List three discussion topics' }).check()
    await capture(page, '22-practice-checklist')
    await page.getByRole('button', { name: 'Done — continue guide', exact: true }).click()
    for (const name of [
      '22a-personal-calendar',
      '22b-personal-cards',
      '22c-personal-focus',
      '23-tour-events',
      '24-tour-people',
      '24b-colleague-profile',
      '25-tour-structure',
      '25a-tour-organisation-chart',
      '26-tour-checkin',
      '27-tour-checkout',
      '28-tour-help-destination',
    ]) {
      await expect(page.locator('.driver-popover')).toBeVisible()
      if (name === '25a-tour-organisation-chart') {
        await expect(page.locator('[data-onboarding-structure-tab=chart]')).toHaveAttribute(
          'data-state',
          'active',
        )
        const header = await page.locator('[data-onboarding-topbar]').boundingBox()
        const heading = await page
          .getByRole('heading', { name: 'Structure', exact: true })
          .boundingBox()
        expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
        await expect(page.locator('[data-onboarding="structure"]')).toHaveClass(
          /driver-active-element/,
        )
      }
      await capture(page, name)
      if (name !== '28-tour-help-destination') {
        const previous = await page.locator('.driver-popover-title').textContent()
        if (name === '25-tour-structure') await page.setViewportSize({ width: 1707, height: 889 })
        if (name === '25a-tour-organisation-chart')
          await page.setViewportSize({ width: 1440, height: 1000 })
        await page.locator('.driver-popover-next-btn').click()
        await expect(page.locator('.driver-popover-title')).not.toHaveText(previous!)
      }
    }
    await page.locator('.driver-popover-next-btn').click()
    await expect(page.locator('.driver-popover')).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (await (await authedPost(newcomer, '/api/v1/onboarding/session', {})).json()).run
            .tourCompleted,
      )
      .toBe(true)
    expect(projectWrites).toEqual([])
    expect(consoleErrors).toEqual([])
    const card = await (await newcomer.request.get(`/api/v1/cards/${cardId}`)).json()
    expect(card.checklist).toHaveLength(6)
    expect(
      (
        await authedPatch(newcomer, `/api/v1/cards/${cardId}/checklist/${card.checklist[0].id}`, {
          done: false,
        })
      ).status(),
    ).toBe(404)
    expect(
      (
        await newcomer.request.delete(`/api/v1/cards/${cardId}/checklist/${card.checklist[0].id}`, {
          headers: { 'x-csrf-token': await csrfToken(newcomer) },
        })
      ).status(),
    ).toBe(404)
    expect(card.checklist.every((item: { doneAt: string | null }) => item.doneAt !== null)).toBe(
      true,
    )
    await page.goto('/help')
    await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible()
    await capture(page, '29-getting-started-center')
    await page.setViewportSize({ width: 390, height: 844 })
    await capture(page, '30-mobile-getting-started')
    await page.getByRole('button', { name: 'Start guide', exact: true }).click()
    await expect(page.locator('.driver-popover')).toBeVisible()
    await capture(page, '31-mobile-tour')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.driver-popover-close-btn').click()
    await headPage.setViewportSize({ width: 390, height: 844 })
    await capture(headPage, '32-mobile-leave')
    await newcomer.storageState({
      path: resolve(scratch, 'newcomer-state.json'),
    })
    await head.storageState({ path: resolve(scratch, 'head-state.json') })
    writeFileSync(
      resolve(scratch, 'review-accounts.json'),
      JSON.stringify(
        {
          head: headUser,
          cohead: coheadUser,
          member: memberUser,
          newcomer: newcomerUser,
          department,
        },
        null,
        2,
      ),
    )
    writeFileSync(
      resolve(evidence, 'verification.json'),
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          docker: true,
          mockedRoutes: false,
          telegram: 'local verified-link fixture; no live bot contacted',
          projectWrites,
          consoleErrors,
          screenshots: 32,
        },
        null,
        2,
      ),
    )
  } finally {
    await Promise.all([admin, head, cohead, member, newcomer].map((context) => context.close()))
  }
})

test('Docker: mobile chapter replay, keyboard pause, reduced motion, dark theme and four languages', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:48942',
    storageState: resolve(scratch, 'newcomer-state.json'),
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/help')
    await page.getByRole('button', { name: /Your cards/ }).click()
    await expect(page.locator('.driver-popover-title')).toHaveText('Your column')
    for (let n = 0; n < 4; n++) {
      await expect(page.locator('.driver-popover-description')).not.toContainText(
        'unavailable in your current view',
      )
      const box = await page.locator('.driver-popover').boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(391)
      await capture(page, `33-mobile-cards-${n}`)
      const previous = await page.locator('.driver-popover-title').textContent()
      await page.locator('.driver-popover-next-btn').click()
      await expect(page.locator('.driver-popover-title')).not.toHaveText(previous!)
    }
    await page.locator('.driver-popover-next-btn').click()
    await page.getByLabel('Project name', { exact: true }).fill('Team workshop')
    await page.getByRole('button', { name: 'Create example', exact: true }).click()
    await page.getByLabel('Add an individual card', { exact: true }).fill('Prepare agenda')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByLabel('Checklist item', { exact: true }).fill('List topics')
    await page.getByRole('button', { name: 'Add checklist item', exact: true }).click()
    await page.getByRole('checkbox', { name: 'List topics' }).check()
    await capture(page, '34-mobile-practice')
    await page.setViewportSize({ width: 320, height: 568 })
    await expect
      .poll(async () => (await page.getByRole('dialog').boundingBox())!.height)
      .toBeLessThanOrEqual(524)
    await page
      .getByRole('button', { name: 'Done — continue guide', exact: true })
      .scrollIntoViewIfNeeded()
    await capture(page, '34-mobile-practice-small-screen')
    await page.getByRole('button', { name: 'Done — continue guide', exact: true }).click()
    await expect(page.locator('.driver-popover')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.driver-popover')).toHaveCount(0)
    await expect(page).toHaveURL(/\/help$/)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => localStorage.setItem('devon_theme', 'dark'))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible()
    await capture(page, '35-dark-getting-started')
    const accessibility = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    writeFileSync(
      resolve(evidence, 'accessibility.json'),
      JSON.stringify(accessibility.violations, null, 2),
    )
    expect(accessibility.violations).toEqual([])
    for (const locale of ['ru', 'uz-Latn', 'uz-Cyrl', 'en']) {
      expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
      await page.goto('/help')
      await expect(page.locator('main h1')).toBeVisible()
      await capture(page, `36-locale-${locale}`)
      expect(await page.locator('main').innerText()).not.toContain('onboarding.')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('Docker: no published HTML, automatic first-join task, department isolation and setup recovery', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const creator = await newFlowContext(browser)
  const previous = JSON.parse(readFileSync(resolve(scratch, 'review-accounts.json'), 'utf8'))
  const head = await browser.newContext({
    baseURL: 'http://127.0.0.1:48942',
    storageState: resolve(scratch, 'head-state.json'),
  })
  try {
    await loginAsSuperAdmin(admin)
    const created = await user(creator, 'Malika')
    const request = await authedPost(creator, '/api/v1/departments/requests', {
      name: 'New department · Setup edge cases',
      locale: 'en',
      units: [{ name: 'Operations' }],
    })
    expect(request.status()).toBe(201)
    const approved = await admin.request.post(
      `/api/v1/departments/requests/${(await request.json()).id}/approve`,
      { headers: { 'x-csrf-token': await csrfToken(admin) } },
    )
    expect(approved.status()).toBe(200)
    const department = await approved.json()
    await expect
      .poll(
        () =>
          database(
            `select count(*) from app.portal_onboarding where user_id='${created.id}';`,
          ).trim(),
        { timeout: 20_000 },
      )
      .toContain('1')
    const session = await (await authedPost(creator, '/api/v1/onboarding/session', {})).json()
    expect(session.required).toBe(true)
    expect(session.run.documentId).toBeNull()
    expect(session.run.htmlDone).toBe(true)
    const originalCard = session.run.cardId
    const foreignDocuments = await (await head.request.get('/api/v1/onboarding/documents')).json()
    expect(
      (
        await creator.request.get(
          `/api/v1/onboarding/documents/${foreignDocuments.items[0].id}/render`,
        )
      ).status(),
    ).toBe(404)
    expect(
      await (
        await authedPost(creator, '/api/v1/onboarding/session', {
          tourCompleted: true,
        })
      ).json(),
    ).toMatchObject({ required: true, run: { tourCompleted: false } })
    database(
      `insert into app.memberships(user_id,department_id,role,status) values('${created.id}','${previous.department.departmentId}','member','active');`,
    )
    const switched = await authedPost(creator, '/api/v1/me/active-department', {
      departmentId: previous.department.departmentId,
    })
    expect(switched.status()).toBe(200)
    await applySetCookies(creator, switched)
    const away = await (await authedPost(creator, '/api/v1/onboarding/session', {})).json()
    expect(away.resumeDepartmentId).toBe(department.departmentId)
    expect(away.run).toBeNull()
    const page = await creator.newPage()
    await page.goto('/')
    await page
      .getByRole('button', {
        name: 'Return to the department where you started setup',
      })
      .click()
    await expect(page.getByRole('heading', { name: 'Make your account ready' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check and continue' })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    await capture(page, '37-no-file-setup-recovery')
    const restored = await (await authedPost(creator, '/api/v1/onboarding/session', {})).json()
    expect(restored.run.cardId).toBe(originalCard)
    expect((await creator.request.get('/api/v1/cards')).status()).toBe(403)
  } finally {
    await Promise.all([admin, creator, head].map((context) => context.close()))
  }
})

test('Docker: the final guide returns to Home help with a short completion animation', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:48942',
    storageState: resolve(scratch, 'newcomer-state.json'),
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
    recordVideo: {
      dir: resolve(scratch, 'video'),
      size: { width: 1440, height: 1000 },
    },
  })
  const page = await context.newPage()
  try {
    await page.goto('/help')
    await page.getByRole('button', { name: /Progress & your guide/ }).click()
    await expect(page.locator('.driver-popover')).toBeVisible()
    await page.locator('.driver-popover-next-btn').click()
    await expect(page.locator('.driver-popover-title')).toHaveText('Check-out')
    await page.locator('.driver-popover-next-btn').click()
    await expect(page.locator('.driver-popover-title')).toHaveText('Getting started')
    const accessibility = await new AxeBuilder({ page })
      .include('.driver-popover')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(accessibility.violations).toEqual([])
    await expect
      .poll(async () => {
        const outline = await page
          .locator('[data-onboarding-connected] path')
          .last()
          .getAttribute('d')
        const help = await page.locator('[data-onboarding=help]').boundingBox()
        const firstX = Number(outline?.match(/^M([\d.]+)/)?.[1])
        return Boolean(help && firstX >= help.x - 8 && firstX <= help.x + help.width)
      })
      .toBe(true)
    await capture(page, '28a-help-highlight-after-refresh')
    await page.locator('.driver-popover-next-btn').click()
    await expect(page.locator('[data-onboarding-finale]')).toBeVisible()
    await page.waitForFunction(() => {
      const animation = document.querySelector('[data-onboarding-finale]')?.getAnimations()[0]
      return animation && Number(animation.currentTime) > 900
    })
    await page.screenshot({ path: resolve(evidence, '38a-completion-scene.png'), fullPage: true })
    await page.waitForFunction(() => {
      const ring = document.querySelector('.onboarding-landing-ring')
      return ring && Number(getComputedStyle(ring).opacity) > 0.15
    })
    await page.screenshot({
      path: resolve(evidence, '38c-guide-button-landing.png'),
      fullPage: true,
    })
    await expect(page.locator('[data-onboarding-finale]')).toHaveCount(0)
    await expect(page.locator('[data-onboarding=help]')).toBeFocused()
    expect(
      await page
        .locator('[data-onboarding=help]')
        .evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe('none')
    await capture(page, '38-home-help-finished')
  } finally {
    await context.close()
    await page.video()?.saveAs(resolve(evidence, '38-help-finale.webm'))
  }
})

test('Docker: project owners, colleagues and other department members can assign cards; changes enter the audit chain', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const accounts = JSON.parse(readFileSync(resolve(scratch, 'review-accounts.json'), 'utf8'))
  const owner = await newFlowContext(browser),
    colleague = await newFlowContext(browser),
    outsider = await newFlowContext(browser),
    foreign = await newFlowContext(browser)
  try {
    await login(owner, { login: accounts.member.login, password: accounts.member.password })
    const established = await (await authedPost(owner, '/api/v1/onboarding/session', {})).json()
    expect(established).toMatchObject({ required: false, run: null })
    await login(colleague, { login: accounts.newcomer.login, password: accounts.newcomer.password })
    const outsiderUser = await user(outsider, 'Jamshid', true)
    const foreignUser = await user(foreign, 'Outside', true)
    expect(
      (
        await authedPost(outsider, '/api/v1/departments/join', {
          key: accounts.department.joinKey,
          password: accounts.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const result = await authedPost(owner, '/api/v1/projects', {
      title: 'Assignment permissions review',
      ownerUserId: accounts.member.id,
      members: [accounts.member.id, accounts.newcomer.id],
    })
    expect(result.status(), await result.text()).toBe(201)
    const project = await result.json()
    const body = {
      title: 'Owner assigns a colleague',
      projectId: project.id,
      projectScope: 'subjective',
      kind: 'project_task',
      assigneeUserId: accounts.newcomer.id,
    }
    const first = await authedPost(owner, '/api/v1/cards', body)
    expect(first.status(), await first.text()).toBe(201)
    const firstCard = await first.json()
    expect(firstCard.assigneeUserId).toBe(accounts.newcomer.id)
    const page = await colleague.newPage()
    await page.goto(`/projects/view?id=${project.id}`)
    const composer = page.getByLabel('Add an individual card').first()
    await expect(composer).toBeVisible()
    await composer.fill('Colleague assigns the project owner')
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/cards') && r.request().method() === 'POST',
    )
    await composer.press('Enter')
    const second = await saved
    expect(second.status(), await second.text()).toBe(201)
    const secondCard = await second.json()
    expect(secondCard.assigneeUserId).toBe(accounts.member.id)
    expect(secondCard.giverUserId).toBe(accounts.newcomer.id)
    await expect(
      page.getByText('Colleague assigns the project owner', { exact: true }),
    ).toBeVisible()
    await capture(page, '39-non-owner-project-assignment')
    const third = await authedPost(outsider, '/api/v1/cards', {
      ...body,
      title: 'Department colleague contributes',
      assigneeUserId: accounts.member.id,
    })
    expect(third.status(), await third.text()).toBe(201)
    expect(
      (
        await authedPost(owner, '/api/v1/cards', { ...body, assigneeUserId: foreignUser.id })
      ).status(),
    ).toBe(422)
    expect(
      (
        await authedPost(owner, '/api/v1/cards', {
          title: 'Outside project stays self-only',
          assigneeUserId: accounts.newcomer.id,
        })
      ).status(),
    ).toBe(403)
    const receipt = JSON.parse(
      database(
        `select row_to_json(r) from (select actor_user_id, after from audit.events where action='work.card_created' and subject_id='${secondCard.id}' order by seq desc limit 1) r;`,
      ).trim(),
    )
    expect(receipt.actor_user_id).toBe(accounts.newcomer.id)
    expect(receipt.after).toMatchObject({
      projectId: project.id,
      assigneeUserId: accounts.member.id,
      createdByUserId: accounts.newcomer.id,
      giverUserId: accounts.newcomer.id,
    })
    const optionalGuide = await owner.newPage()
    await optionalGuide.goto('/help')
    await optionalGuide.getByRole('button', { name: /Your cards/ }).click()
    for (let step = 0; step < 4; step++) {
      const title = await optionalGuide.locator('.driver-popover-title').textContent()
      await optionalGuide.locator('.driver-popover-next-btn').click()
      await expect(optionalGuide.locator('.driver-popover-title')).not.toHaveText(title!)
      await expect(optionalGuide.locator('.driver-popover-description')).not.toContainText(
        'unavailable in your current view',
      )
    }
    await capture(optionalGuide, '40-existing-member-optional-guide')
    await optionalGuide.keyboard.press('Escape')
    database(`update app.projects set deleted_at=now() where id='${project.id}';`)
    expect((await authedPost(owner, '/api/v1/cards', body)).status()).toBe(422)
    // Exercise the same transaction boundary as all real features, including raw SQL and Drizzle.
    const probe = `import { withContext, closePool } from '/repo/packages/db/src/context.ts';
      import { users } from '/repo/packages/db/src/schema/app.ts';
      import { sql, eq } from '/repo/packages/db/node_modules/drizzle-orm/index.js';
      const ctx={requestId:'audit-fallback-${outsiderUser.id}',userId:'${outsiderUser.id}',actorRole:'member',departmentRole:'member',departmentId:'${accounts.department.departmentId}',actingForUserId:null,viewAs:false,ip:'127.0.0.1',userAgent:'local audit verification'};
      await withContext(ctx, tx=>tx.raw(sql\`update app.users set updated_at=updated_at where id=\${ctx.userId} returning id\`));
      await withContext({...ctx,requestId:ctx.requestId+'-drizzle'}, tx=>tx.drizzle.update(users).set({givenName:'Jamshid'}).where(eq(users.id,ctx.userId)));
      try { await withContext({...ctx,requestId:ctx.requestId+'-rollback'},async tx=>{await tx.raw(sql\`update app.users set given_name='must roll back' where id=\${ctx.userId}\`);throw new Error('expected rollback')}) } catch(e) {if(e.message!=='expected rollback')throw e}
      await closePool();`
    const check = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        'devon-onboarding-review-api-1',
        'node',
        '--import',
        'tsx',
        '--input-type=module',
      ],
      { input: probe, encoding: 'utf8', timeout: 20_000 },
    )
    expect(check.status, check.stderr).toBe(0)
    const audit = JSON.parse(
      database(
        `select json_build_object('fallbacks',(select count(*) from audit.events where request_id in ('audit-fallback-${outsiderUser.id}','audit-fallback-${outsiderUser.id}-drizzle') and action='data.record.updated'),'rolledBack',(select count(*) from audit.events where request_id='audit-fallback-${outsiderUser.id}-rollback'),'name',(select given_name from app.users where id='${outsiderUser.id}'));`,
      ).trim(),
    )
    expect(audit).toEqual({ fallbacks: 2, rolledBack: 0, name: 'Jamshid' })
    const verified = JSON.parse(
      database('select row_to_json(v) from audit.verify_chain(1,null) v;').trim(),
    )
    expect(verified.ok).toBe(true)
    expect(verified.rows_checked).toBeGreaterThan(0)
    writeFileSync(
      resolve(evidence, 'assignment-audit-verification.json'),
      JSON.stringify(
        {
          owner: true,
          nonOwner: true,
          nonParticipant: true,
          foreignAssigneeBlocked: true,
          deletedProjectBlocked: true,
          attribution: receipt,
          atomicFallback: audit,
          chain: verified,
        },
        null,
        2,
      ),
    )
  } finally {
    await Promise.all([owner, colleague, outsider, foreign].map((c) => c.close()))
  }
})

test('Docker: audit categories include onboarding and saved-change receipts with an intact chain', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    expect((await authedPatch(admin, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await admin.newPage()
    await page.goto('/admin/audit')
    await page.getByRole('button', { name: 'Getting started', exact: true }).click()
    await expect(
      page.getByText('advanced through the portal guide', { exact: true }).first(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Verify chain', exact: true }).click()
    await expect(page.getByText('Chain intact', { exact: true })).toBeVisible()
    await capture(page, '41-audit-new-onboarding-actions')
    await page.getByRole('button', { name: 'Other saved changes', exact: true }).click()
    await expect(page.getByText('updated saved data', { exact: true }).first()).toBeVisible()
    await capture(page, '42-audit-fallback-receipts')
  } finally {
    await admin.close()
  }
})
