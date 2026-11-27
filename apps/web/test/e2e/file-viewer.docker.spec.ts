/* eslint-disable no-restricted-syntax -- Requests and UI interactions depend on earlier saved state. */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import AxeBuilder from '@axe-core/playwright'
import {
  authedPatch,
  authedPost,
  csrfToken,
  examplePassword,
  login,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'

const fixtures = resolve(import.meta.dirname, 'fixtures/file-viewer')
const evidence = resolve(import.meta.dirname, '../../../../artifacts/qa/file-viewer')
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
  if (result.status !== 0) throw new Error('Review fixture update failed: ' + result.stderr)
  return result.stdout
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  // Let the app's short spring transitions settle before capturing the final layout.
  await page.waitForTimeout(350)
  await page.screenshot({
    path: resolve(evidence, name + '.png'),
    animations: 'disabled',
  })
}
async function upload(context: BrowserContext, pageId: string, name: string) {
  return uploadBytes(context, pageId, name, readFileSync(resolve(fixtures, name)))
}
async function uploadBytes(context: BrowserContext, pageId: string, name: string, data: Buffer) {
  const base = `/api/v1/pages/${pageId}/attachments`
  const signedResponse = await authedPost(context, `${base}/upload-url`, {
    name,
    size: data.length,
  })
  expect(signedResponse.status(), await signedResponse.text()).toBe(201)
  const signed = await signedResponse.json()
  expect(signed.url).toMatch(/^\/api\/v1\/storage\/uploads\?token=/)
  expect((await context.request.put(signed.url, { headers: signed.headers, data })).ok()).toBe(true)
  const finalized = await authedPost(context, `${base}/${signed.uploadId}/finalize`, {})
  expect(finalized.status(), await finalized.text()).toBe(200)
  return `${base}/${signed.uploadId}/download`
}

