import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, test, type Browser, type BrowserContext } from '@playwright/test'
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
import type { Card } from '../../src/features/work/api.js'
import { FLOW_DB_CONTAINER, FLOW_DB_NAME, FLOW_TMP_DIR } from './flow-env.js'

const evidence = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/files')

async function fixture(browser: Browser) {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('files.head'),
    headPassword: examplePassword(),
    departmentName: 'Local files QA',
  })
  expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const headUser = (await (await head.request.get('/api/v1/me')).json()).user.id as string
  const created = await authedPost(head, '/api/v1/cards', {
    title: 'Local links and files',
    assigneeUserId: headUser,
  })
  expect(created.status()).toBe(201)
  const forbiddenBrowserHosts: string[] = []
  await head.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      forbiddenBrowserHosts.push(url.hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  return { admin, head, department, forbiddenBrowserHosts, card: (await created.json()) as Card }
}

type FileRow = {
  id: string
  name: string
  size: number
  key: string
  scan_status: string
  deleted_at: string | null
  upload_status: string
}
function persistedFiles(cardId: string): FileRow[] {
  if (
    !/^devon_(?:flow_e2e|qa)(?:_[a-z0-9]+)*$/.test(FLOW_DB_NAME) ||
    !/^[a-f0-9-]{36}$/.test(cardId)
  )
    throw new Error('Refusing file evidence outside the owned test database/card')
  const result = spawnSync(
    'docker',
    [
      'exec',
      FLOW_DB_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      FLOW_DB_NAME,
      '-At',
      '-c',
      `select coalesce(json_agg(x), '[]'::json) from (select a.id,a.name,a.size,a.key,a.scan_status,a.deleted_at,u.status as upload_status from app.attachments a join app.uploads u on u.id=a.id where a.subject_id='${cardId}' order by a.created_at) x`,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error('Owned local attachment metadata evidence read failed')
  return JSON.parse(result.stdout.trim()) as FileRow[]
}
function storedBytes(key: string) {
  const storage = resolve(FLOW_TMP_DIR, 'storage')
  const file = resolve(storage, key)
  const within = relative(storage, file)
  if (
    within.startsWith('..') ||
    !within.startsWith(`attachments${process.platform === 'win32' ? '\\' : '/'}`)
  )
    throw new Error('Refusing file evidence outside owned local attachment storage')
  return file
}
async function listedFiles(
  context: BrowserContext,
  id: string,
): Promise<{ id: string; name: string; size: number }[]> {
  const response = await context.request.get(`/api/v1/cards/${id}/attachments`)
  expect(response.status()).toBe(200)
  return response.json()
}
async function openFiles(context: BrowserContext, card: Card) {
  const page = await context.newPage()
  await page.goto(`/work/card?id=${card.id}`)
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(card.title)
  const section = page.getByRole('region', { name: 'Files', exact: true })
  await expect(section).toBeVisible()
  return { page, section, input: section.locator('input[type=file]') }
}

async function cardRead(context: BrowserContext, id: string): Promise<Card> {
  const response = await context.request.get(`/api/v1/cards/${id}`)
  expect(response.status()).toBe(200)
  return (await response.json()) as Card
}

test('an unreachable external link saves as a plain link without any external connection', async ({
  browser,
}, info) => {
  const { admin, head, card, forbiddenBrowserHosts } = await fixture(browser)
  try {
    const page = await head.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto('/work')
    await page
      .locator(`[data-dnd-card="${card.id}"]`)
      .getByRole('button', {
        name: card.title,
        exact: true,
      })
      .click()
    const url = 'https://example.org/local-qa-reference'
    const response = page.waitForResponse(
      (result) => new URL(result.url()).pathname === '/api/v1/links/unfurl',
    )
    const shortSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/cards/${card.id}`,
    )
    const input = page.getByPlaceholder('Paste a link', { exact: true })
    await input.fill(url)
    await input.press('Enter')
    const unfurled = await response
    expect(
      unfurled.status(),
      'real API guard denies foreign DNS before transport; fallback is expected',
    ).toBe(200)
    expect((await shortSaved).status()).toBe(200)
    await expect(input).toHaveValue('')
    await expect(page.getByRole('link', { name: url, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeDisabled()
    // Re-adding one URL does not create duplicate React keys or duplicate saved entries.
    await input.fill(url)
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await expect(input).toHaveValue('')
    expect((await cardRead(head, card.id)).links).toHaveLength(1)
    await expect
      .poll(async () => (await cardRead(head, card.id)).links)
      .toEqual([{ url, title: url, favicon: null }])
    const longUrl = `https://example.org/report?details=${'x'.repeat(500)}`
    const longSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/cards/${card.id}`,
    )
    await input.fill(longUrl)
    await input.press('Enter')
    expect((await longSaved).status()).toBe(200)
    const longLink = page.getByRole('link', { name: longUrl.slice(0, 300), exact: true })
    await expect(longLink).toBeVisible()
    await expect(longLink).toHaveAttribute('href', longUrl)
    expect((await cardRead(head, card.id)).links).toContainEqual({
      url: longUrl,
      title: longUrl.slice(0, 300),
      favicon: null,
    })
    await page.reload()
    // The peek's card URL survives reload and restores the open detail automatically.
    await expect(page.getByRole('link', { name: url, exact: true })).toBeVisible()
    await expect(longLink).toHaveAttribute('href', longUrl)
    expect(forbiddenBrowserHosts).toEqual([])
    expect(pageErrors).toEqual([])
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-plain-link-persisted.png`),
      fullPage: true,
    })
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/cards/${card.id}`,
    )
    await page.getByRole('button', { name: `Remove link: ${url}`, exact: true }).click()
    expect((await removed).status()).toBe(200)
    await expect(page.getByRole('link', { name: url, exact: true })).toHaveCount(0)
    expect((await cardRead(head, card.id)).links).toEqual([
      { url: longUrl, title: longUrl.slice(0, 300), favicon: null },
    ])
  } finally {
    await head.close()
    await admin.close()
  }
})

test('a real uploaded file downloads unchanged, soft-deletes, and restores through Undo', async ({
  browser,
}, info) => {
  const { admin, head, card, forbiddenBrowserHosts } = await fixture(browser)
  try {
    const { page, section, input } = await openFiles(head, card)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const bytes = Buffer.from('Local monthly report\nRevenue,42\nOʻzbekcha matn\n')
    const name = 'monthly-report-uzbek-2026-October-with-a-long-name.txt'
    await input.setInputFiles({ name, mimeType: 'text/plain', buffer: bytes })
    await expect(section.getByRole('link', { name, exact: true })).toBeVisible()
    const [attachment] = await listedFiles(head, card.id)
    expect(attachment).toMatchObject({ name, size: bytes.length })
    const [metadata] = persistedFiles(card.id)
    expect(metadata).toMatchObject({
      id: attachment!.id,
      scan_status: 'clean',
      upload_status: 'finalized',
      deleted_at: null,
    })
    expect(readFileSync(storedBytes(metadata!.key))).toEqual(bytes)
    expect(
      existsSync(
        storedBytes(`attachments/${metadata!.key.split('/')[1]}/${attachment!.id}/pending`),
      ),
    ).toBe(false)
    const downloadEvent = page.waitForEvent('download')
    await section.getByRole('link', { name, exact: true }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe(name)
    mkdirSync(evidence, { recursive: true })
    const downloaded = join(evidence, `${info.project.name}-download.txt`)
    await download.saveAs(downloaded)
    expect(readFileSync(downloaded)).toEqual(bytes)
    const response = await head.request.get(
      `/api/v1/cards/${card.id}/attachments/${attachment!.id}/download`,
    )
    expect(response.headers()['content-type']).toBe('application/octet-stream')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['cache-control']).toBe('private, no-store')
    await page.setViewportSize({ width: 390, height: 844 })
    await section.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391)
    await section.screenshot({ path: join(evidence, `${info.project.name}-mobile-uploaded.png`) })
    await section.getByRole('button', { name: `Remove ${name}`, exact: true }).click()
    await expect(section.getByRole('link', { name, exact: true })).toHaveCount(0)
    expect(await listedFiles(head, card.id)).toEqual([])
    expect(persistedFiles(card.id)[0]!.deleted_at).toBeTruthy()
    expect(readFileSync(storedBytes(metadata!.key))).toEqual(bytes)
    expect(
      (
        await head.request.get(`/api/v1/cards/${card.id}/attachments/${attachment!.id}/download`)
      ).status(),
    ).toBe(404)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(section.getByRole('link', { name, exact: true })).toBeVisible()
    expect(persistedFiles(card.id)[0]!.deleted_at).toBeNull()
    await page.reload()
    await expect(section.getByRole('link', { name, exact: true })).toBeVisible()
    expect(forbiddenBrowserHosts).toEqual([])
    expect(pageErrors).toEqual([])
  } finally {
    await head.close()
    await admin.close()
  }
})

test('file type, oversized metadata and mismatched bytes are refused without publication', async ({
  browser,
}, info) => {
  const { admin, head, card, forbiddenBrowserHosts } = await fixture(browser)
  try {
    const { page, section, input } = await openFiles(head, card)
    for (const candidate of [
      {
        name: 'program.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('unsupported'),
        status: 422,
      },
      {
        name: 'large.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 'x'),
        status: 413,
      },
    ]) {
      const response = page.waitForResponse((res) =>
        new URL(res.url()).pathname.endsWith('/attachments/upload-url'),
      )
      // eslint-disable-next-line no-restricted-syntax -- one shared UI input; each failure must settle before the next file.
      await input.setInputFiles(candidate)
      expect((await response).status()).toBe(candidate.status)
      // eslint-disable-next-line no-restricted-syntax -- assert this file's response before replacing the shared input/error state.
      await expect(section.getByRole('alert')).toBeVisible()
      expect(await listedFiles(head, card.id)).toEqual([])
      expect(persistedFiles(card.id)).toEqual([])
    }
    await expect(section.getByRole('alert')).toHaveText(
      "This file exceeds the server's upload limit. Choose a smaller file.",
    )
    const rejected = page.waitForResponse((res) =>
      new URL(res.url()).pathname.endsWith('/finalize'),
    )
    await input.setInputFiles({
      name: 'false-document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a PDF'),
    })
    expect((await rejected).status()).toBe(422)
    await expect(section.getByRole('alert')).toBeVisible()
    expect(await listedFiles(head, card.id)).toEqual([])
    const [metadata] = persistedFiles(card.id)
    expect(metadata).toMatchObject({ upload_status: 'rejected' })
    expect(metadata!.deleted_at).toBeTruthy()
    expect(existsSync(storedBytes(metadata!.key))).toBe(false)
    expect(
      (
        await head.request.get(`/api/v1/cards/${card.id}/attachments/${metadata!.id}/download`)
      ).status(),
    ).toBe(404)
    mkdirSync(evidence, { recursive: true })
    await section.screenshot({ path: join(evidence, `${info.project.name}-file-rejected.png`) })
    const mismatched = await authedPost(head, `/api/v1/cards/${card.id}/attachments/upload-url`, {
      name: 'size-mismatch.txt',
      size: 10,
    })
    expect(mismatched.status()).toBe(201)
    const upload = await mismatched.json()
    expect(upload.url).toMatch(/^\/api\/v1\/storage\/uploads\?token=/)
    expect(
      (
        await head.request.put(upload.url, { headers: upload.headers, data: Buffer.from('short') })
      ).status(),
    ).toBe(204)
    const refused = await authedPost(
      head,
      `/api/v1/cards/${card.id}/attachments/${upload.uploadId}/finalize`,
      {},
    )
    expect(refused.status()).toBe(422)
    expect((await refused.json()).errors).toContainEqual({ path: 'file', code: 'size_mismatch' })
    const mismatchRow = persistedFiles(card.id).find((file) => file.id === upload.uploadId)!
    expect(mismatchRow.upload_status).toBe('rejected')
    expect(existsSync(storedBytes(mismatchRow.key))).toBe(false)
    expect(await listedFiles(head, card.id)).toEqual([])
    expect(forbiddenBrowserHosts).toEqual([])
  } finally {
    await head.close()
    await admin.close()
  }
})

test('cancelling a real PUT response leaves bytes quarantined and a new upload still works', async ({
  browser,
}, info) => {
  const { admin, head, card, forbiddenBrowserHosts } = await fixture(browser)
  let release!: () => void
  const held = new Promise<void>((done) => {
    release = done
  })
  try {
    const { page, section, input } = await openFiles(head, card)
    let putStored!: () => void
    const stored = new Promise<void>((done) => {
      putStored = done
    })
    const bytes = Buffer.from('Quarantined cancelled file\n')
    let finalizeCalls = 0
    let cancelledPut = 0
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/storage/uploads') {
        expect(request.failure()?.errorText).toMatch(/abort|cancel/i)
        cancelledPut++
      }
    })
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/finalize')) finalizeCalls++
    })
    await page.route('**/api/v1/storage/uploads?*', async (route) => {
      // The real local server receives and stores the body. Delay only delivery of its response
      // to expose the browser's cancellation boundary; no synthetic success is supplied.
      // WebKit's interception cannot recover Blob bodies. Forward the same fixture bytes
      // explicitly; the ordinary upload test separately verifies native Blob transport.
      const response = await route.fetch({ postData: bytes })
      expect(response.status()).toBe(204)
      putStored()
      await held
      // The browser has already handled the aborted request. Returning ends the fault handler;
      // attempting to fulfil that request would create a harness error after successful cancel.
      if (cancelledPut === 0) await route.fulfill({ response })
    })
    await input.setInputFiles({ name: 'cancelled.txt', mimeType: 'text/plain', buffer: bytes })
    await stored
    await section.getByRole('button', { name: 'Cancel upload', exact: true }).click()
    await expect(section.getByRole('status')).toHaveText(
      'Upload cancelled. The file was not attached.',
    )
    await expect.poll(() => cancelledPut).toBe(1)
    release()
    await page.unroute('**/api/v1/storage/uploads?*')
    expect(finalizeCalls).toBe(0)
    expect(await listedFiles(head, card.id)).toEqual([])
    const [metadata] = persistedFiles(card.id)
    expect(metadata).toMatchObject({
      name: 'cancelled.txt',
      scan_status: 'pending',
      upload_status: 'pending',
      deleted_at: null,
    })
    expect(readFileSync(storedBytes(metadata!.key))).toEqual(bytes)
    expect(
      (
        await head.request.get(`/api/v1/cards/${card.id}/attachments/${metadata!.id}/download`)
      ).status(),
    ).toBe(404)
    mkdirSync(evidence, { recursive: true })
    await section.screenshot({ path: join(evidence, `${info.project.name}-cancelled.png`) })
    await input.setInputFiles({
      name: 'after-cancellation.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('A new upload\n'),
    })
    await expect(
      section.getByRole('link', { name: 'after-cancellation.txt', exact: true }),
    ).toBeVisible()
    expect((await listedFiles(head, card.id)).map((item) => item.name)).toEqual([
      'after-cancellation.txt',
    ])
    expect(finalizeCalls).toBe(1)
    expect(forbiddenBrowserHosts).toEqual([])
  } finally {
    release()
    await head.close()
    await admin.close()
  }
})

test('a colleague can read shared files but cannot edit links or use the owner upload token', async ({
  browser,
}) => {
  const { admin, head, department, card } = await fixture(browser)
  const member = await newFlowContext(browser)
  const stranger = await newFlowContext(browser)
  try {
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('files.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const { section, input } = await openFiles(member, card)
    await expect(input).toHaveCount(0)
    const page = section.page()
    await expect(page.getByPlaceholder('Paste a link', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add link', exact: true })).toHaveCount(0)
    const base = `/api/v1/cards/${card.id}/attachments`
    const signed = await authedPost(head, `${base}/upload-url`, { name: 'owner.txt', size: 10 })
    expect(signed.status()).toBe(201)
    const upload = await signed.json()
    expect(upload.url).toMatch(/^\/api\/v1\/storage\/uploads\?token=/)
    expect(
      (
        await member.request.put(upload.url, {
          headers: upload.headers,
          data: Buffer.from('1234567890'),
        })
      ).status(),
    ).toBe(404)
    expect((await authedPost(member, `${base}/${upload.uploadId}/finalize`, {})).status()).toBe(403)
    expect(
      (await authedPost(member, `${base}/upload-url`, { name: 'peer.txt', size: 10 })).status(),
    ).toBe(403)
    expect(await listedFiles(member, card.id)).toEqual([])
    expect(persistedFiles(card.id)[0]!.upload_status).toBe('pending')
    const bytes = Buffer.from('1234567890')
    expect(
      (await head.request.put(upload.url, { headers: upload.headers, data: bytes })).status(),
    ).toBe(204)
    expect((await authedPost(head, `${base}/${upload.uploadId}/finalize`, {})).status()).toBe(200)
    expect((await listedFiles(member, card.id))[0]).toMatchObject({
      id: upload.uploadId,
      name: 'owner.txt',
      size: 10,
    })
    const shared = await member.request.get(`${base}/${upload.uploadId}/download`)
    expect(shared.status()).toBe(200)
    expect(await shared.body()).toEqual(bytes)
    await page.reload()
    await expect(section.getByRole('link', { name: 'owner.txt', exact: true })).toBeVisible()
    await expect(
      section.getByRole('button', { name: 'Remove owner.txt', exact: true }),
    ).toHaveCount(0)
    await createApprovedDepartment(stranger, admin, {
      headLogin: uniqueLogin('files.foreign'),
      headPassword: examplePassword(),
      departmentName: 'Other local files QA',
    })
    expect((await stranger.request.get(base)).status()).toBe(404)
    expect((await stranger.request.get(`${base}/${upload.uploadId}/download`)).status()).toBe(404)
  } finally {
    await stranger.close()
    await member.close()
    await head.close()
    await admin.close()
  }
})

test('interrupted uploads and failed deletions retain recoverable state and show an actionable error', async ({
  browser,
}, info) => {
  const { admin, head, card, forbiddenBrowserHosts } = await fixture(browser)
  try {
    const { page, section, input } = await openFiles(head, card)
    await page.route('**/api/v1/storage/uploads?*', (route) => route.abort('failed'))
    await input.setInputFiles({
      name: 'interrupted.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Interrupted body\n'),
    })
    await expect(section.getByRole('alert')).toHaveText(
      'Could not complete the file action. Check the file type and try again.',
    )
    await expect(input).toBeEnabled()
    expect(await listedFiles(head, card.id)).toEqual([])
    const [pending] = persistedFiles(card.id)
    expect(pending).toMatchObject({ scan_status: 'pending', upload_status: 'pending' })
    expect(existsSync(storedBytes(pending!.key))).toBe(false)
    await page.unroute('**/api/v1/storage/uploads?*')
    await input.setInputFiles({
      name: 'recovered.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Recovered body\n'),
    })
    await expect(section.getByRole('link', { name: 'recovered.txt', exact: true })).toBeVisible()
    await expect(section.getByRole('alert')).toHaveCount(0)
    const [saved] = await listedFiles(head, card.id)
    const deletePath = `/api/v1/cards/${card.id}/attachments/${saved!.id}`
    await page.route(`**${deletePath}`, (route) => route.abort('failed'))
    await section.getByRole('button', { name: 'Remove recovered.txt', exact: true }).click()
    await expect(section.getByRole('alert')).toBeVisible()
    await expect(section.getByRole('link', { name: 'recovered.txt', exact: true })).toBeVisible()
    expect((await listedFiles(head, card.id))[0]!.id).toBe(saved!.id)
    expect(persistedFiles(card.id).find((file) => file.id === saved!.id)!.deleted_at).toBeNull()
    mkdirSync(evidence, { recursive: true })
    await section.screenshot({ path: join(evidence, `${info.project.name}-delete-failed.png`) })
    await page.unroute(`**${deletePath}`)
    await section.getByRole('button', { name: 'Remove recovered.txt', exact: true }).click()
    await expect(section.getByRole('link', { name: 'recovered.txt', exact: true })).toHaveCount(0)
    expect(await listedFiles(head, card.id)).toEqual([])
    expect(persistedFiles(card.id).find((file) => file.id === saved!.id)!.deleted_at).toBeTruthy()
    expect(forbiddenBrowserHosts).toEqual([])
  } finally {
    await head.close()
    await admin.close()
  }
})

test('card link writes refuse unsupported schemes and embedded credentials atomically', async ({
  browser,
}) => {
  const { admin, head, card } = await fixture(browser)
  try {
    const valid = { url: 'https://example.org/report', title: 'Report', favicon: null }
    expect((await authedPatch(head, `/api/v1/cards/${card.id}`, { links: [valid] })).status()).toBe(
      200,
    )
    for (const url of [
      'ftp://example.org/report',
      'javascript:alert(1)',
      'https://viewer:ExamplePass@example.org/report',
      'data:text/html,<b>report</b>',
    ]) {
      const response = await authedPatch(head, `/api/v1/cards/${card.id}`, {
        title: 'Must not partially persist',
        links: [valid, { url, title: 'Unsafe candidate', favicon: null }],
      })
      expect(response.status(), `card PATCH rejects ${new URL(url).protocol}`).toBe(422)
      const persisted = await cardRead(head, card.id)
      expect(persisted.links).toEqual([valid])
      expect(persisted.title).toBe(card.title)
      const created = await authedPost(head, '/api/v1/cards', {
        title: 'Must not create an unsafe link',
        links: [{ url, title: 'Unsafe candidate', favicon: null }],
      })
      expect(created.status()).toBe(422)
    }
  } finally {
    await head.close()
    await admin.close()
  }
})
