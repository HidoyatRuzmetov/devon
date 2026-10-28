import type { CheckinBoard, CheckinEntry, CheckinMember, ProblemCode } from '@devon/contracts'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { sql } from 'drizzle-orm'
import { addDays, currentCheckinStart, cycleDates, tashkentDay } from './calendar.js'

export class CheckinError extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly reason: string,
  ) {
    super(reason)
  }
}
type CycleRow = {
  id: string
  starts_on: string
  ends_on: string
  checkin_deadline: Date
  checkout_deadline: Date
  checkin_locked_at: Date | null
  checkout_locked_at: Date | null
}
const cycleColumns = sql`id,starts_on::text,ends_on::text,checkin_deadline,checkout_deadline,checkin_locked_at,checkout_locked_at`
function changed(tx: Tx, ctx: RequestContext, action: string, id: string, after?: unknown) {
  tx.audit({ action: `checkins.${action}`, subjectType: 'checkin', subjectId: id, after })
  tx.emit({
    type: 'checkins.updated',
    departmentId: ctx.departmentId,
    payload: { id, actorUserId: ctx.userId },
  })
}

/** Serialises cycle administration and mutations per department. Source checklist writes acquire
 * cycle row locks in the trigger; callers which also edit a source must lock that source first. */
export async function maintainCycles(
  tx: Tx,
  ctx: RequestContext,
  now = new Date(),
): Promise<string> {
  await tx.raw(
    sql`select pg_advisory_xact_lock(hashtextextended(${`checkins:${ctx.departmentId}`},0))`,
  )
  const currentStart = currentCheckinStart(now)
  const latest = await tx.raw<{ starts_on: string }>(
    sql`select starts_on::text from app.checkin_cycles order by starts_on desc limit 1`,
  )
  const first = latest[0]?.starts_on ?? currentStart
  // Bounded calendar catch-up, not an N+1 render query. Each cycle depends on the previous snapshot.
  // nosemgrep: devon-query-in-loop -- Each cycle carries the preceding frozen snapshot forward; chronological writes are dependent.
  for (let day = first; day <= currentStart; day = addDays(day, 14)) {
    const dates = cycleDates(day)
    // nosemgrep: query-in-loop
    const rows = await tx.raw<CycleRow>(sql`insert into app.checkin_cycles
      (department_id,starts_on,ends_on,checkin_deadline,checkout_deadline)
      values(${ctx.departmentId},${day},${dates.endsOn},${dates.checkinDeadline},${dates.checkoutDeadline})
      on conflict(department_id,starts_on) do update set starts_on=excluded.starts_on returning ${cycleColumns}`)
    const cycle = rows[0]!
    // A removed entry is a tombstone: a subsequent refresh must not re-add a declined carryover.
    // nosemgrep: query-in-loop
    const carried = await tx.raw<{ id: string }>(sql`insert into app.checkin_entries
      (department_id,cycle_id,checklist_item_id,card_id,member_user_id,member_name,unit_id,unit_name,unit_colour,
       card_title,project_id,project_title,text,state)
      select e.department_id,${cycle.id},e.checklist_item_id,e.card_id,e.member_user_id,e.member_name,e.unit_id,e.unit_name,e.unit_colour,
        e.card_title,e.project_id,e.project_title,e.text,e.state
      from app.checkin_entries e join app.checkin_cycles previous on previous.id=e.cycle_id
      where previous.starts_on=${addDays(day, -14)}::date and previous.checkout_locked_at is not null
        and e.removed_at is null and e.state<>'done' and ${cycle.checkout_locked_at}::timestamptz is null
      on conflict(cycle_id,checklist_item_id) do nothing returning id`)
    if (carried.length) changed(tx, ctx, 'carried', cycle.id, { count: carried.length })
    if (!cycle.checkin_locked_at && cycle.checkin_deadline <= now) {
      // nosemgrep: query-in-loop
      await tx.raw(
        sql`update app.checkin_cycles set checkin_locked_at=checkin_deadline where id=${cycle.id}`,
      )
      changed(tx, ctx, 'checkin_locked', cycle.id, { automatic: true })
    }
    if (!cycle.checkout_locked_at && cycle.checkout_deadline <= now) {
      // nosemgrep: query-in-loop
      await tx.raw(
        sql`update app.checkin_cycles set checkout_locked_at=checkout_deadline where id=${cycle.id}`,
      )
      changed(tx, ctx, 'checkout_locked', cycle.id, { automatic: true })
    }
  }
  const current = await tx.raw<{ id: string }>(
    sql`select id from app.checkin_cycles where starts_on=${currentStart}::date`,
  )
  return current[0]!.id
}