test('Pages files open inside the portal, archives stay isolated, and changes are reviewable', async ({
  browser,
}) => {
  mkdirSync(evidence, { recursive: true })
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const outsider = await newFlowContext(browser)
  const credentials = {
    login: uniqueLogin('file.review'),
    password: examplePassword(),
  }
  try {
    await loginAsSuperAdmin(admin)
    await registerUser(head, {
      ...credentials,
      givenName: 'Nodira',
      familyName: 'Review',
    })
    const me = await (await head.request.get('/api/v1/me')).json()
    database(`update app.users set onboarding_required=false where id='${me.user.id}';`)
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const requested = await authedPost(head, '/api/v1/departments/requests', {
      name: 'Digital services · File viewer review',
      locale: 'en',
      units: [{ name: 'Research and analysis' }],
    })
    expect(requested.status()).toBe(201)
    const approved = await admin.request.post(
      `/api/v1/departments/requests/${(await requested.json()).id}/approve`,
      { headers: { 'x-csrf-token': await csrfToken(admin) } },
    )
    expect(approved.status()).toBe(200)
    const department = await approved.json()
    const created = await authedPost(head, '/api/v1/pages', {
      kind: 'how_we_work',
      title: 'Department library',
      blocks: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Working documents, reference material and shared files. Select a file below to read it here.',
              },
            ],
          },
        ],
      },
    })
    expect(created.status()).toBe(201)
    const pageId = (await created.json()).id
    const names = [
      'Service-review.pdf',
      'Working-notes.docx',
      'Cycle-overview.xlsx',
      'Department-pack.zip',
      'Department-pack.rar',
      'Team-overview.png',
      'Welcome.html',
      'Team-briefing.pptx',
      'Data.csv',
      'Readme.txt',
      'Short-audio.wav',
      'Protected.zip',
      'Protected.rar',
      'Example-script.bat',
      'Unknown-format.xyz',
      'Unsafe-path.zip',
      'Broken.pdf',
      'Paginated-notes.docx',
      'Protected.pdf',
      'Long-review.pdf',
    ]
    let protectedUrl = ''
    for (const name of names) {
      const url = await upload(head, pageId, name)
      if (!protectedUrl) protectedUrl = url
    }
    expect((await outsider.request.get(protectedUrl)).status()).toBe(401)
    const htmlEndpoint = protectedUrl.replace(/\/download$/, '/preview/html')
    const officeEndpoint = protectedUrl.replace(/\/download$/, '/preview/office')
    expect((await outsider.request.get(htmlEndpoint)).status()).toBe(401)
    await registerUser(outsider, {
      login: uniqueLogin('file.outsider'),
      password: examplePassword(),
      givenName: 'Outside',
      familyName: 'Review',
    })
    expect([403, 404]).toContain((await outsider.request.get(protectedUrl)).status())
    expect([403, 404]).toContain((await outsider.request.get(htmlEndpoint)).status())
    const officeBody = {
      name: 'Working-notes.docx',
      data: readFileSync(resolve(fixtures, 'Working-notes.docx')).toString('base64'),
    }
    expect((await head.request.post(officeEndpoint, { data: officeBody })).status()).toBe(403)
    expect([403, 404]).toContain((await authedPost(outsider, officeEndpoint, officeBody)).status())
    expect(
      (
        await authedPost(head, officeEndpoint, {
          name: 'Fake.docx',
          data: Buffer.from('not a document').toString('base64'),
        })
      ).status(),
    ).toBe(422)
    const shell = await head.request.get(htmlEndpoint)
    expect(shell.status()).toBe(200)
    expect(shell.headers()['content-security-policy']).toContain("connect-src 'none'")
    expect(shell.headers()['content-security-policy']).not.toContain('allow-same-origin')
    writeFileSync(
      resolve(scratch, 'file-viewer-account.json'),
      JSON.stringify({
        ...credentials,
        pageId,
        departmentId: department.departmentId,
      }),
    )
    await head.storageState({
      path: resolve(scratch, 'file-viewer-state.json'),
    })
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const outbound: string[] = []
    const blockedOutbound: string[] = []
    const completedOutbound: string[] = []
    page.on('request', (request) => {
      if (/example\.invalid/.test(request.url())) outbound.push(request.url())
    })
    page.on('console', (message) => {
      if (
        /example\.invalid/.test(message.text()) &&
        message.text().includes('Content Security Policy') &&
        message.text().includes('blocked')
      )
        blockedOutbound.push(message.text())
    })
    page.on('requestfinished', (request) => {
      if (/example\.invalid/.test(request.url())) completedOutbound.push(request.url())
    })
    await page.goto(`/pages?page=${pageId}`)
    await expect(
      page.getByRole('button', {
        name: 'Open Service-review.pdf',
        exact: true,
      }),
    ).toBeVisible()
    await capture(page, '01-pages-library')
    await page.getByRole('button', { name: 'Open Service-review.pdf', exact: true }).click()
    const viewer = page.getByRole('dialog', {
      name: 'File viewer',
      exact: true,
    })
    await expect(viewer.locator('.file-viewer-sidebar [aria-current="true"]')).toBeInViewport()
    const select = async (name: string) => {
      await viewer
        .locator('.file-viewer-sidebar')
        .getByRole('button')
        .filter({ hasText: name })
        .click()
    }
    await expect(viewer.locator('canvas').first()).toBeVisible()
    await expect
      .poll(() =>
        viewer
          .locator('canvas')
          .first()
          .evaluate((node) => (node as HTMLCanvasElement).width),
      )
      .toBeGreaterThan(100)
    await capture(page, '02-pdf')
    await viewer.locator('.file-pdf-surface').hover()
    await page.mouse.wheel(0, 1800)
    await expect(viewer.getByLabel('Page number', { exact: true })).toHaveValue('2')
    await capture(page, '02b-pdf-continuous-scroll')
    await viewer.getByRole('button', { name: 'Find in document', exact: true }).click()
    await viewer.getByRole('searchbox', { name: 'Find in document', exact: true }).fill('service')
    await expect(viewer.locator('.file-findbar [role="status"]')).not.toHaveText('0 / 0')
    await capture(page, '02c-pdf-search')
    await select('Working-notes.docx')
    await expect(
      viewer.locator('.textLayer').getByText('Department working notes', { exact: true }),
    ).toBeVisible({ timeout: 60_000 })
    await capture(page, '03-word')
    await select('Paginated-notes.docx')
    await expect
      .poll(() => viewer.locator('.pdfViewer > .page').count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(2)
    await viewer.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('0.75')
    await viewer.getByLabel('Page number', { exact: true }).fill('2')
    await viewer.getByLabel('Page number', { exact: true }).press('Enter')
    await expect(
      viewer.locator('.textLayer').getByText('Second-page review', { exact: true }),
    ).toBeVisible()
    await capture(page, '03b-word-page-breaks')
    await select('Cycle-overview.xlsx')
    await expect(viewer.getByRole('tab', { name: 'Cycle overview', exact: true })).toBeVisible()
    await expect(viewer.getByRole('cell', { name: 'Digital services', exact: true })).toBeVisible()
    await capture(page, '04-spreadsheet')
    await viewer.getByRole('tab', { name: 'Definitions', exact: true }).click()
    await expect(
      viewer.getByRole('cell', {
        name: 'Agreed result delivered',
        exact: true,
      }),
    ).toBeVisible()
    await select('Department-pack.zip')
    await expect(
      viewer.locator('.file-archive-entry').filter({ hasText: 'Documents' }),
    ).toBeVisible()
    await capture(page, '05-zip-folders')
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Documents' }).click()
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Working-notes.docx' }).click()
    await expect(
      viewer.locator('.textLayer').getByText('Department working notes', { exact: true }),
    ).toBeVisible({ timeout: 60_000 })
    await expect(viewer.getByRole('link', { name: 'Download archive', exact: true })).toBeVisible()
    await expect(
      viewer.getByRole('link', { name: 'Download this file', exact: true }),
    ).toBeVisible()
    await capture(page, '06-word-inside-zip')
    await viewer.getByRole('button', { name: 'Archive root folder', exact: true }).click()
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Examples' }).click()
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Nested.zip' }).click()
    await viewer.locator('.file-archive-entry').filter({ hasText: 'notes' }).click()
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Readme.txt' }).click()
    await expect(viewer.locator('pre')).toContainText('No file is edited or executed')
    await capture(page, '07-nested-archive')
    await select('Department-pack.rar')
    await expect(
      viewer.locator('.file-archive-entry').filter({ hasText: 'Service-review.pdf' }),
    ).toBeVisible()
    await capture(page, '08-rar')
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Readme.txt' }).click()
    await expect(viewer.locator('pre')).toContainText('WorkPortal file viewer')
    await select('Welcome.html')
    await expect(
      viewer.frameLocator('iframe').getByRole('heading', { name: 'A useful place to start.' }),
    ).toBeVisible()
    await expect(viewer.locator('iframe')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-popups allow-popups-to-escape-sandbox',
    )
    await viewer
      .frameLocator('iframe')
      .getByRole('button', { name: 'Show the next section', exact: true })
      .click()
    await expect(viewer.frameLocator('iframe').getByRole('status')).toHaveText(
      'The next section is open.',
    )
    await expect(
      viewer.frameLocator('iframe').getByRole('link', { name: 'Open the reference' }),
    ).toHaveAttribute('target', '_blank')
    expect(await page.locator('body').getAttribute('data-preview-escaped')).toBeNull()
    await expect
      .poll(() => outbound.every((url) => blockedOutbound.some((message) => message.includes(url))))
      .toBe(true)
    expect(completedOutbound).toEqual([])
    expect(await page.evaluate(() => localStorage.getItem('viewer-escape'))).toBeNull()
    await capture(page, '09-html')
    await select('Team-overview.png')
    await expect(viewer.locator('.file-image-surface img')).toBeVisible()
    await capture(page, '10-image')
    await select('Team-briefing.pptx')
    await expect(
      viewer.locator('.textLayer').getByText('Digital services', { exact: true }),
    ).toBeVisible({ timeout: 60_000 })
    await capture(page, '11-presentation')
    await select('Data.csv')
    await expect(viewer.getByRole('cell', { name: 'Research', exact: true })).toBeVisible()
    await select('Short-audio.wav')
    await expect(viewer.locator('audio')).toBeVisible()
    await capture(page, '12-audio')
    await select('Protected.zip')
    await expect(
      viewer.locator('.file-archive-entry').filter({ hasText: 'Readme.txt' }),
    ).toBeVisible()
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Readme.txt' }).click()
    await expect(viewer.getByLabel('Enter the file password', { exact: true })).toBeVisible()
    await viewer.getByLabel('Enter the file password', { exact: true }).fill('WrongExamplePassword')
    await viewer.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(viewer.getByLabel('Enter the file password', { exact: true })).toBeVisible()
    await viewer.getByLabel('Enter the file password', { exact: true }).fill('ReviewExample123')
    await viewer.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(viewer.locator('pre')).toContainText('WorkPortal file viewer')
    await select('Protected.rar')
    await viewer.locator('.file-archive-entry').filter({ hasText: 'Readme.txt' }).click()
    await expect(viewer.getByLabel('Enter the file password', { exact: true })).toBeVisible()
    await viewer.getByLabel('Enter the file password', { exact: true }).fill('ReviewExample123')
    await viewer.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(viewer.locator('pre')).toContainText('WorkPortal file viewer')
    await select('Example-script.bat')
    await expect(viewer.getByRole('heading', { name: 'Download only — use caution' })).toBeVisible()
    await capture(page, '13-download-warning')
    await select('Unknown-format.xyz')
    await expect(
      viewer.getByRole('heading', { name: 'Download to open this format' }),
    ).toBeVisible()
    await select('Unsafe-path.zip')
    await expect(viewer.getByRole('alert')).toBeVisible()
    await expect(viewer.locator('.file-archive-entry')).toHaveCount(0)
    await select('Broken.pdf')
    await expect(viewer.getByRole('alert')).toBeVisible()
    await select('Protected.pdf')
    await viewer.getByLabel('Enter the file password', { exact: true }).fill('ReviewExample123')
    await viewer.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(viewer.locator('canvas').first()).toBeVisible()
    await select('Long-review.pdf')
    await expect(viewer.locator('.pdfViewer > .page')).toHaveCount(40)
    await viewer.getByLabel('Page number', { exact: true }).fill('40')
    await viewer.getByLabel('Page number', { exact: true }).press('Enter')
    await expect(viewer.locator('.pdfViewer > .page').last().locator('canvas')).toBeVisible()
    expect(await viewer.locator('canvas').count()).toBeLessThan(15)
    await select('Cycle-overview.xlsx')
    await page.setViewportSize({ width: 390, height: 844 })
    await viewer.getByRole('button', { name: 'Hide file list', exact: true }).click()
    await expect(viewer.getByRole('cell', { name: 'Digital services', exact: true })).toBeVisible()
    await capture(page, '14-mobile-spreadsheet')
    expect(await viewer.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(
      390,
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
    const a11y = await new AxeBuilder({ page }).include('.file-viewer-dialog').analyze()
    expect(a11y.violations).toEqual([])
    await viewer.getByRole('button', { name: 'Close viewer', exact: true }).click()
    await expect(viewer).toHaveCount(0)
    await page.goto('/work/person')
    await expect(page.locator('.person-work-column')).toHaveCount(4)
    await expect(page.getByText('Full filters', { exact: true })).toHaveCount(0)
    await expect(page.getByPlaceholder(/Quick add:/)).toHaveCount(0)
    const colors = await page
      .locator('.person-work-column-heading')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor))
    expect(new Set(colors).size).toBe(4)
    await capture(page, '15-by-person-columns')
    expect(errors).toEqual([])
    writeFileSync(
      resolve(evidence, 'review-result.json'),
      JSON.stringify(
        {
          pageId,
          departmentId: department.departmentId,
          files: names,
          checkedAt: new Date().toISOString(),
          pageErrors: errors,
          externalRequests: outbound,
          blockedExternalRequests: blockedOutbound,
        },
        null,
        2,
      ),
    )
  } finally {
    await head.close()
    await admin.close()
    await outsider.close()
  }
})

