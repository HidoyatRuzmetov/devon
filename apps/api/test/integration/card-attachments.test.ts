import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { closePool, configurePool } from '@devon/db'
import { buildApp } from '../../src/app.js'
import { createRepo } from '../../src/db/repo.js'
import { ScannerUnavailable } from '../../src/lib/storage/clamav.js'
import { BufferedTransferBudget } from '../../src/lib/storage/buffer-budget.js'
import { resolveEvent } from '../../src/modules/notifications/sources.js'
import { startProveDatabase, type ProveDatabase } from '../checks/pg-fixture.js'
import { testConfig } from '../unit/test-app.js'
import {
  loginAs,
  seedBareUser,
  seedDepartment,
  seedMember,
  superuserQuery,
  type Session,
} from './harness.js'

let db: ProveDatabase
let app: FastifyInstance
let baseUrl: string
let auth: Session
let foreign: Session
let colleague: Session
let cardId: string
let scan: 'clean' | 'infected' | 'down' = 'clean'
let onScan: (() => Promise<void>) | null = null
const storageDir = mkdtempSync(join(tmpdir(), 'devon-attachments-test-'))
const file = Buffer.from('%PDF-1.4\nattachment test\n%%EOF')
type Upload = { uploadId: string; url: string; headers: Record<string, string> }

