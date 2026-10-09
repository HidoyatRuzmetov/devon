// Telegram buttons must commit the same RSVP operation as the website before acknowledging it.
// The old button emitted an action that no module consumed and claimed success immediately.
import { randomUUID } from 'node:crypto'
import { can, type Actor as Principal } from '@devon/contracts'
import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { EventForbiddenError } from './errors.js'
import { getEvent, upsertRsvp } from './service.js'

export async function recordTelegramRsvp(
  userId: string,
  departmentId: string,
  eventId: string,
  choice: 'yes' | 'no' | 'maybe',
) {
  const ctx: RequestContext = {
    requestId: randomUUID(),
    userId,
    actorRole: 'member',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '',
    userAgent: 'devon-events/telegram-rsvp',
  }
  const membership = await withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      role: 'head' | 'member'
      instance_role: 'super_admin' | 'head' | 'member'
      given_name: string
      family_name: string
    }>(sql`
      select m.role, u.role as instance_role, u.given_name, u.family_name
      from app.memberships m join app.users u on u.id = m.user_id
      join app.departments d on d.id = m.department_id
      where m.department_id = ${departmentId} and m.user_id = ${userId}
        and m.status = 'active' and m.deleted_at is null and m.left_at is null
        and u.status = 'active' and u.deleted_at is null
        and d.status = 'active' and d.deleted_at is null
    `)
    return rows[0] ?? null
  })
  if (!membership) throw new EventForbiddenError()
  const principal: Principal = {
    userId,
    role: membership.instance_role,
    memberships: [{ departmentId, role: membership.role }],
    departmentId,
    actingFor: null,
    viewAs: null,
  }
  if (!can(principal, 'update', { kind: 'department_child', departmentId }).allowed) {
    throw new EventForbiddenError()
  }
  ctx.actorRole = principal.role
  ctx.departmentRole = membership.role
  const existing = await getEvent(ctx, userId, membership.role === 'head', eventId)
  return upsertRsvp(
    ctx,
    {
      userId,
      departmentId,
      principal,
      givenName: membership.given_name,
      familyName: membership.family_name,
    },
    eventId,
    {
      status: choice,
      guests: choice === 'yes' ? (existing.myRsvp?.guests ?? 0) : 0,
      note: existing.myRsvp?.note ?? undefined,
    },
  )
}
