import { test, expect, type BrowserContext, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { publicDashboardSchema } from '@devon/contracts'
import {
  authedPost,
  authedPatch,
  csrfToken,
  newFlowContext,
  registerUser,
  uniqueLogin,
  examplePassword,
  loginAsSuperAdmin,
} from './flow-api.js'

const evidence = resolve(import.meta.dirname, '../../../../artifacts/qa/onboarding')
const appearance = (locator: Locator, properties: string[]) =>
  locator.evaluate((el, keys) => {
    const style = getComputedStyle(el)
    // Tailwind reserves transparent zero-sized shadow slots for keyboard rings; they render nothing.
    return Object.fromEntries(
      keys.map((key) => [
        key,
        style.getPropertyValue(key).replaceAll('rgba(0, 0, 0, 0) 0px 0px 0px 0px, ', ''),
      ]),
    )
  }, properties)
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
    { input: statement, encoding: 'utf8', timeout: 15000 },
  )
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
test('Docker: public dashboard permissions, isolated views, expiry and revocation', async ({
  browser,
}) => {
  test.setTimeout(180000)
  mkdirSync(evidence, { recursive: true })
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    cohead = await newFlowContext(browser),
    member = await newFlowContext(browser),
    outsider = await newFlowContext(browser),
    anonymous = await newFlowContext(browser)
  const contexts = [admin, head, cohead, member, outsider, anonymous]
  async function person(context: BrowserContext, givenName: string, familyName: string) {
    const credentials = {
      login: uniqueLogin('public.review'),
      password: examplePassword(),
      givenName,
      familyName,
    }
    await registerUser(context, credentials)
    const me = await (await context.request.get('/api/v1/me')).json()
    database(`update app.users set onboarding_required=false where id='${me.user.id}';`)
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    return me.user.id as string
  }
  try {
    await loginAsSuperAdmin(admin)
    const headId = await person(head, 'Anvar', 'Karimov'),
      coheadId = await person(cohead, 'Nodira', 'Azimova'),
      memberId = await person(member, 'Aziza', 'Rahimova'),
      outsiderId = await person(outsider, 'Foreign', 'Department')
    async function department(context: BrowserContext, name: string) {
      const request = await authedPost(context, '/api/v1/departments/requests', {
        name,
        locale: 'en',
        units: [{ name: 'Service delivery' }],
      })
      expect(request.status(), await request.text()).toBe(201)
      const approval = await admin.request.post(
        `/api/v1/departments/requests/${(await request.json()).id}/approve`,
        { headers: { 'x-csrf-token': await csrfToken(admin) } },
      )
      expect(approval.status(), await approval.text()).toBe(200)
      return approval.json()
    }
    const dept = await department(head, 'Digital Services Department'),
      foreign = await department(outsider, 'Private foreign department')
    for (const context of [cohead, member])
      expect(
        (
          await authedPost(context, '/api/v1/departments/join', {
            key: dept.joinKey,
            password: dept.joinPassword,
          })
        ).status(),
      ).toBe(200)
    const membership = (
      await (await head.request.get(`/api/v1/departments/${dept.departmentId}/members`)).json()
    ).members.find((m: { userId: string }) => m.userId === coheadId)
    expect(
      (
        await authedPatch(
          head,
          `/api/v1/departments/${dept.departmentId}/members/${coheadId}/role`,
          { role: 'head', expectedVersion: membership.version },
        )
      ).status(),
    ).toBe(204)
    const unit = database(
      `select id from app.units where department_id='${dept.departmentId}' and deleted_at is null limit 1;`,
    )
    database(
      `insert into app.unit_roles(department_id,unit_id,user_id,role,assigned_by) values ('${dept.departmentId}','${unit}','${memberId}','member','${headId}');`,
    )
    const titles = [
      'Review citizen feedback',
      'Prepare the service delivery report',
      'Update the application checklist',
      'Confirm next week’s service schedule',
      'Review digital service accessibility',
      'Share the progress update',
    ]
    const cardIds: string[] = []
    for (const [i, title] of titles.entries()) {
      const card = await authedPost(head, '/api/v1/cards', {
        title,
        assigneeUserId: [headId, coheadId, memberId][i % 3],
        description: 'PRIVATE_DESCRIPTION_SENTINEL',
      })
      expect(card.status(), await card.text()).toBe(201)
      const id = (await card.json()).id
      cardIds.push(id)
      if (i % 2 === 0) database(`update app.cards set work_stage='in_progress' where id='${id}';`)
    }
    const hidden = await authedPost(outsider, '/api/v1/cards', {
      title: 'FOREIGN_CARD_SENTINEL',
      assigneeUserId: outsiderId,
    })
    expect(hidden.status()).toBe(201)
    const path = `/api/v1/departments/${dept.departmentId}/public-links`
    for (const context of [member, outsider, anonymous]) {
      expect((await context.request.get(path)).status()).toBe(context === anonymous ? 401 : 403)
      const denied =
        context === anonymous
          ? await context.request.post(path, { data: { label: 'Forbidden', days: 30 } })
          : await authedPost(context, path, { label: 'Forbidden', days: 30 })
      expect(denied.status()).toBe(context === anonymous ? 401 : 403)
    }
    expect((await head.request.post(path, { data: { label: 'No CSRF', days: 30 } })).status()).toBe(
      403,
    )
    expect((await authedPost(head, path, { label: 'Invalid expiry', days: 1 })).status()).toBe(422)
    const coCreated = await authedPost(cohead, path, { label: 'Co-head link', days: 7 })
    expect(coCreated.status()).toBe(201)
    const coLink = await coCreated.json()
    expect(
      (
        await head.request.delete(`${path}/${coLink.id}`, {
          headers: { 'x-csrf-token': await csrfToken(head) },
        })
      ).status(),
    ).toBe(204)
    const foreignCreated = await authedPost(
      outsider,
      `/api/v1/departments/${foreign.departmentId}/public-links`,
      { label: 'Foreign link', days: 7 },
    )
    expect(foreignCreated.status()).toBe(201)
    const foreignLink = await foreignCreated.json()
    expect(
      (
        await head.request.delete(`${path}/${foreignLink.id}`, {
          headers: { 'x-csrf-token': await csrfToken(head) },
        })
      ).status(),
    ).toBe(404)
    const management = await head.newPage()
    await management.goto('/work')
    const originalCard = management.locator(`[data-dnd-card="${cardIds[0]}"]`)
    await expect(originalCard).toBeVisible()
    await management.evaluate(() => document.fonts.ready)
    const cardProperties = [
      'padding-top',
      'padding-bottom',
      'padding-left',
      'padding-right',
      'border-radius',
      'border-color',
      'background-color',
      'min-height',
      'box-shadow',
    ]
    const titleProperties = ['font-family', 'font-size', 'font-weight', 'line-height', 'color']
    const portalCard = await appearance(originalCard, cardProperties)
    const portalTitle = await appearance(
      originalCard.locator('[data-onboarding-card-open]'),
      titleProperties,
    )
    const portalColumn = await appearance(management.locator(`[data-board-column="${headId}"]`), [
      'width',
      'background-color',
      'border-top-color',
    ])
    await management.screenshot({
      path: resolve(evidence, '60-main-board-style-reference.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await management.goto(`/department?id=${dept.departmentId}&tab=public`)
    await management.getByLabel('Link name', { exact: true }).fill('Weekly work overview')
    const created = management.waitForResponse(
      (r) => r.url().endsWith('/public-links') && r.request().method() === 'POST',
    )
    await management.getByRole('button', { name: 'Create link', exact: true }).click()
    const createdResponse = await created
    expect(createdResponse.status(), await createdResponse.text()).toBe(201)
    const link = await createdResponse.json()
    const href = await management.getByLabel('Public link', { exact: true }).inputValue()
    expect(href).toBe(`http://127.0.0.1:48942/view/#${link.token}`)
    await management.screenshot({
      path: resolve(evidence, '61-public-link-management.png'),
      fullPage: true,
      animations: 'disabled',
    })
    const list = await (await cohead.request.get(path)).json()
    expect(list.some((item: { id: string }) => item.id === link.id)).toBe(true)
    expect(JSON.stringify(list)).not.toContain(link.token)
    expect(JSON.stringify(list)).not.toContain('token_hash')
    const headers = { authorization: `Bearer ${link.token}` }
    const publicRead = () => anonymous.request.get('/api/v1/public-dashboard', { headers })
    const response = await publicRead()
    expect(response.status(), await response.text()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(response.headers()['referrer-policy']).toBe('no-referrer')
    const data = publicDashboardSchema.parse(await response.json())
    expect(data.cards).toHaveLength(6)
    expect(data.members.filter((m) => m.head)).toHaveLength(2)
    const serialized = JSON.stringify(data)
    for (const forbidden of [
      'PRIVATE_DESCRIPTION_SENTINEL',
      'FOREIGN_CARD_SENTINEL',
      headId,
      coheadId,
      memberId,
      ...cardIds,
      dept.departmentId,
      foreign.departmentId,
      'email',
      'avatar',
      'description',
      'profile',
      'permissions',
    ])
      expect(serialized).not.toContain(forbidden)
    const signedData = await (
      await head.request.get('/api/v1/public-dashboard', { headers })
    ).json()
    expect({ ...signedData, updatedAt: '' }).toEqual({ ...data, updatedAt: '' })
    expect((await head.request.get('/api/v1/public-dashboard')).status()).toBe(404)
    expect((await anonymous.request.get('/api/v1/public-dashboard')).status()).toBe(404)
    expect(
      (
        await anonymous.request.get('/api/v1/public-dashboard', {
          headers: { authorization: `Bearer ${'x'.repeat(43)}` },
        })
      ).status(),
    ).toBe(404)
    expect(
      (
        await anonymous.request.get(
          '/api/v1/public-dashboard?departmentId=' + foreign.departmentId,
          { headers },
        )
      ).status(),
    ).toBe(422)
    for (const privatePath of [
      '/api/v1/me',
      '/api/v1/cards',
      `/api/v1/cards/${cardIds[0]}`,
      '/api/v1/structure',
      path,
    ])
      expect(
        (await anonymous.request.get(privatePath, { headers })).status(),
      ).toBeGreaterThanOrEqual(400)
    for (const method of ['POST', 'PATCH', 'DELETE'])
      expect(
        (
          await anonymous.request.fetch('/api/v1/public-dashboard', {
            method,
            headers,
            data: { title: 'Forbidden write' },
          })
        ).status(),
      ).toBeGreaterThanOrEqual(400)
    const publicPage = await anonymous.newPage(),
      errors: string[] = [],
      requests: string[] = []
    publicPage.on('pageerror', (e) => errors.push(e.message))
    publicPage.on('request', (r) => requests.push(r.url()))
    await publicPage.goto(href)
    await expect(publicPage.locator('.board')).toBeVisible()
    await publicPage.evaluate(() => document.fonts.ready)
    expect(
      await publicPage.evaluate(
        () =>
          document.fonts.check('13px "Devon Sans"') && document.fonts.check('30px "Devon Display"'),
      ),
    ).toBe(true)
    await expect(publicPage.getByText('View only', { exact: true })).toHaveCount(0)
    await expect(publicPage.getByText('Work across the team', { exact: true })).toHaveCount(0)
    await expect(publicPage.locator('.dashboard-metrics .metric')).toHaveCount(3)
    await expect(publicPage.locator('.dashboard-metrics')).toContainText('Active cards')
    await expect(publicPage.locator('.dashboard-metrics')).toContainText('People')
    await expect(publicPage.locator('.dashboard-metrics')).toContainText('Last updated')
    await expect(publicPage.locator('.language-flag')).toBeVisible()
    await publicPage.getByRole('combobox', { name: 'Language' }).selectOption('ru')
    await expect(publicPage.getByRole('tab', { name: 'Карточки', exact: true })).toBeVisible()
    await publicPage.getByRole('combobox', { name: 'Язык' }).selectOption('uz-Latn')
    await expect(publicPage.getByRole('tab', { name: 'Kartochkalar', exact: true })).toBeVisible()
    await publicPage.getByRole('combobox', { name: 'Til' }).selectOption('uz-Cyrl')
    await expect(publicPage.getByRole('tab', { name: 'Карточкалар', exact: true })).toBeVisible()
    await publicPage.getByRole('combobox', { name: 'Тил' }).selectOption('en')
    const publicCard = publicPage.locator('.work-card').filter({ hasText: titles[0]! })
    expect(await appearance(publicCard, cardProperties)).toEqual(portalCard)
    expect(await appearance(publicCard.locator('h4'), titleProperties)).toEqual(portalTitle)
    expect(
      await appearance(publicPage.locator('.column').filter({ hasText: 'Anvar Karimov' }), [
        'width',
        'background-color',
        'border-top-color',
      ]),
    ).toEqual(portalColumn)
    await expect(publicPage.getByRole('tab')).toHaveCount(2)
    await expect(publicPage.locator('a,aside,[role=dialog],input')).toHaveCount(0)
    await publicPage.getByText(titles[0]!, { exact: true }).click()
    await expect(publicPage.locator('[role=dialog]')).toHaveCount(0)
    expect(publicPage.url()).toBe(href)
    await publicPage.screenshot({
      path: resolve(evidence, '62-public-cards-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    const accessibility = await new AxeBuilder({ page: publicPage }).analyze()
    expect(
      accessibility.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([])
    await publicPage.getByRole('tab', { name: 'Structure', exact: true }).click()
    await expect(
      publicPage.getByRole('heading', { name: 'Service delivery', exact: true }),
    ).toBeVisible()
    await expect(publicPage.getByText('Aziza Rahimova', { exact: true })).toBeVisible()
    await expect(publicPage.getByText(/org chart|organizational chart/i)).toHaveCount(0)
    await publicPage.screenshot({
      path: resolve(evidence, '63-public-structure-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    expect((await new AxeBuilder({ page: publicPage }).analyze()).violations).toEqual([])
    await publicPage.setViewportSize({ width: 390, height: 844 })
    await publicPage.screenshot({
      path: resolve(evidence, '64-public-structure-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await publicPage.getByRole('tab', { name: 'Cards', exact: true }).click()
    await publicPage.screenshot({
      path: resolve(evidence, '65-public-cards-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await publicPage.setViewportSize({ width: 320, height: 740 })
    expect(
      await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true)
    await publicPage.setViewportSize({ width: 390, height: 844 })
    expect(
      await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true)
    await publicPage.locator('.board').focus()
    await publicPage.keyboard.press('End')
    await expect
      .poll(() => publicPage.locator('.board').evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0)
    const signedPage = await head.newPage()
    const publicRequest = signedPage.waitForRequest((r) =>
      r.url().endsWith('/api/v1/public-dashboard'),
    )
    await signedPage.goto(href)
    await expect(signedPage.locator('.board')).toBeVisible()
    expect((await (await publicRequest).allHeaders())['cookie']).toBeUndefined()
    await expect(signedPage.locator('a,aside,[role=dialog],input')).toHaveCount(0)
    await signedPage.goto(href.replace('/view/', '/view/work/'))
    await expect(
      signedPage.getByRole('heading', { name: 'This link is unavailable' }),
    ).toBeVisible()
    await expect(signedPage.locator('a,aside')).toHaveCount(0)
    expect((await head.request.get('/api/v1/me')).status()).toBe(200)
    await signedPage.goto('/department?id=' + dept.departmentId)
    await expect(signedPage.getByRole('tab', { name: 'Members', exact: true })).toBeVisible()
    // Public assets contain neither the private app nor its translation catalogue.
    for (const url of requests.filter((u) => u.includes('/view/assets/') && u.endsWith('.js'))) {
      const bundle = await (await anonymous.request.get(url)).text()
      for (const privateFeature of [
        '/api/v1/accounts',
        '/api/v1/onboarding',
        'ai.assistant',
        'departments.settings',
        '/api/v1/admin',
      ])
        expect(bundle).not.toContain(privateFeature)
    }
    expect(
      requests
        .filter((u) => u.includes('/api/'))
        .every((u) => u.endsWith('/api/v1/public-dashboard')),
    ).toBe(true)
    expect(requests.every((u) => !u.includes(link.token))).toBe(true)
    // Stored markup is text, never active content; done/archived/deleted work is excluded.
    database(
      `update app.cards set title='<img src=x onerror=alert(1)>' where id='${cardIds[0]}'; update app.cards set archived_at=now() where id='${cardIds[1]}'; update app.cards set deleted_at=now() where id='${cardIds[2]}'; update app.cards set status='done' where id='${cardIds[3]}';`,
    )
    await publicPage.reload()
    await expect(
      publicPage.getByText('<img src=x onerror=alert(1)>', { exact: true }),
    ).toBeVisible()
    await expect(publicPage.locator('img')).toHaveCount(0)
    expect((await (await publicRead()).json()).cards).toHaveLength(3)
    database(
      `update app.cards set title='Review citizen feedback' where id='${cardIds[0]}'; update app.cards set archived_at=null,deleted_at=null,status='active' where id in ('${cardIds[1]}','${cardIds[2]}','${cardIds[3]}');`,
    )
    // An existing signed-in account never bypasses token expiry or publisher eligibility.
    for (const [invalidate, restore] of [
      [
        `update app.public_dashboard_links set expires_at=now()-interval '1 minute' where id='${link.id}'`,
        `update app.public_dashboard_links set expires_at=now()+interval '30 days' where id='${link.id}'`,
      ],
      [
        `update app.memberships set role='member' where user_id='${headId}' and department_id='${dept.departmentId}'`,
        `update app.memberships set role='head' where user_id='${headId}' and department_id='${dept.departmentId}'`,
      ],
      [
        `update app.users set status='locked' where id='${headId}'`,
        `update app.users set status='active' where id='${headId}'`,
      ],
      [
        `update app.departments set status='paused_by_admin' where id='${dept.departmentId}'`,
        `update app.departments set status='active' where id='${dept.departmentId}'`,
      ],
    ]) {
      database(invalidate! + ';')
      try {
        expect((await publicRead()).status()).toBe(404)
        expect((await cohead.request.get('/api/v1/public-dashboard', { headers })).status()).toBe(
          404,
        )
      } finally {
        database(restore! + ';')
      }
      expect((await publicRead()).status()).toBe(200)
    }
    expect(
      (
        await outsider.request.delete(`${path}/${link.id}`, {
          headers: { 'x-csrf-token': await csrfToken(outsider) },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await member.request.delete(`${path}/${link.id}`, {
          headers: { 'x-csrf-token': await csrfToken(member) },
        })
      ).status(),
    ).toBe(403)
    const coPage = await cohead.newPage()
    await publicPage.clock.install()
    await publicPage.reload()
    await expect(publicPage.locator('.board')).toBeVisible()
    await coPage.goto(`/department?id=${dept.departmentId}&tab=public`)
    await coPage.getByRole('button', { name: 'Close link', exact: true }).click()
    await coPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Close link', exact: true })
      .click()
    await expect(
      coPage
        .getByRole('listitem')
        .filter({ hasText: 'Weekly work overview' })
        .getByText('Closed', { exact: true }),
    ).toBeVisible()
    expect((await publicRead()).status()).toBe(404)
    await publicPage.clock.fastForward(31000)
    await expect(
      publicPage.getByRole('heading', { name: 'This link is unavailable' }),
    ).toBeVisible()
    await expect(publicPage.locator('.work-card,.structure-list')).toHaveCount(0)
    await publicPage.screenshot({
      path: resolve(evidence, '66-public-link-closed.png'),
      fullPage: true,
      animations: 'disabled',
    })
    const audit = database(
      `select action from audit.events where subject_id='${link.id}' order by at;`,
    )
    expect(audit).toContain('departments.public_dashboard_created')
    expect(audit).toContain('departments.public_dashboard_revoked')
    const auditDetails = database(
      `select row_to_json(e)::text from audit.events e where subject_id='${link.id}';`,
    )
    expect(auditDetails).not.toContain(link.token)
    expect(auditDetails).not.toContain(
      database(`select token_hash from app.public_dashboard_links where id='${link.id}';`),
    )
    expect(errors).toEqual([])
    // Leave an active local-only example for review; do not publish or send it anywhere.
    const demo = await authedPost(head, path, { label: 'Local dashboard review', days: 7 })
    expect(demo.status()).toBe(201)
    const demoLink = await demo.json()
    writeFileSync(
      resolve(evidence, 'public-dashboard-review.json'),
      JSON.stringify(
        {
          url: `http://127.0.0.1:48942/view/#${demoLink.token}`,
          managementUrl: `http://127.0.0.1:48942/department?id=${dept.departmentId}&tab=public`,
          completedAt: new Date().toISOString(),
          checks:
            'Head-only publication, co-head revocation, tenant isolation, field allowlist, cookie isolation, no private bundles, CSRF, XSS, expiry, disabled publisher, paused department, responsive views, accessibility',
          errors,
        },
        null,
        2,
      ),
    )
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
