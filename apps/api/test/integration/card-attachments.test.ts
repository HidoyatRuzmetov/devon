import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, configurePool } from '@devon/db'
import { buildApp } from '../../src/app.js'
import { createRepo } from '../../src/db/repo.js'
import { ScannerUnavailable } from '../../src/lib/storage/clamav.js'
import { startProveDatabase, type ProveDatabase } from '../checks/pg-fixture.js'
import { testConfig } from '../unit/test-app.js'
import { loginAs, seedDepartment, seedMember, superuserQuery, type Session } from './harness.js'

let db: ProveDatabase
let app: FastifyInstance
let baseUrl: string
let auth: Session
let foreign: Session
let colleague: Session
let cardId: string
let scan: 'clean' | 'infected' | 'down' = 'clean'
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
        scanner: {
          mode: 'clamd',
          ping: async () => true,
          scan: async () => {
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
  it('rejects mismatched content, unsafe extensions and infected files; retries scanner outages without publishing', async () => {
    expect(
      (await request(path('/upload-url'), 'POST', { name: 'malware.exe', size: 12 })).status,
    ).toBe(422)
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
