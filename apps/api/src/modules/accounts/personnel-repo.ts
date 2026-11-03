import { personnelDataSchema, type PersonnelData } from '@devon/contracts'
import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'

export async function getPersonnelRecord(ctx: RequestContext, ownerUserId: string) {
  if (
    !ctx.departmentId ||
    ctx.viewAs ||
    (ctx.userId !== ownerUserId && ctx.departmentRole !== 'head')
  )
    return null
  return withContext(ctx, async (tx) => {
    const members = await tx.raw(
      sql`select 1 from app.memberships where department_id=${ctx.departmentId} and user_id=${ownerUserId} and status='active' and deleted_at is null`,
    )
    if (!members.length) return null
    const rows = await tx.raw<{ data: PersonnelData; version: number; updatedAt: string }>(
      sql`select data,version,updated_at::text as "updatedAt" from app.personnel_records where department_id=${ctx.departmentId} and owner_user_id=${ownerUserId}`,
    )
    if (ctx.userId !== ownerUserId)
      tx.audit({
        action: 'accounts.personnel_record_read',
        subjectType: 'user',
        subjectId: ownerUserId,
        after: { fields: ['personnel_record'] },
      })
    const row = rows[0]
    return {
      ownerUserId,
      data: personnelDataSchema.parse(row?.data ?? {}),
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
    }
  })
}
export async function savePersonnelRecord(
  ctx: RequestContext,
  data: PersonnelData,
  version: number,
) {
  if (!ctx.userId || !ctx.departmentId || ctx.viewAs) return null
  const ownerUserId = ctx.userId
  return withContext(ctx, async (tx) => {
    const rows =
      version === 0
        ? await tx.raw<{ version: number; updatedAt: string }>(
            sql`insert into app.personnel_records(department_id,owner_user_id,data) values(${ctx.departmentId},${ctx.userId},${JSON.stringify(data)}::jsonb) on conflict do nothing returning version,updated_at::text as "updatedAt"`,
          )
        : await tx.raw<{ version: number; updatedAt: string }>(
            sql`update app.personnel_records set data=${JSON.stringify(data)}::jsonb,version=version+1,updated_at=now() where department_id=${ctx.departmentId} and owner_user_id=${ctx.userId} and version=${version} returning version,updated_at::text as "updatedAt"`,
          )
    if (!rows[0]) return null
    tx.audit({
      action: 'accounts.personnel_record_saved',
      subjectType: 'user',
      subjectId: ctx.userId,
      after: { version: rows[0].version },
    })
    return { ownerUserId, data, ...rows[0] }
  })
}
