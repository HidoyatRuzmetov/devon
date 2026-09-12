// The whole photo-upload pipeline (TECH-SPEC §2.1 "presigned upload, ClamAV, 512 px WebP variants"),
// end to end, against the in-memory fake `Deps` and the storage plugin's local-disk driver in a temp
// directory (`test-app.ts`): presign -> PUT bytes -> finalise -> variants on disk + `avatar_key` set,
// plus every refusal (wrong owner, expired, size mismatch, not an image, ClamAV "FOUND", ClamAV down,
// removal). Real bytes go through real sharp; the only fake is the scanner, injected through
// `buildApp()`'s test seam so the infected/unavailable paths need no clamd.
import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { ScannerUnavailable, type MalwareScanner } from '../../../src/lib/storage/clamav.js'
import type { LocalStore } from '../../../src/lib/storage/local-store.js'
import { __resetAllCircuitsForTests } from '../../../src/lib/resilience/registry.js'
import { createFakeState, type FakeState } from '../fake-deps.js'
import { seedUser } from '../seed.js'
import { buildTestApp, cookieHeader, parseSetCookies } from '../test-app.js'

const PASSWORD = 'Str0ngExampleValue123'

// The `clamav` circuit breaker (`lib/resilience/registry.ts`) is a process-wide singleton -- without
// this, a `downScanner` test earlier in this file could leave it consuming the very failure budget a
// later test relies on being fresh (H8.1's breaker is deliberately global per process, not per test).
afterEach(() => {
  __resetAllCircuitsForTests()
})

type App = Awaited<ReturnType<typeof buildTestApp>>['app']

async function signIn(app: App, login: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login, password: PASSWORD },
  })
  const cookies = parseSetCookies(res.headers['set-cookie'])
  return { cookie: cookieHeader(cookies), csrf: cookies['devon_csrf'] ?? '' }
}

/** A real 300x200 PNG with a coloured gradient, so a resize actually has something to crop. */
async function samplePng(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 200, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .png()
    .toBuffer()
}

async function requestUrl(
  app: App,
  auth: { cookie: string; csrf: string },
  body: { contentType: string; size: number },
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/avatar/upload-url',
    headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
    payload: body,
  })
  return res
}

async function putBytes(
  app: App,
  auth: { cookie: string },
  presigned: { url: string; headers: Record<string, string> },
  bytes: Buffer,
) {
  return app.inject({
    method: 'PUT',
    url: presigned.url,
    headers: { cookie: auth.cookie, ...presigned.headers },
    payload: bytes,
  })
}

async function finalize(app: App, auth: { cookie: string; csrf: string }, uploadId: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/accounts/avatar',
    headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
    payload: { uploadId },
  })
}

async function setup(scanner?: MalwareScanner, state: FakeState = createFakeState()) {
  const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
  const built = await buildTestApp(state, scanner ? { storage: { scanner } } : {})
  const auth = await signIn(built.app, user.login)
  return { ...built, user, auth }
}

describe('POST /api/v1/accounts/avatar/upload-url', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/avatar/upload-url',
      payload: { contentType: 'image/png', size: 10 },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('requires the CSRF header even with a valid session', async () => {
    const { app, auth } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/avatar/upload-url',
      headers: { cookie: auth.cookie },
      payload: { contentType: 'image/png', size: 10 },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('rejects a MIME type outside the allow-list and an oversize declaration with 422', async () => {
    const { app, auth } = await setup()
    const svg = await requestUrl(app, auth, { contentType: 'image/svg+xml', size: 10 })
    expect(svg.statusCode).toBe(422)
    const huge = await requestUrl(app, auth, { contentType: 'image/png', size: 6 * 1024 * 1024 })
    expect(huge.statusCode).toBe(422)
    await app.close()
  })

  it('issues a presigned PUT bound to the declared content type and records a pending upload', async () => {
    const { app, auth, state, user } = await setup()
    const res = await requestUrl(app, auth, { contentType: 'image/png', size: 1234 })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.method).toBe('PUT')
    expect(body.headers['content-type']).toBe('image/png')
    expect(body.url).toMatch(/^\/api\/v1\/storage\/uploads\?token=/)
    expect(state.uploads).toHaveLength(1)
    expect(state.uploads[0]).toMatchObject({
      id: body.uploadId,
      userId: user.id,
      status: 'pending',
      mime: 'image/png',
      size: 1234,
    })
    // H1.8: a random, server-chosen key -- no filename was ever sent, none can appear.
    expect(state.uploads[0]!.key).toBe(`avatars/${user.id}/${body.uploadId}/original`)
    expect(state.auditEvents.some((e) => e.action === 'storage.upload_requested')).toBe(true)
    await app.close()
  })
})