test('Structure excludes removed and deleted members while retaining current colleagues', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const contexts: BrowserContext[] = []
  try {
    await loginAsSuperAdmin(admin)
    await registerUser(head, {
      login: uniqueLogin('structure.head'),
      password: examplePassword(),
      givenName: 'Nodira',
      familyName: 'Structure',
    })
    const headUser = (await (await head.request.get('/api/v1/me')).json()).user
    database(`update app.users set onboarding_required=false where id='${headUser.id}';`)
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const request = await authedPost(head, '/api/v1/departments/requests', {
      name: 'Structure · current team',
      locale: 'en',
      units: [{ name: 'Research and analysis' }],
    })
    expect(request.status()).toBe(201)
    const approval = await authedPost(
      admin,
      `/api/v1/departments/requests/${(await request.json()).id}/approve`,
      {},
    )
    expect(approval.status()).toBe(200)
    const department = await approval.json()
    const base = `/api/v1/departments/${department.departmentId}`
    const overview = await (await head.request.get(`${base}/units`)).json()
    const unitId = overview.units[0].id
    const users: Record<string, string> = {}
    for (const givenName of ['Active', 'Locked', 'Removed', 'Deleted', 'Erased']) {
      const context = await newFlowContext(browser)
      contexts.push(context)
      await registerUser(context, {
        login: uniqueLogin('structure.member'),
        password: examplePassword(),
        givenName,
        familyName: 'Reviewer',
      })
      const user = (await (await context.request.get('/api/v1/me')).json()).user
      users[givenName] = user.id
      database(`update app.users set onboarding_required=false where id='${user.id}';`)
      expect(
        (
          await authedPost(context, '/api/v1/departments/join', {
            key: department.joinKey,
            password: department.joinPassword,
          })
        ).status(),
      ).toBe(200)
      expect(
        (
          await authedPost(head, `${base}/unit-roles`, {
            unitId,
            userId: user.id,
            role: 'member',
          })
        ).status(),
      ).toBe(201)
    }
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/structure')
    await expect(page.getByRole('button', { name: 'Removed Reviewer', exact: true })).toBeVisible()
    expect(
      (await authedPost(head, `${base}/members/${users['Removed']}/remove`, {})).status(),
    ).toBe(204)
    await expect(page.getByRole('button', { name: 'Removed Reviewer', exact: true })).toHaveCount(0)
    // Model both current and legacy deleted-account rows with stale unit assignments.
    database(
      `update app.users set status='locked' where id='${users['Locked']}'; update app.users set status='deleted' where id='${users['Deleted']}'; update app.users set deleted_at=now() where id='${users['Erased']}';`,
    )
    const roles = await (await head.request.get(`${base}/unit-roles`)).json()
    expect(roles.map((role: { userId: string }) => role.userId).sort()).toEqual(
      [users['Active'], users['Locked']].sort(),
    )
    const roster = await (await head.request.get(`${base}/roster`)).json()
    expect(roster.map((member: { userId: string }) => member.userId).sort()).toEqual(
      [headUser.id, users['Active'], users['Locked']].sort(),
    )
    expect(
      (
        await authedPost(head, `${base}/unit-roles`, {
          unitId,
          userId: users['Deleted'],
          role: 'member',
        })
      ).status(),
    ).toBe(404)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Active Reviewer', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Locked Reviewer', exact: true })).toBeVisible()
    for (const name of ['Removed', 'Deleted', 'Erased']) {
      await expect(page.getByRole('button', { name: `${name} Reviewer`, exact: true })).toHaveCount(
        0,
      )
      await expect(page.getByText(users[name]!, { exact: true })).toHaveCount(0)
    }
    await capture(page, '19-structure-current-members')
    await page.locator('[data-onboarding-structure-tab="chart"]').click()
    await expect(
      page.locator('svg text').filter({ hasText: 'Active Reviewer' }).first(),
    ).toBeVisible()
    for (const name of ['Removed', 'Deleted', 'Erased'])
      await expect(page.getByText(`${name} Reviewer`, { exact: true })).toHaveCount(0)
    await capture(page, '20-structure-chart')
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
    await head.close()
    await admin.close()
  }
})

