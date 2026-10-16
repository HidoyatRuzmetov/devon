import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { EventConflictError } from './errors.js'

export function thumbnailPrefix(departmentId: string, uploadId: string): string {
  return `event-thumbnails/${departmentId}/${uploadId}/`
}

export function isPreparedThumbnail(key: string, departmentId: string, uploadId: string): boolean {
  const prefix = thumbnailPrefix(departmentId, uploadId)
  return key.startsWith(prefix) && /^[a-f0-9-]{36}\.webp$/.test(key.slice(prefix.length))
}

// Binding and event creation/update share a transaction. An abandoned wizard stays pending so the
// existing upload sweeper removes its prepared image; only an event can consume the upload.
export async function claimEventThumbnail(
  tx: Tx,
  ctx: RequestContext,
  uploadId: string,
  eventId: string,
): Promise<void> {
  const rows = await tx.raw<{
    user_id: string
    key: string
    mime: string
    status: string
    expires_at: Date | string
  }>(sql`select user_id, key, mime, status, expires_at from app.uploads
    where id = ${uploadId} and purpose = 'event_thumbnail' for update`)
  const upload = rows[0]
  if (
    !upload ||
    !ctx.departmentId ||
    upload.mime !== 'image/webp' ||
    !isPreparedThumbnail(upload.key, ctx.departmentId, uploadId)
  ) {
    throw new EventConflictError('thumbnail_unavailable')
  }
  if (upload.status === 'finalized') {
    const attached = await tx.raw<{ id: string }>(sql`select id from app.events
      where id = ${eventId} and thumbnail_upload_id = ${uploadId} and deleted_at is null`)
    if (attached.length) return
  } else if (
    upload.status === 'pending' &&
    upload.user_id === ctx.userId &&
    new Date(upload.expires_at).getTime() > Date.now()
  ) {
    await tx.raw(sql`update app.uploads set status = 'finalized', finalized_at = now(),
      updated_at = now() where id = ${uploadId}`)
    return
  }
  throw new EventConflictError('thumbnail_unavailable')
}

export async function prepareThumbnail(
  ctx: RequestContext,
  input: {
    id: string
    originalKey: string
    originalMime: string
    originalSize: number
    key: string
    size: number
  },
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`with prepared as (update app.uploads
      set key = ${input.key}, mime = 'image/webp', size = ${input.size}, updated_at = now()
      where id = ${input.id} and user_id = ${ctx.userId} and purpose = 'event_thumbnail'
        and status = 'pending' and key = ${input.originalKey} and expires_at > now()
      returning user_id, expires_at)
      insert into app.uploads (id, user_id, purpose, key, mime, size, expires_at)
      select ${randomUUID()}, user_id, 'event_thumbnail', ${input.originalKey},
        ${input.originalMime}, ${input.originalSize}, expires_at + interval '1 minute' from prepared returning id`)
    if (!rows.length) return false
    // The signed PUT remains valid until expiry. Track its quarantined original separately so a
    // late re-upload is also swept after that window, even if the clean cover is already attached.
    tx.audit({
      action: 'events.thumbnail_prepared',
      subjectType: 'upload',
      subjectId: input.id,
      after: { mime: 'image/webp', size: input.size },
    })
    return true
  })
}

export async function rejectThumbnail(
  ctx: RequestContext,
  input: { id: string; originalKey: string; status: 'rejected' | 'infected'; error: string },
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`update app.uploads
      set status = ${input.status}::app.upload_status, error = ${input.error}, updated_at = now()
      where id = ${input.id} and user_id = ${ctx.userId} and purpose = 'event_thumbnail'
        and status = 'pending' and key = ${input.originalKey} returning id`)
    if (!rows.length) return false
    tx.audit({
      action: `storage.upload_${input.status}`,
      subjectType: 'upload',
      subjectId: input.id,
      after: { status: input.status, error: input.error },
    })
    return true
  })
}

export async function readableThumbnail(
  ctx: RequestContext,
  uploadId: string,
): Promise<string | null> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ key: string }>(sql`select u.key from app.uploads u
      where u.id = ${uploadId} and u.purpose = 'event_thumbnail' and u.mime = 'image/webp'
        and ((u.status = 'pending' and u.user_id = ${ctx.userId} and u.expires_at > now())
          or (u.status = 'finalized' and exists (select 1 from app.events e
            where e.thumbnail_upload_id = u.id and e.deleted_at is null)))`)
    const key = rows[0]?.key
    return key && ctx.departmentId && isPreparedThumbnail(key, ctx.departmentId, uploadId)
      ? key
      : null
  })
}