describe('the happy path: presign -> PUT -> finalise', () => {
  it('writes 64/128/512 WebP variants, sets avatar_key, audits and deletes the original', async () => {
    const { app, auth, state, user } = await setup()
    const png = await samplePng()

    const urlRes = await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    const presigned = urlRes.json()
    const put = await putBytes(app, auth, presigned, png)
    expect(put.statusCode).toBe(204)

    const fin = await finalize(app, auth, presigned.uploadId)
    expect(fin.statusCode).toBe(200)
    const prefix = `avatars/${user.id}/${presigned.uploadId}`
    expect(fin.json().user.avatarKey).toBe(prefix)
    expect(state.users[0]!.avatarKey).toBe(prefix)
    expect(state.uploads[0]!.status).toBe('finalized')
    expect(state.auditEvents.some((e) => e.action === 'accounts.avatar_updated')).toBe(true)

    const store = app.storage.store as LocalStore
    for (const size of [64, 128, 512]) {
      const path = store.pathFor(`${prefix}/${size}.webp`)
      expect(existsSync(path), `${size}.webp exists`).toBe(true)
      const meta = await sharp(path).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.width).toBe(size)
      expect(meta.height).toBe(size)
      // Metadata stripped: no EXIF/ICC/XMP blobs survive into a served variant.
      expect(meta.exif).toBeUndefined()
    }
    expect(existsSync(store.pathFor(`${prefix}/original`))).toBe(false)

    // The variant is served to any signed-in user, immutable-cacheable, as image/webp.
    const img = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/avatar/${user.id}/${presigned.uploadId}/128`,
      headers: { cookie: auth.cookie },
    })
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/webp')
    expect(img.headers['cache-control']).toContain('immutable')
    expect(img.rawPayload.subarray(0, 4).toString('ascii')).toBe('RIFF')

    // ... but never to an anonymous caller.
    const anon = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/avatar/${user.id}/${presigned.uploadId}/128`,
    })
    expect(anon.statusCode).toBe(401)
    await app.close()
  })

  it('replacing a photo deletes the previous variants', async () => {
    const { app, auth, user } = await setup()
    const png = await samplePng()
    const store = app.storage.store as LocalStore

    const first = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, first, png)
    expect((await finalize(app, auth, first.uploadId)).statusCode).toBe(200)
    const firstPrefix = `avatars/${user.id}/${first.uploadId}`
    expect(existsSync(store.pathFor(`${firstPrefix}/512.webp`))).toBe(true)

    const second = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, second, png)
    expect((await finalize(app, auth, second.uploadId)).statusCode).toBe(200)
    expect(existsSync(store.pathFor(`${firstPrefix}/512.webp`))).toBe(false)
    expect(existsSync(store.pathFor(`avatars/${user.id}/${second.uploadId}/512.webp`))).toBe(true)
    await app.close()
  })

  it('DELETE /avatar clears avatar_key and removes the variants', async () => {
    const { app, auth, state, user } = await setup()
    const png = await samplePng()
    const store = app.storage.store as LocalStore
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, presigned, png)
    await finalize(app, auth, presigned.uploadId)
    const prefix = `avatars/${user.id}/${presigned.uploadId}`

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/accounts/avatar',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
    })
    expect(del.statusCode).toBe(204)
    expect(state.users[0]!.avatarKey).toBeNull()
    expect(existsSync(store.pathFor(`${prefix}/64.webp`))).toBe(false)
    expect(state.auditEvents.some((e) => e.action === 'accounts.avatar_removed')).toBe(true)

    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/avatar/${user.id}/${presigned.uploadId}/64`,
      headers: { cookie: auth.cookie },
    })
    expect(gone.statusCode).toBe(404)
    await app.close()
  })
})

describe('the local driver PUT route', () => {
  it('404s a token minted for another user, and a tampered token', async () => {
    const state = createFakeState()
    const { app, auth } = await setup(undefined, state)
    const other = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const otherAuth = await signIn(app, other.login)

    const presigned = (await requestUrl(app, auth, { contentType: 'image/png', size: 10 })).json()
    const asOther = await putBytes(app, otherAuth, presigned, Buffer.alloc(10))
    expect(asOther.statusCode).toBe(404)

    const tampered = { ...presigned, url: presigned.url.slice(0, -2) + 'zz' }
    const bad = await putBytes(app, auth, tampered, Buffer.alloc(10))
    expect(bad.statusCode).toBe(404)
    await app.close()
  })

  it('requires the content type the URL was signed for', async () => {
    const { app, auth } = await setup()
    const presigned = (await requestUrl(app, auth, { contentType: 'image/png', size: 10 })).json()
    const res = await putBytes(
      app,
      auth,
      { ...presigned, headers: { 'content-type': 'image/jpeg' } },
      Buffer.alloc(10),
    )
    expect(res.statusCode).toBe(422)
    await app.close()
  })

  it('413s a body past the upload limit instead of buffering it', async () => {
    const { app, auth } = await setup()
    const presigned = (await requestUrl(app, auth, { contentType: 'image/png', size: 10 })).json()
    const res = await putBytes(app, auth, presigned, Buffer.alloc(6 * 1024 * 1024))
    expect(res.statusCode).toBe(413)
    expect(res.json().code).toBe('validation_failed')
    await app.close()
  })
})

describe('POST /api/v1/accounts/avatar refusals', () => {
  it('404s an upload id that belongs to someone else, exactly like an unknown one', async () => {
    const state = createFakeState()
    const { app, auth } = await setup(undefined, state)
    const other = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const otherAuth = await signIn(app, other.login)
    const presigned = (await requestUrl(app, auth, { contentType: 'image/png', size: 10 })).json()

    const res = await finalize(app, otherAuth, presigned.uploadId)
    expect(res.statusCode).toBe(404)
    const unknown = await finalize(app, auth, '00000000-0000-4000-8000-000000000000')
    expect(unknown.statusCode).toBe(404)
    await app.close()
  })

  it('409s when no bytes ever arrived', async () => {
    const { app, auth } = await setup()
    const presigned = (await requestUrl(app, auth, { contentType: 'image/png', size: 10 })).json()
    const res = await finalize(app, auth, presigned.uploadId)
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('410s an expired upload and expires the row', async () => {
    const { app, auth, state } = await setup()
    const presigned = (await requestUrl(app, auth, { contentType: 'image/png', size: 10 })).json()
    state.uploads[0]!.expiresAt = new Date(Date.now() - 1000)
    const res = await finalize(app, auth, presigned.uploadId)
    expect(res.statusCode).toBe(410)
    expect(state.uploads[0]!.status).toBe('expired')
    await app.close()
  })

  it('422s bytes whose size differs from the declaration, and deletes them', async () => {
    const { app, auth, state } = await setup()
    const png = await samplePng()
    const store = app.storage.store as LocalStore
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length + 1 })
    ).json()
    await putBytes(app, auth, presigned, png)
    const res = await finalize(app, auth, presigned.uploadId)
    expect(res.statusCode).toBe(422)
    expect(res.json().errors).toEqual([{ path: 'file', code: 'size_mismatch' }])
    expect(state.uploads[0]!.status).toBe('rejected')
    expect(existsSync(store.pathFor(state.uploads[0]!.key))).toBe(false)
    await app.close()
  })

  it('422s bytes that are not the declared image format (a renamed text file)', async () => {
    const { app, auth, state } = await setup()
    const junk = Buffer.from('<svg onload="alert(1)"></svg>', 'utf8')
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: junk.length })
    ).json()
    await putBytes(app, auth, presigned, junk)
    const res = await finalize(app, auth, presigned.uploadId)
    expect(res.statusCode).toBe(422)
    expect(res.json().errors).toEqual([{ path: 'file', code: 'not_an_image' }])
    expect(state.uploads[0]!.status).toBe('rejected')
    expect(state.users[0]!.avatarKey).toBeNull()
    await app.close()
  })

  it('422s a JPEG uploaded under a PNG declaration (magic bytes disagree with the MIME)', async () => {
    const { app, auth } = await setup()
    const jpeg = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer()
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: jpeg.length })
    ).json()
    await putBytes(app, auth, { ...presigned, headers: { 'content-type': 'image/png' } }, jpeg)
    const res = await finalize(app, auth, presigned.uploadId)
    expect(res.statusCode).toBe(422)
    expect(res.json().errors).toEqual([{ path: 'file', code: 'mime_mismatch' }])
    await app.close()
  })

  it('409s a second finalise of the same upload', async () => {
    const { app, auth } = await setup()
    const png = await samplePng()
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, presigned, png)
    expect((await finalize(app, auth, presigned.uploadId)).statusCode).toBe(200)
    expect((await finalize(app, auth, presigned.uploadId)).statusCode).toBe(409)
    await app.close()
  })
})

describe('ClamAV before visibility', () => {
  const infectedScanner: MalwareScanner = {
    mode: 'clamd',
    async scan() {
      return { verdict: 'infected', signature: 'Win.Test.EICAR_HDB-1' }
    },
    async ping() {
      return true
    },
  }
  const downScanner: MalwareScanner = {
    mode: 'clamd',
    async scan() {
      throw new ScannerUnavailable('connection refused')
    },
    async ping() {
      return false
    },
  }

  it('a FOUND verdict rejects the upload, deletes the object, and never touches avatar_key', async () => {
    const { app, auth, state } = await setup(infectedScanner)
    const png = await samplePng()
    const store = app.storage.store as LocalStore
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, presigned, png)

    const res = await finalize(app, auth, presigned.uploadId)
    expect(res.statusCode).toBe(422)
    expect(res.json().errors).toEqual([{ path: 'file', code: 'infected' }])
    // The signature name is audited, not returned (design.md §1.5: fixed sentences and codes only).
    expect(JSON.stringify(res.json())).not.toContain('EICAR')
    expect(state.uploads[0]!.status).toBe('infected')
    expect(state.uploads[0]!.error).toBe('Win.Test.EICAR_HDB-1')
    expect(state.users[0]!.avatarKey).toBeNull()
    expect(existsSync(store.pathFor(state.uploads[0]!.key))).toBe(false)
    expect(
      existsSync(store.pathFor(`avatars/${state.users[0]!.id}/${presigned.uploadId}/64.webp`)),
    ).toBe(false)
    await app.close()
  })

  // H8.1 graceful degradation: an outage is "not yet scanned", not "rejected" -- the upload stays
  // `pending` with its bytes intact (queued for the retry worker or a later client retry) instead of
  // being deleted on the very first failed attempt, the way it used to be. Nothing becomes visible
  // either way: `avatarKey` stays null, and only a *clean* scan can ever change that.
  it('a scanner outage: 503, upload left pending with its bytes intact, nothing becomes visible', async () => {
    const { app, auth, state } = await setup(downScanner)
    const png = await samplePng()
    const store = app.storage.store as LocalStore
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, presigned, png)

    const res = await finalize(app, auth, presigned.uploadId)
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('maintenance')
    expect(state.uploads[0]!.status).toBe('pending')
    expect(state.users[0]!.avatarKey).toBeNull()
    expect(existsSync(store.pathFor(state.uploads[0]!.key))).toBe(true)
    await app.close()
  })

  it('retrying the same finalize call once the scanner recovers finishes the upload', async () => {
    const { app, auth, state, user } = await setup(downScanner)
    const png = await samplePng()
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, presigned, png)

    const down = await finalize(app, auth, presigned.uploadId)
    expect(down.statusCode).toBe(503)
    expect(state.uploads[0]!.status).toBe('pending')

    // ClamAV comes back: swap the storage plugin's scanner for a clean one (the same test seam
    // `setup()` uses) and retry the exact same request the client already knows how to repeat.
    app.storage.scanner = {
      mode: 'clamd',
      async scan() {
        return { verdict: 'clean' as const }
      },
      async ping() {
        return true
      },
    }
    const recovered = await finalize(app, auth, presigned.uploadId)
    expect(recovered.statusCode).toBe(200)
    expect(state.uploads[0]!.status).toBe('finalized')
    expect(state.users[0]!.avatarKey).toBe(`avatars/${user.id}/${presigned.uploadId}`)
    await app.close()
  })

  it('retryPendingScans (the background worker) finalizes a pending upload once ClamAV recovers', async () => {
    const { app, auth, state } = await setup(downScanner)
    const png = await samplePng()
    const presigned = (
      await requestUrl(app, auth, { contentType: 'image/png', size: png.length })
    ).json()
    await putBytes(app, auth, presigned, png)
    expect((await finalize(app, auth, presigned.uploadId)).statusCode).toBe(503)
    expect(state.uploads[0]!.status).toBe('pending')

    app.storage.scanner = {
      mode: 'clamd',
      async scan() {
        return { verdict: 'clean' as const }
      },
      async ping() {
        return true
      },
    }
    const { retryPendingScans } = await import('../../../src/modules/accounts/avatar-service.js')
    const summary = await retryPendingScans(app)
    expect(summary).toMatchObject({ checked: 1, finalized: 1, stillPending: 0 })
    expect(state.uploads[0]!.status).toBe('finalized')
    expect(state.users[0]!.avatarKey).not.toBeNull()
    await app.close()
  })
})