test('Pages guide, readable positions, stable navigation and useful notification bell', async ({
  browser,
}) => {
  const head = await newFlowContext(browser)
  try {
    const account = JSON.parse(readFileSync(resolve(scratch, 'file-viewer-account.json'), 'utf8'))
    await login(head, { login: account.login, password: account.password })
    const me = await (await head.request.get('/api/v1/me')).json()
    database(`update app.users set title='department_head' where id='${me.user.id}';`)
    const tasks = [
      { title: 'Review the service research', stage: 'todo' },
      { title: 'Prepare the department briefing', stage: 'in_progress' },
      { title: 'Deliver the evidence pack', done: true },
      { title: 'Superseded draft', deleted: true },
    ]
    for (const task of tasks) {
      const created = await authedPost(head, '/api/v1/cards', {
        title: task.title,
        assigneeUserId: me.user.id,
      })
      expect(created.status()).toBe(201)
      const card = await created.json()
      if (task.stage)
        expect(
          (
            await authedPatch(head, `/api/v1/cards/${card.id}`, {
              workStage: task.stage,
            })
          ).status(),
        ).toBe(200)
      if (task.done) {
        const checklist = await authedPost(head, `/api/v1/cards/${card.id}/checklist`, {
          text: 'Confirm delivery',
        })
        expect(checklist.status()).toBe(201)
        expect(
          (
            await authedPatch(
              head,
              `/api/v1/cards/${card.id}/checklist/${(await checklist.json()).id}`,
              { done: true },
            )
          ).status(),
        ).toBe(204)
        expect(
          (
            await authedPatch(head, `/api/v1/cards/${card.id}`, {
              status: 'done',
            })
          ).status(),
        ).toBe(200)
      }
      if (task.deleted)
        expect(
          (
            await head.request.delete(`/api/v1/cards/${card.id}`, {
              headers: { 'x-csrf-token': await csrfToken(head) },
            })
          ).status(),
        ).toBe(204)
    }
    const notificationId = database(
      `update app.notifications set title=jsonb_build_object('en','The department library is ready','uz-Latn','The department library is ready','uz-Cyrl','The department library is ready','ru','The department library is ready'), body=null where user_id='${me.user.id}' and subject_id='viewer-review';
       insert into app.notifications (user_id,type,reason,subject_type,subject_id,department_id,title,deep_link) values ('${me.user.id}','notifications.system.announced','system','system','viewer-review','${account.departmentId}',jsonb_build_object('en','The department library is ready','uz-Latn','The department library is ready','uz-Cyrl','The department library is ready','ru','The department library is ready'),'/pages') returning id;`,
    ).trim()
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/work/person')
    await expect(page.locator('.person-work-column')).toHaveCount(4)
    await expect(
      page.getByText('Prepare the department briefing', { exact: true }).first(),
    ).toBeVisible()
    await capture(page, '15-by-person-columns')
    const sidebar = page.locator('.devon-sidebar')
    await sidebar.getByRole('button', { name: /Knowledge/ }).click()
    const baseline = await sidebar.locator('[data-shell-label]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        y: node.getBoundingClientRect().y,
      })),
    )
    await sidebar.getByRole('link', { name: 'Pages', exact: true }).click()
    await expect(page).toHaveURL(/\/pages/)
    const after = await sidebar.locator('[data-shell-label]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        y: node.getBoundingClientRect().y,
      })),
    )
    expect(after).toEqual(baseline)
    expect(
      await sidebar.evaluate(
        (node) =>
          node.getAnimations({ subtree: true }).filter((animation) => {
            const effect = animation.effect
            return (
              effect instanceof KeyframeEffect &&
              effect
                .getKeyframes()
                .some((frame) => frame['transform'] && frame['transform'] !== 'none')
            )
          }).length,
      ),
    ).toBe(0)
    await page.goto('/account/department')
    await page.getByRole('tab', { name: 'Members', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText(
      'Head of department',
    )
    await expect(page.getByText('department_head', { exact: true })).toHaveCount(0)
    await capture(page, '16-department-positions')
    await page.goto('/help')
    await page
      .getByRole('button')
      .filter({ hasText: 'Pages, events, colleagues and structure' })
      .click()
    await expect(page.locator('.driver-popover-title')).toHaveText('Pages')
    await expect(page.locator('[data-onboarding="pages"]')).toHaveClass(/driver-active-element/)
    await capture(page, '17-pages-in-starter-guide')
    await page.keyboard.press('Escape')
    await expect(page.locator('.driver-popover')).toHaveCount(0)
    await page.goto('/')
    await expect(page.locator(`[data-inbox-opener="${notificationId}"]`).first()).toBeVisible()
    const bell = page.getByRole('button', {
      name: /^Notifications: \d+ unread$/,
    })
    await bell.click()
    await expect(page.getByRole('tab', { name: /^Unread/ })).toHaveAttribute('data-state', 'active')
    const focusedRow = page.locator(
      `[role="tabpanel"][data-state="active"] [data-inbox-opener="${notificationId}"]`,
    )
    await expect(focusedRow).toBeFocused()
    await capture(page, '18-notification-bell')
    const firstUrl = page.url()
    await bell.click()
    await expect(page).not.toHaveURL(firstUrl)
    await expect(focusedRow).toBeFocused()
    expect(
      database(
        `select read_at is null from app.notifications where id='${notificationId}';`,
      ).trim(),
    ).toBe('t')
  } finally {
    await head.close()
  }
})

