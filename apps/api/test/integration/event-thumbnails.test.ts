import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, configurePool } from '@devon/db'
import { buildApp } from '../../src/app.js'
import { createRepo } from '../../src/db/repo.js'
import { ScannerUnavailable } from '../../src/lib/storage/clamav.js'
import { __resetAllCircuitsForTests } from '../../src/lib/resilience/registry.js'
import { sweepExpiredUploads } from '../../src/modules/accounts/avatar-service.js'
import { startProveDatabase, type ProveDatabase } from '../checks/pg-fixture.js'
import { testConfig } from '../unit/test-app.js'
import { loginAs, seedDepartment, seedMember, superuserQuery, type Session } from './harness.js'

let db: ProveDatabase
let app: FastifyInstance
let baseUrl: string
let owner: Session
let peer: Session
let foreign: Session
let scan: 'clean' | 'infected' | 'down' = 'clean'
let image: Buffer
const storageDir = mkdtempSync(join(tmpdir(), 'devon-event-cover-'))
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
  const address = app.server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  const department = await seedDepartment(db, {
    name: 'Event covers',
    slug: `covers-${randomUUID()}`,
  })
  const other = await seedDepartment(db, {
    name: 'Other covers',
    slug: `other-covers-${randomUUID()}`,
  })
  const users = await Promise.all([
    seedMember(db, department.id, { role: 'head' }),
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, other.id, { role: 'head' }),
  ])
  ;[owner, peer, foreign] = (await Promise.all(users.map((u) => loginAs(baseUrl, u.login)))) as [
    Session,
    Session,
    Session,
  ]
  image = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#287c78' } })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer()
})
afterAll(async () => {
  try {
    if (app) await app.close()
  } finally {
    await closePool()
    if (db) await db.stop()
    rmSync(storageDir, { recursive: true, force: true })
  }
})
function request(path: string, method = 'GET', body?: unknown, session = owner) {
  return fetch(`${baseUrl}/api/v1/events${path}`, {
    method,
    headers:
      body === undefined
        ? { cookie: session.cookie, 'x-csrf-token': session.csrf }
        : session.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function upload(bytes = image): Promise<Upload> {
  const response = await request('/thumbnails/upload-url', 'POST', {
    contentType: 'image/png',
    size: bytes.length,
  })
  expect(response.status).toBe(201)
  const signed = (await response.json()) as Upload
  expect(
    (
      await fetch(`${baseUrl}${signed.url}`, {
        method: 'PUT',
        headers: { cookie: owner.cookie, ...signed.headers },
        body: bytes,
      })
    ).status,
  ).toBe(204)
  return signed
}
const finalize = (id: string, session = owner) =>
  request(`/thumbnails/${id}/finalize`, 'POST', {}, session)
const imageUrl = (id: string) => `/thumbnails/${id}`
async function create(thumbnailUploadId?: string, title = 'Cover local QA') {
  return request('', 'POST', {
    title,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    ...(thumbnailUploadId ? { thumbnailUploadId } : {}),
  })
}

describe('event thumbnail lifecycle', () => {
  it('requires clean canonical bytes and creator ownership, then shares only inside the event department', async () => {
    const pending = await upload()
    expect((await request(imageUrl(pending.uploadId))).status).toBe(404)
    expect((await create(pending.uploadId)).status).toBe(409)
    expect((await finalize(pending.uploadId, peer)).status).toBe(404)
    expect((await finalize(pending.uploadId)).status).toBe(200)
    const missingCsrf = await fetch(
      `${baseUrl}/api/v1/events/thumbnails/${pending.uploadId}/finalize`,
      {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      },
    )
    expect(missingCsrf.status).toBe(403)
    expect((await fetch(`${baseUrl}/api/v1/events${imageUrl(pending.uploadId)}`)).status).toBe(401)
    const stolen = await request(
      '',
      'POST',
      {
        title: 'Stolen cover',
        thumbnailUploadId: pending.uploadId,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      },
      peer,
    )
    expect(stolen.status).toBe(409)
    expect((await request(imageUrl(pending.uploadId), 'GET', undefined, peer)).status).toBe(404)
    const preview = await request(imageUrl(pending.uploadId))
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('image/webp')
    const canonical = Buffer.from(await preview.arrayBuffer())
    const metadata = await sharp(canonical).metadata()
    expect(metadata).toMatchObject({ width: 1200, height: 675, format: 'webp' })
    expect(metadata.exif).toBeUndefined()
    // A reused signed PUT can only affect the quarantined original, never the scanned image.
    await fetch(`${baseUrl}${pending.url}`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, ...pending.headers },
      body: image,
    })
    const created = await create(pending.uploadId)
    expect(created.status).toBe(201)
    const event = (await created.json()) as { id: string; version: number; thumbnailUrl: string }
    expect(event.thumbnailUrl).toBe(`/api/v1/events${imageUrl(pending.uploadId)}`)
    const shared = await request(imageUrl(pending.uploadId), 'GET', undefined, peer)
    expect(shared.status).toBe(200)
    expect(Buffer.from(await shared.arrayBuffer())).toEqual(canonical)
    expect((await request(imageUrl(pending.uploadId), 'GET', undefined, foreign)).status).toBe(404)
    expect((await create(pending.uploadId)).status).toBe(409)
    // The original signed PUT can be replayed until it expires. Its separately tracked quarantine
    // object must still be swept, while the published canonical image stays intact.
    const originals = await superuserQuery(
      db,
      `update app.uploads set expires_at = now() - interval '1 second'
      where key like $1 returning key`,
      [`event-thumbnails/%/${pending.uploadId}/pending`],
    )
    expect(originals).toHaveLength(1)
    await sweepExpiredUploads(app)
    expect(await app.storage.store.head(originals[0]!['key'] as string)).toBeNull()
    expect((await request(imageUrl(pending.uploadId))).status).toBe(200)
    expect(
      (
        await request(`/${event.id}`, 'PATCH', {
          title: 'Renamed cover event',
        })
      ).status,
    ).toBe(200)
    const current = await request(`/${event.id}`)
    const after = (await current.json()) as { version: number; thumbnailUrl: string }
    expect(after.thumbnailUrl).toBe(event.thumbnailUrl)
    expect((await request(`/${event.id}`, 'PATCH', { thumbnailUploadId: null })).status).toBe(200)
    expect((await request(imageUrl(pending.uploadId))).status).toBe(404)
  })

  it('rejects malformed/infected images, retains scanner-outage uploads for retry, and expires abandoned covers', async () => {
    const malformed = await upload(Buffer.from('not an image'))
    expect((await finalize(malformed.uploadId)).status).toBe(409)
    expect((await request(imageUrl(malformed.uploadId))).status).toBe(404)
    const infected = await upload()
    scan = 'infected'
    expect((await finalize(infected.uploadId)).status).toBe(409)
    expect((await request(imageUrl(infected.uploadId))).status).toBe(404)
    const retried = await upload()
    scan = 'down'
    expect((await finalize(retried.uploadId)).status).toBe(503)
    expect((await request(imageUrl(retried.uploadId))).status).toBe(404)
    scan = 'clean'
    __resetAllCircuitsForTests()
    expect((await finalize(retried.uploadId)).status).toBe(200)
    const rows = await superuserQuery(
      db,
      `update app.uploads set expires_at = now() - interval '1 second' where id = $1 returning key`,
      [retried.uploadId],
    )
    expect((await create(retried.uploadId)).status).toBe(409)
    await sweepExpiredUploads(app)
    expect(await app.storage.store.head(rows[0]!['key'] as string)).toBeNull()
    expect((await request(imageUrl(retried.uploadId))).status).toBe(404)
  })

  it('publishes only one immutable variant when finalize requests race and rolls binding back on failed event edits', async () => {
    const pending = await upload()
    const responses = await Promise.all([finalize(pending.uploadId), finalize(pending.uploadId)])
    expect(responses.map((r) => r.status)).toEqual([200, 200])
    const rows = await superuserQuery(db, `select key, status from app.uploads where id = $1`, [
      pending.uploadId,
    ])
    expect(rows[0]!['status']).toBe('pending')
    expect(await app.storage.store.head(rows[0]!['key'] as string)).not.toBeNull()
    const existing = await create()
    expect(existing.status).toBe(201)
    const event = (await existing.json()) as { id: string }
    const invalid = await request(`/${event.id}`, 'PATCH', {
      title: 'Bad date range',
      thumbnailUploadId: pending.uploadId,
      startsAt: new Date(Date.now() + 90_000_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(invalid.status).toBe(409)
    const unchanged = await superuserQuery(db, `select status from app.uploads where id = $1`, [
      pending.uploadId,
    ])
    expect(unchanged[0]!['status']).toBe('pending')
    expect((await create(pending.uploadId)).status).toBe(201)
    expect((await create()).status).toBe(201)
  })
})