async function cycleForEdit(tx: Tx, id: string): Promise<CycleRow> {
  const rows = await tx.raw<CycleRow>(
    sql`select ${cycleColumns} from app.checkin_cycles where id=${id} for update`,
  )
  const cycle = rows[0]
  if (!cycle) throw new CheckinError('not_found', 'cycle_not_found')
  if (cycle.checkout_locked_at || cycle.checkout_deadline <= new Date())
    throw new CheckinError('conflict', 'checkout_locked')
  return cycle
}

export async function board(ctx: RequestContext, selectedId?: string): Promise<CheckinBoard> {
  return withContext(ctx, async (tx) => {
    const currentCycleId = await maintainCycles(tx, ctx)
    const selectedCycleId = selectedId ?? currentCycleId
    const cycles = await tx.raw<CycleRow>(
      sql`select ${cycleColumns} from app.checkin_cycles order by starts_on`,
    )
    if (!cycles.some((c) => c.id === selectedCycleId))
      throw new CheckinError('not_found', 'cycle_not_found')
    const members =
      await tx.raw<CheckinMember>(sql`select u.id as "userId",u.given_name as "givenName",u.family_name as "familyName",
      u.avatar_key as "avatarKey",unit.id as "unitId",unit.name as "unitName",unit.colour as "unitColour"
      from app.memberships m join app.users u on u.id=m.user_id
      left join lateral(select un.* from app.unit_roles ur join app.units un on un.id=ur.unit_id and un.deleted_at is null
        where ur.user_id=u.id and ur.department_id=m.department_id and ur.deleted_at is null order by un.sort,un.name,un.id limit 1) unit on true
      where m.department_id=${ctx.departmentId} and m.role<>'head' and m.status='active' and m.deleted_at is null and u.deleted_at is null
      order by unit.sort nulls last,unit.name,u.family_name,u.given_name,u.id`)
    // Keep past contributions readable after a member leaves, without resurrecting their account.
    const historical =
      await tx.raw<CheckinMember>(sql`select distinct on(e.member_user_id) e.member_user_id as "userId",
      e.member_name as "givenName",'' as "familyName",null::text as "avatarKey",e.unit_id as "unitId",e.unit_name as "unitName",e.unit_colour as "unitColour"
      from app.checkin_entries e where e.removed_at is null
      and not exists(select 1 from app.memberships m where m.department_id=e.department_id and m.user_id=e.member_user_id and m.status='active' and m.deleted_at is null)
      order by e.member_user_id,e.added_at desc`)
    const entries =
      await tx.raw<CheckinEntry>(sql`select e.id,e.cycle_id as "cycleId",e.member_user_id as "memberUserId",
      e.checklist_item_id as "checklistItemId",e.card_id as "cardId",e.card_title as "cardTitle",e.project_id as "projectId",
      e.project_title as "projectTitle",e.text,e.state,e.version,
      (i.id is not null and i.deleted_at is null and c.id is not null and c.deleted_at is null) as "sourceAvailable"
      from app.checkin_entries e left join app.card_checklist_items i on i.id=e.checklist_item_id
      left join app.cards c on c.id=e.card_id where e.cycle_id=${selectedCycleId} and e.removed_at is null order by e.added_at,e.id`)
    const progress = await tx.raw<
      CheckinBoard['progress'][number]
    >(sql`select cycle_id as "cycleId",member_user_id as "memberUserId",
      count(*)::integer as total,count(*) filter(where state='done')::integer as done from app.checkin_entries
      where removed_at is null group by cycle_id,member_user_id`)
    return {
      currentCycleId,
      selectedCycleId,
      units: await tx.raw<{ id: string }>(
        sql`select id from app.units where department_id=${ctx.departmentId} and deleted_at is null order by id`,
      ),
      cycles: cycles.map((c) => ({
        id: c.id,
        startsOn: c.starts_on,
        endsOn: c.ends_on,
        checkinLockedAt: c.checkin_locked_at?.toISOString() ?? null,
        checkoutLockedAt: c.checkout_locked_at?.toISOString() ?? null,
      })),
      members: [...members, ...historical],
      entries,
      progress,
    }
  })
}