test('Document controls fit small screens and the real standalone introduction works inside the viewer', async ({
  browser,
}) => {
  const account = JSON.parse(
    readFileSync(resolve(scratch, 'file-viewer-account.json'), 'utf8'),
  ) as { login: string; password: string; pageId: string }
  const head = await newFlowContext(browser)
  try {
    await login(head, { login: account.login, password: account.password })
    const source = process.env['ONBOARDING_REVIEW_HTML']
    if (source)
      await uploadBytes(head, account.pageId, 'Department_Onboarding.html', readFileSync(source))
    const page = await head.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/pages?page=${account.pageId}`)
    await page.getByRole('button', { name: 'Open Service-review.pdf', exact: true }).click()
    const viewer = page.getByRole('dialog', {
      name: 'File viewer',
      exact: true,
    })
    await expect(viewer.locator('canvas').first()).toBeVisible()
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ] as const) {
      await page.setViewportSize({ width, height })
      await expect(viewer.locator('.file-document-toolbar')).toBeVisible()
      expect(
        await viewer.locator('.file-document-toolbar').evaluate((node) =>
          Array.from(node.querySelectorAll('button,select,input'))
            .filter((item) => item.getBoundingClientRect().width > 0)
            .every((item) => {
              const r = item.getBoundingClientRect()
              return r.left >= 0 && r.right <= innerWidth
            }),
        ),
      ).toBe(true)
      await capture(page, `19-pdf-mobile-${width}`)
    }
    await viewer.getByRole('button', { name: 'Find in document', exact: true }).click()
    const search = viewer.getByRole('searchbox', {
      name: 'Find in document',
      exact: true,
    })
    await search.fill('service')
    await search.press('Escape')
    await expect(search).toHaveCount(0)
    await expect(viewer).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 1000 })
    const a11y = await new AxeBuilder({ page }).include('.file-viewer-dialog').analyze()
    expect(a11y.violations).toEqual([])
    const select = async (name: string) => {
      if (await viewer.getByRole('button', { name: 'Show file list', exact: true }).isVisible())
        await viewer.getByRole('button', { name: 'Show file list', exact: true }).click()
      await viewer
        .locator('.file-viewer-sidebar')
        .getByRole('button')
        .filter({ hasText: name })
        .first()
        .click()
    }
    await select('Team-overview.png')
    await expect(viewer.locator('.file-image-surface img')).toBeVisible()
    for (let i = 0; i < 8; i++)
      await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click()
    const imageBounds = await viewer.locator('.file-image-surface').evaluate((node) => {
      const surface = node.getBoundingClientRect(),
        image = node.querySelector('img')!.getBoundingClientRect()
      return {
        left: image.left >= surface.left,
        top: image.top >= surface.top,
        scrollable: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      }
    })
    expect(imageBounds).toEqual({ left: true, top: true, scrollable: true })
    await capture(page, '20-image-zoom')
    await select('Cycle-overview.xlsx')
    await viewer.getByRole('button', { name: 'Print layout', exact: true }).click()
    await expect(viewer.locator('canvas').first()).toBeVisible({
      timeout: 60_000,
    })
    await capture(page, '21-spreadsheet-print-layout')
    if (source) {
      await select('Department_Onboarding.html')
      await viewer.getByRole('button', { name: 'Hide file list', exact: true }).click()
      const frame = viewer.frameLocator('iframe')
      await expect(frame.locator('.step:not([hidden])')).toHaveAttribute('id', 'welcome')
      await frame.locator('#next').click()
      await expect(frame.locator('.step:not([hidden])')).toHaveAttribute('id', 'ministry')
      await expect
        .poll(() =>
          frame
            .locator('#ministry img')
            .evaluateAll((nodes) =>
              nodes.every(
                (node) =>
                  (node as HTMLImageElement).complete &&
                  (node as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        )
        .toBe(true)
      const structureLink = frame.locator('#ministry a[href*="structure"]').first()
      await expect(structureLink).toHaveAttribute('target', '_blank')
      await expect(structureLink).toHaveAttribute('rel', /noopener/)
      await head.route('https://gov.uz/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<h1>Official structure destination reached</h1>',
        }),
      )
      const popupPromise = head.waitForEvent('page')
      await structureLink.click()
      const popup = await popupPromise
      await expect(
        popup.getByRole('heading', {
          name: 'Official structure destination reached',
        }),
      ).toBeVisible()
      expect(await popup.evaluate(() => window.opener === null)).toBe(true)
      await popup.close()
      for (const [width, height] of [
        [1440, 1000],
        [854, 480],
      ] as const) {
        await page.setViewportSize({ width, height })
        await expect
          .poll(() =>
            frame.locator('html').evaluate((node) => {
              const win = node.ownerDocument.defaultView!
              return (
                node.scrollWidth <= win.innerWidth + 1 && node.scrollHeight <= win.innerHeight + 1
              )
            }),
          )
          .toBe(true)
        await capture(page, `22-onboarding-in-viewer-${width}`)
      }
      await frame.locator('#next').click()
      await expect(frame.locator('.step:not([hidden])')).toHaveAttribute('id', 'centre')
    }
    expect(errors).toEqual([])
  } finally {
    await head.close()
  }
})
