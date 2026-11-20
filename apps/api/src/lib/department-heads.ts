import { sql } from 'drizzle-orm'
import type { Tx } from '@devon/db'

/** Serialize leadership changes before taking user or membership locks. Counting heads without
 * this lock lets two heads concurrently leave/demote each other and strand the department. */
export async function lockDepartmentHeads(tx: Tx, departmentId: string): Promise<void> {
  await tx.raw(
    sql`select pg_advisory_xact_lock(hashtextextended(${`department-heads:${departmentId}`}, 0))`,
  )
}

export async function hasOtherActiveHead(
  tx: Tx,
  departmentId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.raw(sql`
    select m.id from app.memberships m join app.users u on u.id=m.user_id
    where m.department_id=${departmentId} and m.user_id<>${userId}
      and m.role='head' and m.status='active' and m.deleted_at is null
      and u.status='active' and u.deleted_at is null limit 1`)
  return rows.length > 0
}

export class LastDepartmentHeadError extends Error {
  constructor() {
    super('An active department must retain an active head')
    this.name = 'LastDepartmentHeadError'
  }
}

export class DepartmentMembershipChangedError extends Error {
  constructor() {
    super('Department membership changed. Refresh and retry the account action.')
    this.name = 'DepartmentMembershipChangedError'
  }
}

/** Account administration uses the same order as role changes, across every affected department.
 * The caller is already in an instance-admin context; no tenant access is elevated here. */
export async function lockUserDepartments(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx.raw<{ department_id: string }>(sql`
    select department_id, pg_advisory_xact_lock(hashtextextended('department-heads:' || department_id::text, 0))
    from (select distinct department_id from app.memberships
      where user_id=${userId} and deleted_at is null order by department_id) departments`)
  return rows.map((row) => row.department_id)
}

export async function assertUserCanBeDisabled(
  tx: Tx,
  userId: string,
  lockedDepartments: string[],
): Promise<void> {
  // The caller now holds the account row lock. A concurrent join + promotion could have added a
  // department after the initial lock snapshot. Retry instead of taking a new department lock
  // in reverse order or counting heads in a department whose leadership is still changing.
  const memberships = await tx.raw<{ department_id: string }>(sql`
    select distinct department_id from app.memberships
    where user_id=${userId} and deleted_at is null`)
  const locked = new Set(lockedDepartments)
  if (memberships.some((row) => !locked.has(row.department_id)))
    throw new DepartmentMembershipChangedError()
  const rows = await tx.raw(sql`
    select m.id from app.memberships m
    join app.departments d on d.id=m.department_id
    join app.users owner on owner.id=m.user_id
    where m.user_id=${userId} and m.role='head' and m.status='active' and m.deleted_at is null
      and owner.status='active' and owner.deleted_at is null
      and d.status<>'archived' and d.deleted_at is null
      and not exists (
        select 1 from app.memberships h join app.users u on u.id=h.user_id
        where h.department_id=m.department_id and h.user_id<>${userId}
          and h.role='head' and h.status='active' and h.deleted_at is null
          and u.status='active' and u.deleted_at is null
      ) limit 1`)
  if (rows.length) throw new LastDepartmentHeadError()
}