export async function addEntry(
  ctx: RequestContext,
  cycleId: string,
  itemId: string,
): Promise<{ id: string }> {
  return withContext(ctx, async (tx) => {
    // Lock the source before the cycle, the same order used by the source-update trigger.
    const sources = await tx.raw<{ id: string }>(
      sql`select id from app.card_checklist_items where id=${itemId} and deleted_at is null for update`,
    )
    if (!sources.length) throw new CheckinError('not_found', 'checklist_not_found')
    await maintainCycles(tx, ctx)
    await cycleForEdit(tx, cycleId)
    const rows = await tx.raw<{ id: string }>(sql`insert into app.checkin_entries
      (department_id,cycle_id,checklist_item_id,card_id,member_user_id,member_name,unit_id,unit_name,unit_colour,card_title,project_id,project_title,text,state)
      select c.department_id,${cycleId},i.id,c.id,m.user_id,concat_ws(' ',u.given_name,u.family_name),unit.id,unit.name,unit.colour,c.title,p.id,p.title,i.text,
        case when i.done_at is null then 'pending' else 'done' end
      from app.card_checklist_items i join app.cards c on c.id=i.card_id
      join app.memberships m on m.user_id=coalesce(i.assignee_user_id,c.assignee_user_id) and m.department_id=c.department_id
      join app.users u on u.id=m.user_id
      left join app.unit_roles ur on ur.user_id=m.user_id and ur.department_id=m.department_id and ur.deleted_at is null
      left join app.units unit on unit.id=ur.unit_id and unit.deleted_at is null
      left join app.projects p on p.id=c.project_id and p.deleted_at is null
      where i.id=${itemId} and i.deleted_at is null and c.deleted_at is null and m.deleted_at is null and m.status='active' and m.role<>'head'
      on conflict(cycle_id,checklist_item_id) do update set removed_at=null,updated_at=now(),version=app.checkin_entries.version+1,
        text=case when app.checkin_entries.removed_at is null then app.checkin_entries.text else excluded.text end,
        state=case when app.checkin_entries.removed_at is null then app.checkin_entries.state else excluded.state end
      returning id`)
    if (!rows.length) throw new CheckinError('validation_failed', 'member_assignee_required')
    changed(tx, ctx, 'added', rows[0]!.id, { cycleId, itemId })
    return rows[0]!
  })
}

export async function removeEntry(ctx: RequestContext, id: string): Promise<void> {
  await withContext(ctx, async (tx) => {
    await maintainCycles(tx, ctx)
    const entries = await tx.raw<{ cycle_id: string }>(
      sql`select cycle_id from app.checkin_entries where id=${id} and removed_at is null`,
    )
    if (!entries[0]) throw new CheckinError('not_found', 'entry_not_found')
    const cycle = await cycleForEdit(tx, entries[0].cycle_id)
    if (cycle.checkin_locked_at || cycle.checkin_deadline <= new Date())
      throw new CheckinError('conflict', 'checkin_locked')
    await tx.raw(
      sql`update app.checkin_entries set removed_at=now(),updated_at=now(),version=version+1 where id=${id}`,
    )
    changed(tx, ctx, 'removed', id)
  })
}

