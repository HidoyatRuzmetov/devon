import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'

export type Attachment = { id: string; name: string; mime: string; size: number; createdAt: string }
type Row = {
  id: string
  name: string
  mime: string
  size: number
  created_at: Date
  key: string
  uploaded_by_user_id: string
  scan_status: string
}
const dto = (row: Row): Attachment => ({
  id: row.id,
  name: row.name,
  mime: row.mime,
  size: row.size,
  createdAt: new Date(row.created_at).toISOString(),
})

export async function createPending(
  ctx: RequestContext,
  cardId: string,
  input: { id: string; name: string; mime: string; size: number; key: string },
) {
  return withContext(ctx, async (tx) => {
    await tx.raw(sql`insert into app.attachments (id, department_id, subject_type, subject_id, key, name, mime, size, uploaded_by_user_id)
      values (${input.id}, ${ctx.departmentId}, 'card', ${cardId}, ${input.key}, ${input.name}, ${input.mime}, ${input.size}, ${ctx.userId})`)
    tx.audit({
      action: 'work.attachment_upload_requested',
      subjectType: 'card',
      subjectId: cardId,
      departmentId: ctx.departmentId,
      after: { attachmentId: input.id, name: input.name, size: input.size },
    })
  })
}

export async function list(ctx: RequestContext, cardId: string) {
  return withContext(ctx, async (tx) =>
    (
      await tx.raw<Row>(sql`select * from app.attachments
    where department_id = ${ctx.departmentId} and subject_type = 'card' and subject_id = ${cardId}
      and deleted_at is null and scan_status = 'clean' order by created_at desc`)
    ).map(dto),
  )
}

export async function get(ctx: RequestContext, cardId: string, id: string) {
  return withContext(
    ctx,
    async (tx) =>
      (
        await tx.raw<Row>(sql`select * from app.attachments
    where id = ${id} and department_id = ${ctx.departmentId} and subject_type = 'card' and subject_id = ${cardId} and deleted_at is null`)
      )[0] ?? null,
  )
}

export async function finalize(
  ctx: RequestContext,
  cardId: string,
  id: string,
  key: string,
): Promise<Attachment | null> {
  return withContext(ctx, async (tx) => {
    // Lock the upload as well as the card: expiry sweep and concurrent finalisations cannot race.
    const uploads = await tx.raw<{ id: string }>(sql`select id from app.uploads where id = ${id}
      and user_id = ${ctx.userId} and purpose = 'card_attachment' and status = 'pending' and expires_at > now() for update`)
    if (!uploads[0]) return null
    const cards = await tx.raw<{ id: string }>(sql`select id from app.cards where id = ${cardId}
      and department_id = ${ctx.departmentId} and deleted_at is null for update`)
    if (!cards[0]) return null
    const rows =
      await tx.raw<Row>(sql`update app.attachments set key = ${key}, scan_status = 'clean'
      where id = ${id} and subject_id = ${cardId} and department_id = ${ctx.departmentId}
        and uploaded_by_user_id = ${ctx.userId} and deleted_at is null and scan_status = 'pending' returning *`)
    if (!rows[0]) return null
    await tx.raw(
      sql`update app.uploads set status = 'finalized', finalized_at = now(), updated_at = now() where id = ${id}`,
    )
    tx.audit({
      action: 'work.attachment_added',
      subjectType: 'card',
      subjectId: cardId,
      departmentId: ctx.departmentId,
      after: { attachmentId: id, name: rows[0].name, size: rows[0].size },
    })
    tx.emit({
      type: 'work.card.updated',
      departmentId: ctx.departmentId,
      payload: { cardId, actorUserId: ctx.userId, changes: ['attachments'] },
    })
    return dto(rows[0])
  })
}

export async function remove(ctx: RequestContext, cardId: string, id: string): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
    }>(sql`update app.attachments set deleted_at = now(), deleted_by_user_id = ${ctx.userId}
      where id = ${id} and department_id = ${ctx.departmentId} and subject_type = 'card'
        and subject_id = ${cardId} and deleted_at is null returning id`)
    if (!rows[0]) return false
    tx.audit({
      action: 'work.attachment_removed',
      subjectType: 'card',
      subjectId: cardId,
      departmentId: ctx.departmentId,
      after: { attachmentId: id },
    })
    tx.emit({
      type: 'work.card.updated',
      departmentId: ctx.departmentId,
      payload: { cardId, actorUserId: ctx.userId, changes: ['attachments'] },
    })
    return true
  })
}

export async function undoRemove(
  ctx: RequestContext,
  cardId: string,
  id: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
    }>(sql`update app.attachments set deleted_at = null, deleted_by_user_id = null
      where id = ${id} and department_id = ${ctx.departmentId} and subject_type = 'card'
        and subject_id = ${cardId} and scan_status = 'clean' and deleted_by_user_id = ${ctx.userId}
        and deleted_at >= now() - interval '30 seconds' returning id`)
    if (!rows[0]) return false
    tx.audit({
      action: 'work.attachment_restored',
      subjectType: 'card',
      subjectId: cardId,
      departmentId: ctx.departmentId,
      after: { attachmentId: id },
    })
    tx.emit({
      type: 'work.card.updated',
      departmentId: ctx.departmentId,
      payload: { cardId, actorUserId: ctx.userId, changes: ['attachments'] },
    })
    return true
  })
}

export async function rejectPending(ctx: RequestContext, id: string, infected: boolean) {
  return withContext(ctx, async (tx) => {
    await tx.raw(sql`update app.attachments set deleted_at = now(), scan_status = ${infected ? 'infected' : 'pending'}
      where id = ${id} and department_id = ${ctx.departmentId} and uploaded_by_user_id = ${ctx.userId} and scan_status = 'pending'`)
  })
}
