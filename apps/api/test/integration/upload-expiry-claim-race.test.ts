import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closePool, configurePool, withContext, type RequestContext } from '@devon/db'
import { createRepo } from '../../src/db/repo.js'
import { claimEventThumbnail } from '../../src/modules/events/thumbnail-repo.js'
import { cleanupFixtures } from '../../../../scripts/testcontainers-cleanup.mjs'
import { startProveDatabase, type ProveDatabase } from '../checks/pg-fixture.js'

let db: ProveDatabase
let admin: Client
let ctx: RequestContext
beforeAll(async () => {
  db = await startProveDatabase()
  configurePool(db.appUrl)
  admin = new Client({ connectionString: db.superuserUrl })
  await admin.connect()
  const departmentId = randomUUID()
  const userId = randomUUID()
  await admin.query('insert into app.departments (id, name, slug) values ($1,$2,$3)', [
    departmentId,
    'Upload claim expiry fixture',
    `upload-expiry-${departmentId}`,
  ])
  await admin.query(
    `insert into app.users (id,login,password_hash,given_name,family_name,role)
      values ($1,$2,'not-used-no-login','Upload','Fixture','member')`,
    [userId, `upload.expiry.${userId}`],
  )
  await admin.query(
    `insert into app.memberships (department_id,user_id,role) values ($1,$2,'member')`,
    [departmentId, userId],
  )
  ctx = {
    requestId: randomUUID(),
    userId,
    actorRole: 'member',
    departmentId,
    departmentRole: 'member',
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'Local upload expiry race fixture',
  }
})
afterAll(async () => {
  await cleanupFixtures(
    async () => {
      if (admin) await admin.end()
    },
    closePool,
    async () => {
      if (db) await db.stop()
    },
  )
})

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('does not expire a cover finalized while the sweeper waits for its upload row lock', async () => {
  const uploadId = randomUUID()
  const eventId = randomUUID()
  const repository = createRepo()
  const expiresAt = new Date(Date.now() + 60_000)
  const key = `event-thumbnails/${ctx.departmentId}/${uploadId}/${randomUUID()}.webp`
  await repository.createUpload(
    {
      id: uploadId,
      userId: ctx.userId!,
      purpose: 'event_thumbnail',
      key,
      mime: 'image/webp',
      size: 100,
      expiresAt,
    },
    ctx,
  )
  const claimed = barrier()
  const release = barrier()
  const claim = withContext(ctx, async (tx) => {
    await claimEventThumbnail(tx, ctx, uploadId, eventId)
    await tx.raw(sql`insert into app.events
      (id,department_id,organizer_user_id,title,starts_at,ends_at,thumbnail_upload_id)
      values (${eventId},${ctx.departmentId},${ctx.userId},'Committed thumbnail',
        now() + interval '1 day', now() + interval '2 days', ${uploadId})`)
    claimed.resolve()
    await release.promise
  })
  // Advance the sweep cutoff beyond this upload's logical expiry while the earlier valid event
  // claim remains uncommitted. The production query must recheck current status after locking.
  let sweep: ReturnType<typeof repository.expirePendingUploads> | undefined
  try {
    await Promise.race([claimed.promise, claim])
    sweep = repository.expirePendingUploads(new Date(expiresAt.getTime() + 1), 200)
    const deadline = Date.now() + 10_000
    let waiting = false
    while (Date.now() < deadline) {
      const rows = await admin.query<{ waiting: boolean }>(`select exists (
        select 1 from pg_stat_activity where datname = current_database()
          and wait_event_type = 'Lock' and query like '%update app.uploads set status%'
          and query like '%expired%') as waiting`)
      waiting = rows.rows[0]!.waiting
      if (waiting) break
      await pause(25)
    }
    expect(waiting, 'the real sweeper must be waiting on the active claim row lock').toBe(true)
    release.resolve()
    await claim
    expect(await sweep).toEqual([])
    const result = await admin.query(
      `select u.status,e.thumbnail_upload_id from app.uploads u
        join app.events e on e.thumbnail_upload_id=u.id where u.id=$1`,
      [uploadId],
    )
    expect(result.rows).toEqual([{ status: 'finalized', thumbnail_upload_id: uploadId }])
  } finally {
    release.resolve()
    await Promise.allSettled([claim, ...(sweep ? [sweep] : [])])
  }
})
