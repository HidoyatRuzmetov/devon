// EPIC-001 photo upload evidence producer (design.md §9), against a REAL Postgres: the unit suite
// (`test/unit/accounts/avatar.test.ts`) proves the pipeline over the in-memory fake `Deps`; this script
// proves the raw SQL in `src/db/repo.ts` (`app.uploads` insert/select/update, `users.avatar_key`, the
// audit + outbox rows, the retention sweep) by driving the same HTTP flow end to end through
// `createRepo()` on a migrated Testcontainers database, with the local-disk storage driver in a temp
// directory. Run with `pnpm --filter @devon/api avatar:prove`.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'

const PASSWORD = 'Str0ngExampleValue123'

async function main(): Promise<void> {
  const storageDir = mkdtempSync(join(tmpdir(), 'devon-avatar-prove-'))
  const db = await startProveDatabase()
  const server = await startProveServer(db, { STORAGE_LOCAL_DIR: storageDir })
  console.log(`api listening at ${server.baseUrl}; storage in ${storageDir}`)
  const sql = new Client({ connectionString: db.superuserUrl })
  await sql.connect()

  try {
    step('POST /api/v1/accounts/register (a fresh account, no photo yet)')
    const reg = await fetch(`${server.baseUrl}/api/v1/accounts/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'avatar.prove',
        password: PASSWORD,
        givenName: 'Nodira',
        familyName: 'Karimova',
      }),
    })
    assertEqual(reg.status, 201, 'register status')
    const cookies = parseCookies(reg.headers.getSetCookie())
    const cookie = cookieHeader(cookies)
    const csrf = cookies['devon_csrf'] ?? ''
    const registered = (await reg.json()) as {
      user: { id: string; avatarKey: string | null }
      csrfToken: string
    }
    assertEqual(registered.user.avatarKey, null, 'avatarKey starts null')
    // The register body must carry the real CSRF token: the SPA uses it for the photo upload that
    // follows registration, before any /me round trip (it was an empty string until this was fixed).
    assertEqual(registered.csrfToken, csrf, 'register body csrfToken equals the devon_csrf cookie')
    assertTrue(csrf.length > 20, 'csrf token is non-trivial')
    const userId = registered.user.id
    const authed = { cookie, 'x-csrf-token': csrf }

    step('POST /accounts/avatar/upload-url -> app.uploads row (pending)')
    const png = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 80, b: 40 } },
    })
      .png()
      .toBuffer()
    const urlRes = await fetch(`${server.baseUrl}/api/v1/accounts/avatar/upload-url`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/png', size: png.length }),
    })
    assertEqual(urlRes.status, 200, 'upload-url status')
    const presigned = (await urlRes.json()) as {
      uploadId: string
      url: string
      method: string
      headers: Record<string, string>
    }
    const pendingRow = await sql.query(
      'select status::text, key, mime, size from app.uploads where id = $1',
      [presigned.uploadId],
    )
    assertEqual(pendingRow.rows[0]?.status, 'pending', 'app.uploads.status after presign')
    assertEqual(
      pendingRow.rows[0]?.key,
      `avatars/${userId}/${presigned.uploadId}/original`,
      'app.uploads.key is the random server key',
    )

    step('PUT the bytes to the presigned URL (local driver route)')
    const put = await fetch(`${server.baseUrl}${presigned.url}`, {
      method: 'PUT',
      headers: { cookie, ...presigned.headers },
      body: png,
    })
    assertEqual(put.status, 204, 'PUT status')

    step('POST /accounts/avatar -> scan + sharp + users.avatar_key, in one transaction')
    const fin = await fetch(`${server.baseUrl}/api/v1/accounts/avatar`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: presigned.uploadId }),
    })
    assertEqual(fin.status, 200, 'finalize status')
    const prefix = `avatars/${userId}/${presigned.uploadId}`
    const finBody = (await fin.json()) as { user: { avatarKey: string | null } }
    assertEqual(finBody.user.avatarKey, prefix, 'avatarKey in the finalize body')
    const userRow = await sql.query('select avatar_key from app.users where id = $1', [userId])
    assertEqual(userRow.rows[0]?.avatar_key, prefix, 'app.users.avatar_key persisted')
    const finRow = await sql.query(
      'select status::text, finalized_at from app.uploads where id = $1',
      [presigned.uploadId],
    )
    assertEqual(finRow.rows[0]?.status, 'finalized', 'app.uploads.status after finalize')
    assertTrue(finRow.rows[0]?.finalized_at instanceof Date, 'app.uploads.finalized_at set')
    const audit = await sql.query(
      `select action from audit.events where action in ('storage.upload_requested', 'accounts.avatar_updated') order by action`,
    )
    assertEqual(
      audit.rows.map((r: { action: string }) => r.action).join(','),
      'accounts.avatar_updated,storage.upload_requested',
      'audit events written',
    )
    const outbox = await sql.query(
      `select count(*)::int as n from app.outbox_events where type = 'accounts.user.avatar_updated'`,
    )
    assertEqual(outbox.rows[0]?.n, 1, 'outbox event emitted in the same transaction')

    step('GET /me reflects the photo; the variant is served as image/webp')
    const me = await fetch(`${server.baseUrl}/api/v1/me`, { headers: { cookie } })
    const meBody = (await me.json()) as { user: { avatarKey: string | null } }
    assertEqual(meBody.user.avatarKey, prefix, 'GET /me avatarKey')
    const img = await fetch(
      `${server.baseUrl}/api/v1/accounts/avatar/${userId}/${presigned.uploadId}/512`,
      {
        headers: { cookie },
      },
    )
    assertEqual(img.status, 200, 'variant status')
    assertEqual(img.headers.get('content-type'), 'image/webp', 'variant content-type')
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata()
    assertEqual(`${meta.format}:${meta.width}x${meta.height}`, 'webp:512x512', 'variant decodes')

    step('a size mismatch marks the row rejected (markUpload SQL)')
    const badUrl = (await (
      await fetch(`${server.baseUrl}/api/v1/accounts/avatar/upload-url`, {
        method: 'POST',
        headers: { ...authed, 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: 'image/png', size: png.length + 7 }),
      })
    ).json()) as { uploadId: string; url: string; headers: Record<string, string> }
    await fetch(`${server.baseUrl}${badUrl.url}`, {
      method: 'PUT',
      headers: { cookie, ...badUrl.headers },
      body: png,
    })
    const badFin = await fetch(`${server.baseUrl}/api/v1/accounts/avatar`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: badUrl.uploadId }),
    })
    assertEqual(badFin.status, 422, 'size-mismatch finalize status')
    const badRow = await sql.query('select status::text, error from app.uploads where id = $1', [
      badUrl.uploadId,
    ])
    assertEqual(badRow.rows[0]?.status, 'rejected', 'app.uploads.status after rejection')
    assertEqual(badRow.rows[0]?.error, 'size_mismatch', 'app.uploads.error code')

    step('the retention sweep expires a pending upload past its window (expirePendingUploads SQL)')
    const stale = (await (
      await fetch(`${server.baseUrl}/api/v1/accounts/avatar/upload-url`, {
        method: 'POST',
        headers: { ...authed, 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: 'image/jpeg', size: 100 }),
      })
    ).json()) as { uploadId: string }
    const swept = await server.deps.expirePendingUploads(new Date(Date.now() + 3600_000), 50)
    assertEqual(
      swept.map((u) => u.id).includes(stale.uploadId),
      true,
      'sweep returned the pending upload',
    )
    const sweptRow = await sql.query('select status::text from app.uploads where id = $1', [
      stale.uploadId,
    ])
    assertEqual(sweptRow.rows[0]?.status, 'expired', 'app.uploads.status after sweep')

    step('DELETE /accounts/avatar clears avatar_key (setUserAvatar SQL, null branch)')
    const del = await fetch(`${server.baseUrl}/api/v1/accounts/avatar`, {
      method: 'DELETE',
      headers: authed,
    })
    assertEqual(del.status, 204, 'delete status')
    const cleared = await sql.query('select avatar_key from app.users where id = $1', [userId])
    assertEqual(cleared.rows[0]?.avatar_key, null, 'app.users.avatar_key cleared')
    const gone = await fetch(
      `${server.baseUrl}/api/v1/accounts/avatar/${userId}/${presigned.uploadId}/64`,
      {
        headers: { cookie },
      },
    )
    assertEqual(gone.status, 404, 'variant gone after removal')

    console.log('\navatar:prove PASSED')
  } finally {
    await sql.end()
    await server.stop()
    await db.stop()
    rmSync(storageDir, { recursive: true, force: true })
  }
}

main().catch((err: unknown) => {
  console.error('\navatar:prove FAILED')
  console.error(err)
  process.exit(1)
})