beforeAll(async () => {
  db = await startProveDatabase()
  configurePool(db.appUrl)
  app = await buildApp(
    createRepo(),
    testConfig({ DATABASE_URL: db.appUrl, STORAGE_LOCAL_DIR: storageDir }),
    {
      storage: {
        bufferBudget: new BufferedTransferBudget(2 * 1024 * 1024),
        scanner: {
          mode: 'clamd',
          ping: async () => true,
          scan: async () => {
            await onScan?.()
            if (scan === 'down') throw new ScannerUnavailable('test outage')
            return scan === 'infected'
              ? { verdict: 'infected', signature: 'test' }
              : { verdict: 'clean' }
          },
        },
      },
    },
  )
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  const dept = await seedDepartment(db, { name: 'Files', slug: `files-${randomUUID()}` })
  const other = await seedDepartment(db, {
    name: 'Other files',
    slug: `other-files-${randomUUID()}`,
  })
  const owner = await seedMember(db, dept.id, { role: 'member' })
  const peer = await seedMember(db, dept.id, { role: 'member' })
  const stranger = await seedMember(db, other.id, { role: 'member' })
  auth = await loginAs(baseUrl, owner.login)
  colleague = await loginAs(baseUrl, peer.login)
  foreign = await loginAs(baseUrl, stranger.login)
  const created = await request('/cards', 'POST', { title: 'Attachment card' })
  expect(created.status).toBe(201)
  cardId = ((await created.json()) as { id: string }).id
}, 180_000)
afterAll(async () => {
  if (app) await app.close()
  await closePool()
  if (db) await db.stop()
  rmSync(storageDir, { recursive: true, force: true })
})
afterEach(async () => {
  onScan = null
  vi.restoreAllMocks()
  await expect.poll(() => app.storage.bufferBudget.usedBytes).toBe(0)
})
function request(path: string, method = 'GET', body?: unknown, session = auth) {
  const headers =
    body === undefined ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : session.headers
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function path(tail = '') {
  return `/cards/${cardId}/attachments${tail}`
}
async function prepare(bytes = file, name = 'Report.pdf') {
  const response = await request(path('/upload-url'), 'POST', { name, size: bytes.length })
  expect(response.status).toBe(201)
  const upload = (await response.json()) as Upload
  const put = await fetch(`${baseUrl}${upload.url}`, {
    method: 'PUT',
    headers: { cookie: auth.cookie, ...upload.headers },
    body: bytes,
  })
  expect(put.status).toBe(204)
  return upload
}

describe('task files', () => {
  it('shares one admission budget across scans, local PUT parsing and downloads, retaining aborted scans', async () => {
    const ready = await prepare()
    expect((await request(path(`/${ready.uploadId}/finalize`), 'POST', {})).status).toBe(200)
    const paused = await prepare()
    const next = (await (
      await request(path('/upload-url'), 'POST', { name: 'next.pdf', size: file.length })
    ).json()) as Upload
    const budget = app.storage.bufferBudget
    const releaseBlocker = budget.acquire(budget.capacity / 2 - file.length)!
    let releaseScan!: () => void
    let entered = false
    const gate = new Promise<void>((resolve) => {
      releaseScan = resolve
    })
    onScan = async () => {
      entered = true
      await gate
    }
    const reads = vi.spyOn(app.storage.store, 'get')
    const abort = new AbortController()
    const running = fetch(`${baseUrl}/api/v1${path(`/${paused.uploadId}/finalize`)}`, {
      method: 'POST',
      headers: auth.headers,
      body: '{}',
      signal: abort.signal,
    }).then(
      (result) => result.status,
      (error: Error) => error.name,
    )
    try {
      await expect.poll(() => entered).toBe(true)
      expect(budget.usedBytes).toBe(budget.capacity)
      expect((await request(path(`/${ready.uploadId}/download`))).status).toBe(503)
      const refused = await fetch(baseUrl + next.url, {
        method: 'PUT',
        headers: { cookie: auth.cookie, ...next.headers },
        body: file,
      })
      expect(refused.status).toBe(503)
      expect(refused.headers.get('retry-after')).toBe('5')
      expect(reads).toHaveBeenCalledTimes(1)
      const pending = await superuserQuery(db, 'select key from app.uploads where id=$1', [
        next.uploadId,
      ])
      expect(await app.storage.store.head(pending[0]!['key'] as string)).toBeNull()
      abort.abort()
      expect(await running).toBe('AbortError')
      // The disconnected caller does not free memory still in use by the actual scanner.
      expect(budget.usedBytes).toBe(budget.capacity)
      expect((await request(path(`/${ready.uploadId}/download`))).status).toBe(503)
      releaseScan()
      await expect.poll(() => budget.usedBytes).toBe(budget.capacity - file.length * 2)
      expect(
        (
          await fetch(baseUrl + next.url, {
            method: 'PUT',
            headers: { cookie: auth.cookie, ...next.headers },
            body: file,
          })
        ).status,
      ).toBe(204)
      const download = await request(path(`/${ready.uploadId}/download`))
      expect(download.status).toBe(200)
      expect(Buffer.from(await download.arrayBuffer())).toEqual(file)
    } finally {
      releaseScan()
      releaseBlocker()
      onScan = null
      await running
    }
  })
  it('releases admission on an interrupted body before any object is stored and permits retry', async () => {
    const upload = (await (
      await request(path('/upload-url'), 'POST', { name: 'interrupted.pdf', size: file.length })
    ).json()) as Upload
    const aborted = httpRequest(baseUrl + upload.url, {
      method: 'PUT',
      headers: { cookie: auth.cookie, ...upload.headers },
    })
    const ended = new Promise<void>((resolve) => {
      aborted.on('error', () => resolve())
      aborted.on('close', () => resolve())
    })
    aborted.write(file.subarray(0, 3))
    try {
      await expect.poll(() => app.storage.bufferBudget.usedBytes).toBe(file.length * 2)
    } finally {
      aborted.destroy()
      await ended
    }
    await expect.poll(() => app.storage.bufferBudget.usedBytes).toBe(0)
    expect(
      (
        await fetch(baseUrl + upload.url, {
          method: 'PUT',
          headers: { cookie: auth.cookie, ...upload.headers },
          body: file,
        })
      ).status,
    ).toBe(204)
  })
  it('releases failed download reads and does not strand capacity after storage failure', async () => {
    const upload = await prepare()
    expect((await request(path(`/${upload.uploadId}/finalize`), 'POST', {})).status).toBe(200)
    vi.spyOn(app.storage.store, 'get').mockRejectedValueOnce(
      new Error('Intentional storage failure'),
    )
    expect((await request(path(`/${upload.uploadId}/download`))).status).toBe(500)
    await expect.poll(() => app.storage.bufferBudget.usedBytes).toBe(0)
    const retried = await request(path(`/${upload.uploadId}/download`))
    expect(retried.status).toBe(200)
    expect(Buffer.from(await retried.arrayBuffer())).toEqual(file)
  })
  it('keeps a busy finalization retryable without buffering a second file', async () => {
    const first = await prepare(file, 'First.pdf')
    const second = await prepare(file, 'Second.pdf')
    let entered = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    onScan = async () => {
      entered = true
      await gate
    }
    const running = request(path(`/${first.uploadId}/finalize`), 'POST', {})
    try {
      await expect.poll(() => entered).toBe(true)
      expect((await request(path(`/${second.uploadId}/finalize`), 'POST', {})).status).toBe(503)
    } finally {
      onScan = null
      release()
    }
    expect((await running).status).toBe(200)
    expect((await request(path(`/${second.uploadId}/finalize`), 'POST', {})).status).toBe(200)
  })
  it('requires one superadmin approval above 100 MiB and reports its status to the uploader', async () => {
    const adminUser = await seedBareUser(db, { instanceRole: 'super_admin' })
    const admin = await loginAs(baseUrl, adminUser.login)
    const input = { name: 'Workshop recording.mp4', size: 100 * 1024 * 1024 + 1 }
    expect(
      (await request(path('/upload-url'), 'POST', { ...input, size: 100 * 1024 * 1024 })).status,
    ).toBe(201)
    expect((await request(path('/upload-url'), 'POST', input)).status).toBe(202)
    expect((await request(path('/upload-url'), 'POST', input)).status).toBe(202)
    const queue = (await (
      await request('/admin/file-upload-approvals', 'GET', undefined, admin)
    ).json()) as { id: string }[]
    expect(queue).toHaveLength(1)
    const requested = await resolveEvent({
      eventType: 'attachments.approval.requested',
      source: 'file_upload_approval',
      departmentId: null,
      payload: { approvalId: queue[0]!.id },
    })
    expect(requested?.facts.subjectTitle).toBe(input.name)
    expect(requested?.byRule.super_admins).toContain(adminUser.id)
    expect((await request('/admin/file-upload-approvals')).status).toBe(403)
    expect(
      (await request(`/admin/file-upload-approvals/${queue[0]!.id}`, 'POST', { approved: true }))
        .status,
    ).toBe(403)
    expect(
      (
        await request(
          `/admin/file-upload-approvals/${queue[0]!.id}`,
          'POST',
          { approved: true },
          admin,
        )
      ).status,
    ).toBe(204)
    expect(await (await request(path('/approvals'))).json()).toEqual([
      expect.objectContaining({ status: 'approved', name: input.name }),
    ])
    const reviewed = await resolveEvent({
      eventType: 'attachments.approval.reviewed',
      source: 'file_upload_approval',
      departmentId: null,
      payload: { approvalId: queue[0]!.id },
    })
    expect(reviewed?.byRule.target_user).toHaveLength(1)
    expect(reviewed?.facts.extra['status']).toBe('approved')
    const approvedUpload = await request(path('/upload-url'), 'POST', input)
    expect(approvedUpload.status).toBe(201)
    const approvedPayload = (await approvedUpload.json()) as { expiresAt: string }
    expect(new Date(approvedPayload.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      25 * 60 * 1000,
    )
    expect((await request(path('/upload-url'), 'POST', input)).status).toBe(202)
  })
  it('rejects bytes beyond an attachment’s declared size before accepting storage', async () => {
    const response = await request(path('/upload-url'), 'POST', { name: 'notes.html', size: 3 })
    const upload = (await response.json()) as Upload
    const put = await fetch(`${baseUrl}${upload.url}`, {
      method: 'PUT',
      headers: { cookie: auth.cookie, ...upload.headers },
      body: 'too many bytes',
    })
    expect(put.status).toBe(413)
  })
  it('stores HTML on Pages as a scanned download and hides it from other departments', async () => {
    const page = await request('/pages', 'POST', { title: 'Page files' })
    expect(page.status).toBe(201)
    const { id } = (await page.json()) as { id: string }
    const bytes = Buffer.from('<html><script>alert("must never execute")</script></html>')
    const base = `/pages/${id}/attachments`
    const signed = await request(base + '/upload-url', 'POST', {
      name: 'Example.html',
      size: bytes.length,
    })
    expect(signed.status).toBe(201)
    const upload = (await signed.json()) as Upload
    expect(
      (
        await fetch(baseUrl + upload.url, {
          method: 'PUT',
          headers: { cookie: auth.cookie, ...upload.headers },
          body: bytes,
        })
      ).status,
    ).toBe(204)
    expect((await request(`${base}/${upload.uploadId}/download`)).status).toBe(404)
    expect((await request(`${base}/${upload.uploadId}/finalize`, 'POST', {})).status).toBe(200)
    const download = await request(
      `${base}/${upload.uploadId}/download`,
      'GET',
      undefined,
      colleague,
    )
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toContain('attachment;')
    expect(download.headers.get('content-type')).toContain('application/octet-stream')
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
    expect((await request(base, 'GET', undefined, foreign)).status).toBe(404)
  })
  it('quarantines uploads, validates permissions, scans immutable bytes, and downloads as an attachment', async () => {
    const upload = await prepare()
    expect((await request(path(`/${upload.uploadId}/download`))).status).toBe(404)
    expect(
      (await request(path(`/${upload.uploadId}/finalize`), 'POST', {}, colleague)).status,
    ).toBe(403)
    expect((await request(path(`/${upload.uploadId}/finalize`), 'POST', {})).status).toBe(200)
    // Reusing the signed PUT cannot replace the scanned, published bytes.
    await fetch(`${baseUrl}${upload.url}`, {
      method: 'PUT',
      headers: { cookie: auth.cookie, ...upload.headers },
      body: Buffer.from('unscanned replacement'),
    })
    const download = await request(
      path(`/${upload.uploadId}/download`),
      'GET',
      undefined,
      colleague,
    )
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toContain('attachment;')
    expect(Buffer.from(await download.arrayBuffer())).toEqual(file)
    expect((await request(path(), 'GET', undefined, foreign)).status).toBe(404)
    expect(
      (await request(path(`/${upload.uploadId}/download`), 'GET', undefined, foreign)).status,
    ).toBe(404)
    expect(
      (await request(path('/upload-url'), 'POST', { name: 'File.pdf', size: 10 }, colleague))
        .status,
    ).toBe(403)
    expect((await request(path(`/${upload.uploadId}`), 'DELETE')).status).toBe(204)
    expect((await request(path(`/${upload.uploadId}/download`))).status).toBe(404)
    expect(
      (
        await superuserQuery(db, 'select deleted_at from app.attachments where id = $1', [
          upload.uploadId,
        ])
      )[0]?.['deleted_at'],
    ).toBeTruthy()
    expect(
      (await request(path(`/${upload.uploadId}/undo-delete`), 'POST', {}, colleague)).status,
    ).toBe(403)
    expect((await request(path(`/${upload.uploadId}/undo-delete`), 'POST', {})).status).toBe(204)
    expect((await request(path(`/${upload.uploadId}/download`))).status).toBe(200)
  })
  it('accepts arbitrary file types while rejecting mismatched and infected files; retries scanner outages', async () => {
    expect(
      (await request(path('/upload-url'), 'POST', { name: 'installer.exe', size: 12 })).status,
    ).toBe(201)
    const mismatch = await prepare(Buffer.from('not a pdf'))
    expect((await request(path(`/${mismatch.uploadId}/finalize`), 'POST', {})).status).toBe(422)
    const infected = await prepare()
    scan = 'infected'
    expect((await request(path(`/${infected.uploadId}/finalize`), 'POST', {})).status).toBe(422)
    expect((await request(path(`/${infected.uploadId}/download`))).status).toBe(404)
    const retry = await prepare()
    scan = 'down'
    expect((await request(path(`/${retry.uploadId}/finalize`), 'POST', {})).status).toBe(503)
    expect((await request(path(`/${retry.uploadId}/download`))).status).toBe(404)
    scan = 'clean'
    expect((await request(path(`/${retry.uploadId}/finalize`), 'POST', {})).status).toBe(200)
    // Deleting the card also hides its files, without erasing the bytes or attachment metadata.
    expect((await request(`/cards/${cardId}`, 'DELETE')).status).toBe(204)
    expect((await request(path(`/${retry.uploadId}/download`))).status).toBe(404)
  })
})