export async function updateEntry(
  ctx: RequestContext,
  id: string,
  patch: {
    version: number
    text?: string | undefined
    state?: 'pending' | 'done' | 'blocked' | undefined
  },
): Promise<void> {
  await withContext(ctx, async (tx) => {
    const entries = await tx.raw<{
      cycle_id: string
      checklist_item_id: string
      card_id: string
      version: number
    }>(
      sql`select cycle_id,checklist_item_id,card_id,version from app.checkin_entries where id=${id} and removed_at is null`,
    )
    const entry = entries[0]
    if (!entry) throw new CheckinError('not_found', 'entry_not_found')
    const source = await tx.raw<{
      id: string
    }>(sql`select i.id from app.card_checklist_items i join app.cards c on c.id=i.card_id
      where i.id=${entry.checklist_item_id} and i.deleted_at is null and c.deleted_at is null for update of i`)
    await maintainCycles(tx, ctx)
    await cycleForEdit(tx, entry.cycle_id)
    const current = await tx.raw<{ version: number }>(
      sql`select version from app.checkin_entries where id=${id} for update`,
    )
    if (current[0]?.version !== patch.version) throw new CheckinError('conflict', 'entry_changed')
    if (source.length) {
      await tx.raw(sql`update app.card_checklist_items set text=coalesce(${patch.text ?? null},text),
        done_at=case when ${patch.state ?? null}::text is null then done_at when ${patch.state ?? null}='done' then coalesce(done_at,now()) else null end,
        updated_at=now(),version=version+1 where id=${entry.checklist_item_id}`)
      await tx.raw(sql`insert into app.card_activity(department_id,card_id,actor_user_id,kind,data)
        values(${ctx.departmentId},${entry.card_id},${ctx.userId},'checklist',${JSON.stringify({ operation: 'updated', itemId: entry.checklist_item_id, via: ctx.userAgent.includes('ai-action/') ? 'ai' : 'manual', ...patch })}::jsonb)`)
      tx.emit({
        type: 'work.checklist.updated',
        departmentId: ctx.departmentId,
        payload: { cardId: entry.card_id, actorUserId: ctx.userId },
      })
    }
    await tx.raw(sql`update app.checkin_entries set text=coalesce(${patch.text ?? null},text),state=coalesce(${patch.state ?? null},state),
      version=version+1,updated_at=now() where id=${id}`)
    changed(tx, ctx, 'updated', id, patch)
  })
}

export async function lockCycle(
  ctx: RequestContext,
  id: string,
  phase: 'checkin' | 'checkout',
): Promise<void> {
  if (ctx.departmentRole !== 'head' || ctx.viewAs)
    throw new CheckinError('forbidden', 'head_required')
  await withContext(ctx, async (tx) => {
    await maintainCycles(tx, ctx)
    const rows = await tx.raw<CycleRow>(
      sql`select ${cycleColumns} from app.checkin_cycles where id=${id} for update`,
    )
    const cycle = rows[0]
    if (!cycle) throw new CheckinError('not_found', 'cycle_not_found')
    if (phase === 'checkout' && tashkentDay(new Date()) < cycle.ends_on)
      throw new CheckinError('conflict', 'checkout_not_due')
    if (phase === 'checkin' && !cycle.checkin_locked_at) {
      await tx.raw(sql`update app.checkin_cycles set checkin_locked_at=now() where id=${id}`)
      changed(tx, ctx, 'checkin_locked', id, { automatic: false })
    }
    if (phase === 'checkout' && !cycle.checkout_locked_at) {
      await tx.raw(
        sql`update app.checkin_cycles set checkin_locked_at=coalesce(checkin_locked_at,now()),checkout_locked_at=now() where id=${id}`,
      )
      changed(tx, ctx, 'checkout_locked', id, { automatic: false })
    }
  })
}
