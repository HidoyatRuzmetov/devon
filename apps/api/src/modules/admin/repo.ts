// DB access for `/api/v1/admin/*` (EPIC-013). See `modules/accounts/repo.ts`'s header for why this is
// a module-owned repo file rather than an edit to the shared `apps/api/src/deps.ts` -- every function
// below opens its own `withContext()`, exactly that pattern's own additional implementation.
//
// Every function here runs with `actorRole: 'super_admin'` as its RLS-evaluation context (the same
// `adminCtx` shape `modules/departments/repo.ts` already uses for its own cross-department queries):
// the real authorization decision -- "is the caller actually a super admin" -- has already been made by
// `can()` via `{kind:'instance'}` before any of these functions run (`index.ts` never calls this file
// from a route that skipped that check), so this is a deliberate, reviewed RLS-evaluation choice, never
// a stand-in for it.
import { randomBytes, randomUUID } from 'node:crypto'
import { probeStorage, probeAi, probeTelegram, probeBackups } from './health-probes.js'
import { and, desc, eq, getTableColumns, ilike, isNull, or, sql } from 'drizzle-orm'
import { normalizeUz, schema, withContext, type Tx } from '@devon/db'
import { verifyPassword } from '../../lib/password.js'
import { verifyTotp } from '../accounts/totp.js'
import { decryptSecret as decryptAccountSecret } from '../accounts/crypto.js'
import type { AuditCtx } from '../../types.js'
import type { Locale } from '../../schemas.js'
import { encryptSecret, decryptSecret } from './crypto.js'
import { generateSentinelKeypair } from './sentinel-protocol.js'
import { sendWipeCommand } from './sentinel-client.js'
import { invalidateDepartmentStatusCache, invalidateMaintenanceCache } from './availability-gate.js'
import { parseAdminListCursor } from './list-cursor.js'

function adminCtx(ctx: AuditCtx, departmentId: string | null = null) {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: 'super_admin' as const,
    departmentId,
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }
}

/** For the many read-only admin queries below that have no real request actor to attribute an audit
 * row to (there is nothing to audit -- reads never call `tx.audit()`) -- same RLS-evaluation shape as
 * `adminCtx`, just without a real `AuditCtx` to thread through. */
function anonymousAdminCtx() {
  return adminCtx({
    requestId: randomUUID(),
    userId: null,
    actorRole: null,
    actingForUserId: null,
    ip: '',
    userAgent: '',
  })
}

// ---------------------------------------------------------------------------------------------
// Departments

export type AdminDepartmentRow = {
  id: string
  name: string
  slug: string
  status: 'active' | 'paused_by_admin' | 'deletion_requested' | 'archived'
  memberCount: number
  headName: string | null
  createdAt: Date
}

export type AdminDepartmentDetail = AdminDepartmentRow & {
  description: string | null
  emoji: string | null
  colour: string | null
  localeDefault: Locale
}

function toAdminDepartmentRow(row: {
  id: string
  name: string
  slug: string
  status: AdminDepartmentRow['status']
  memberCount: number | string | null
  headName: string | null
  createdAt: Date
}): AdminDepartmentRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    memberCount: Number(row.memberCount ?? 0),
    headName: row.headName,
    createdAt: row.createdAt,
  }
}

export async function listDepartments(input: {
  query?: string | undefined
  status?: AdminDepartmentRow['status'] | undefined
  cursor?: string | undefined
  limit: number
}): Promise<{ rows: AdminDepartmentRow[]; nextCursor: string | null }> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    // Plain `sql` fragments throughout, deliberately never the typed `eq()`/`ilike()`/`isNull()`
    // builders here: those resolve a column to its schema-registered table name (`"departments"`),
    // which would not match this query's `d` alias below and fail at the database with "missing
    // FROM-clause entry" -- `getDepartmentDetail` right below has the identical, correct pattern.
    const conditions = [sql`d.deleted_at is null`]
    if (input.status) conditions.push(sql`d.status = ${input.status}`)
    if (input.query) conditions.push(sql`d.name ilike ${`%${input.query}%`}`)
    if (input.cursor) {
      const cursor = parseAdminListCursor(input.cursor)
      conditions.push(
        sql`(d.created_at, d.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      )
    }

    const rows = await tx.raw<{
      id: string
      name: string
      slug: string
      status: AdminDepartmentRow['status']
      created_at: string
      cursor_created_at: string
      member_count: string
      head_name: string | null
    }>(sql`
      select d.id, d.name, d.slug, d.status, d.created_at,
        to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at,
        (select count(*) from app.memberships m join app.users mu on mu.id=m.user_id
          where m.department_id = d.id and m.status = 'active' and m.deleted_at is null
            and mu.status='active' and mu.deleted_at is null) as member_count,
        (select u.given_name || ' ' || u.family_name from app.memberships hm
           join app.users u on u.id = hm.user_id
           where hm.department_id = d.id and hm.role = 'head' and hm.status = 'active' and hm.deleted_at is null
             and u.status='active' and u.deleted_at is null
           order by hm.joined_at asc limit 1) as head_name
      from app.departments d
      where ${sql.join(conditions, sql` and `)}
      order by d.created_at desc, d.id desc
      limit ${input.limit + 1}
    `)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      rows: page.map((r) =>
        toAdminDepartmentRow({
          id: r.id,
          name: r.name,
          slug: r.slug,
          status: r.status,
          createdAt: new Date(r.created_at),
          memberCount: r.member_count,
          headName: r.head_name,
        }),
      ),
      nextCursor: hasMore && last ? `${last.cursor_created_at}|${last.id}` : null,
    }
  })
}

export async function getDepartmentDetail(id: string): Promise<AdminDepartmentDetail | null> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.raw<{
      id: string
      name: string
      slug: string
      status: AdminDepartmentRow['status']
      created_at: string
      description: string | null
      emoji: string | null
      colour: string | null
      locale_default: string
      member_count: string
      head_name: string | null
    }>(sql`
      select d.id, d.name, d.slug, d.status, d.created_at, d.description, d.emoji, d.colour, d.locale_default,
        (select count(*) from app.memberships m join app.users mu on mu.id=m.user_id
          where m.department_id = d.id and m.status = 'active' and m.deleted_at is null
            and mu.status='active' and mu.deleted_at is null) as member_count,
        (select u.given_name || ' ' || u.family_name from app.memberships hm
           join app.users u on u.id = hm.user_id
           where hm.department_id = d.id and hm.role = 'head' and hm.status = 'active' and hm.deleted_at is null
             and u.status='active' and u.deleted_at is null
           order by hm.joined_at asc limit 1) as head_name
      from app.departments d
      where d.id = ${id} and d.deleted_at is null
      limit 1
    `)
    const row = rows[0]
    if (!row) return null
    return {
      ...toAdminDepartmentRow({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        createdAt: new Date(row.created_at),
        memberCount: row.member_count,
        headName: row.head_name,
      }),
      description: row.description,
      emoji: row.emoji,
      colour: row.colour,
      localeDefault: row.locale_default as Locale,
    }
  })
}

async function setDepartmentStatus(
  id: string,
  status: AdminDepartmentRow['status'],
  action: `${string}.${string}`,
  ctx: AuditCtx,
  reason?: string | undefined,
): Promise<boolean> {
  const changed = await withContext(adminCtx(ctx, id), async (tx) => {
    const before = await tx.drizzle
      .select({ status: schema.departments.status })
      .from(schema.departments)
      .where(and(eq(schema.departments.id, id), isNull(schema.departments.deletedAt)))
      .limit(1)
      .for('update')
    if (!before[0]) return false
    await tx.drizzle
      .update(schema.departments)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.departments.id, id))
    tx.audit({
      action,
      subjectType: 'department',
      subjectId: id,
      before: { status: before[0].status },
      after: { status, ...(reason ? { reason } : {}) },
    })
    return true
  })
  if (changed) invalidateDepartmentStatusCache(id)
  return changed
}

export const pauseDepartment = (id: string, reason: string, ctx: AuditCtx) =>
  setDepartmentStatus(id, 'paused_by_admin', 'admin.department.paused', ctx, reason)
export const resumeDepartment = (id: string, ctx: AuditCtx) =>
  setDepartmentStatus(id, 'active', 'admin.department.resumed', ctx)
export const archiveDepartment = (id: string, ctx: AuditCtx) =>
  setDepartmentStatus(id, 'archived', 'admin.department.archived', ctx)
export const restoreDepartment = (id: string, ctx: AuditCtx) =>
  setDepartmentStatus(id, 'active', 'admin.department.restored', ctx)

export async function recordViewAsStarted(departmentId: string, ctx: AuditCtx): Promise<void> {
  await withContext(adminCtx(ctx, departmentId), async (tx) => {
    tx.audit({
      action: 'admin.view_as.started',
      subjectType: 'department',
      subjectId: departmentId,
    })
  })
}

export async function recordViewAsStopped(departmentId: string, ctx: AuditCtx): Promise<void> {
  await withContext(adminCtx(ctx, departmentId), async (tx) => {
    tx.audit({
      action: 'admin.view_as.stopped',
      subjectType: 'department',
      subjectId: departmentId,
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Accounts

export type AdminUserRow = {
  id: string
  login: string
  givenName: string
  familyName: string
  patronymic: string | null
  role: 'super_admin' | 'head' | 'member'
  status: 'active' | 'locked' | 'deleted'
  lastLoginAt: Date | null
  createdAt: Date
  identityNeedsCorrection: boolean
}

export type AdminUserDetail = AdminUserRow & {
  email: string | null
  locale: Locale
  mustChangePassword: boolean
  twoFactorEnabled: boolean
  lockedUntil: Date | null
  memberships: { departmentId: string; departmentName: string; role: 'head' | 'member' }[]
}

/** Presentation only: the instance role must never be changed to grant department authority.
 * Explicit outer qualification is required: Drizzle strips column qualification inside SELECT
 * expressions, which would bind an unqualified id/status to a correlated subquery's own tables. */
function adminDisplayRole() {
  return sql<AdminUserRow['role']>`case
    when app.users.role = 'super_admin' then 'super_admin'
    when exists (
      select 1 from app.memberships hm join app.departments hd on hd.id=hm.department_id
      where hm.user_id=app.users.id and hm.role='head'
        and (app.users.status='deleted' or
          (hm.status='active' and hm.deleted_at is null and hd.deleted_at is null and hd.status<>'archived'))
    ) then 'head' else 'member' end`
}

function identityNeedsCorrection() {
  return sql<boolean>`app.users.status='deleted'
    and app.users.deleted_at is not null and app.users.role<>'super_admin'
    and app.users.given_name=${"O'chirilgan"}
    and app.users.family_name='foydalanuvchi'
    and app.users.login ~ '^deleted-[a-f0-9]{8}$'
    and exists (select 1 from audit.events ie where ie.subject_id=app.users.id::text
      and ie.subject_type='user' and ie.action='admin.user.anonymised'
      and nullif(ie.before->>'login','') is not null)`
}

export async function searchUsers(input: {
  query?: string | undefined
  status?: AdminUserRow['status'] | undefined
  role?: AdminUserRow['role'] | undefined
  cursor?: string | undefined
  limit: number
}): Promise<{ rows: AdminUserRow[]; nextCursor: string | null }> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const conditions = []
    if (input.status) conditions.push(eq(schema.users.status, input.status))
    if (input.role) conditions.push(sql`${adminDisplayRole()} = ${input.role}`)
    if (input.query) {
      const q = `%${input.query}%`
      // H3.4/H14.1: the name half of this search matches through `app.normalize_uz()` (folds ʻ/ʼ/
      // apostrophe variants and Cyrillic->Latin -- migrations/0006_normalize_uz.sql) so "Off Nazarov"
      // finds "Oʻzbekov" and a Cyrillic-typed "Абдуллаев" finds a Latin-stored "Abdullayev" -- and so
      // this is the same expression `users_name_trgm_idx` (a GIN trigram index already on
      // `app.normalize_uz(given_name || ' ' || family_name)`) actually indexes; before this, the
      // query ILIKE'd the raw columns directly, so that index existed but was never usable by this
      // query (a plain `ilike(given_name, ...)` cannot use an index on a *different* expression).
      // `normalizeUz()` (the TS mirror, `@devon/db`) folds the search term the same way so both sides
      // of the comparison agree. `login` (an ASCII username, not Uzbek free text) stays a plain ILIKE.
      const normalizedQ = `%${normalizeUz(input.query)}%`
      conditions.push(
        or(
          ilike(schema.users.login, q),
          sql`app.normalize_uz(${schema.users.givenName} || ' ' || ${schema.users.familyName}) ilike ${normalizedQ}`,
        )!,
      )
    }
    if (input.cursor) {
      const cursor = parseAdminListCursor(input.cursor)
      conditions.push(
        sql`(${schema.users.createdAt}, ${schema.users.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      )
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await tx.drizzle
      .select({
        ...getTableColumns(schema.users),
        role: adminDisplayRole(),
        identityNeedsCorrection: identityNeedsCorrection(),
        cursorCreatedAt: sql<string>`to_char(${schema.users.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(schema.users)
      .where(where)
      .orderBy(desc(schema.users.createdAt), desc(schema.users.id))
      .limit(input.limit + 1)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      rows: page.map((r) => ({
        id: r.id,
        login: r.login,
        givenName: r.givenName,
        familyName: r.familyName,
        patronymic: r.patronymic,
        role: r.role,
        status: r.status,
        lastLoginAt: r.lastLoginAt,
        createdAt: r.createdAt,
        identityNeedsCorrection: r.identityNeedsCorrection,
      })),
      nextCursor: hasMore && last ? `${last.cursorCreatedAt}|${last.id}` : null,
    }
  })
}

export async function getUserDetail(id: string): Promise<AdminUserDetail | null> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.drizzle
      .select({
        ...getTableColumns(schema.users),
        role: adminDisplayRole(),
        identityNeedsCorrection: identityNeedsCorrection(),
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
    const row = rows[0]
    if (!row) return null

    const security = await tx.raw<{ totp_enabled: boolean; locked_until: string | null }>(
      sql`select totp_enabled, locked_until from app.user_security where user_id = ${id}`,
    )
    const memberships = await tx.raw<{
      department_id: string
      department_name: string
      role: 'head' | 'member'
    }>(sql`
      select m.department_id, d.name as department_name, m.role
      from app.memberships m join app.departments d on d.id = m.department_id
      where m.user_id = ${id} and m.status = 'active' and m.deleted_at is null and d.deleted_at is null
      order by m.joined_at asc
    `)

    return {
      id: row.id,
      login: row.login,
      email: row.email,
      givenName: row.givenName,
      familyName: row.familyName,
      patronymic: row.patronymic,
      role: row.role,
      status: row.status,
      locale: row.locale as Locale,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      identityNeedsCorrection: row.identityNeedsCorrection,
      twoFactorEnabled: security[0]?.totp_enabled ?? false,
      lockedUntil: security[0]?.locked_until ? new Date(security[0].locked_until) : null,
      memberships: memberships.map((m) => ({
        departmentId: m.department_id,
        departmentName: m.department_name,
        role: m.role,
      })),
    }
  })
}

const LOCK_FAR_FUTURE_YEARS = 100

/** Account admission changes invalidate join-decision Undo receipts in each affected scope.
 * Membership UPDATE remains department-scoped even for the instance admin. The caller already
 * holds the target user lock; join decisions use the same user → membership lock order. */
async function advanceMembershipRevisions(tx: Tx, userId: string): Promise<void> {
  const departments = await tx.raw<{ department_id: string }>(sql`
    select distinct department_id from app.memberships
    where user_id=${userId} and deleted_at is null order by department_id
  `)
  /* eslint-disable no-restricted-syntax -- Each scoped UPDATE depends on the preceding transaction-local GUC on this single connection. */
  // nosemgrep: devon-query-in-loop -- RLS requires each UPDATE to use its preceding department GUC on this single transaction connection; a cross-department batch would bypass that boundary.
  for (const row of departments) {
    // nosemgrep: query-in-loop -- This changes the transaction-local department before its dependent membership UPDATE; parallel scopes would race on one connection.
    await tx.raw(sql`select set_config('app.department_id',${row.department_id},true)`)
    // nosemgrep: query-in-loop -- Must execute after its own department GUC and before the next scope; these tenant writes are not independent.
    await tx.raw(sql`
      update app.memberships set version=version+1,updated_at=now()
      where user_id=${userId} and department_id=${row.department_id} and deleted_at is null
    `)
  }
  /* eslint-enable no-restricted-syntax */
  await tx.raw(sql`select set_config('app.department_id','',true)`)
}

export async function lockUser(id: string, reason: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const before = await tx.drizzle
      .select({ status: schema.users.status, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
      .for('update')
    if (!before[0] || before[0].status === 'deleted' || before[0].role === 'super_admin')
      return false

    const lockedUntil = new Date()
    lockedUntil.setFullYear(lockedUntil.getFullYear() + LOCK_FAR_FUTURE_YEARS)
    await tx.drizzle
      .update(schema.users)
      .set({ status: 'locked', updatedAt: new Date() })
      .where(eq(schema.users.id, id))
    await advanceMembershipRevisions(tx, id)
    await tx.raw(sql`
      insert into app.user_security (user_id, locked_until)
      values (${id}, ${lockedUntil.toISOString()}::timestamptz)
      on conflict (user_id) do update set locked_until = excluded.locked_until, updated_at = now()
    `)
    // A locked account's live sessions must stop working immediately, not merely on next login.
    await tx.raw(
      sql`update app.sessions set revoked_at = now(), revoked_reason = 'admin_lock' where user_id = ${id} and revoked_at is null`,
    )
    tx.audit({
      action: 'admin.user.locked',
      subjectType: 'user',
      subjectId: id,
      before: { status: before[0].status },
      after: { status: 'locked', reason },
    })
    return true
  })
}

export async function unlockUser(id: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const before = await tx.drizzle
      .select({ status: schema.users.status, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
      .for('update')
    if (!before[0] || before[0].status !== 'locked' || before[0].role === 'super_admin')
      return false
    await tx.drizzle
      .update(schema.users)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(schema.users.id, id))
    await advanceMembershipRevisions(tx, id)
    await tx.raw(sql`
      insert into app.user_security (user_id, locked_until, failed_login_count)
      values (${id}, null, 0)
      on conflict (user_id) do update set locked_until = null, failed_login_count = 0, updated_at = now()
    `)
    tx.audit({
      action: 'admin.user.unlocked',
      subjectType: 'user',
      subjectId: id,
      before: { status: 'locked' },
      after: { status: 'active' },
    })
    return true
  })
}

export async function forceTwoFactorReset(id: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const target = await tx.drizzle
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, id),
          sql`${schema.users.role} <> 'super_admin'`,
          sql`${schema.users.status} <> 'deleted'`,
          isNull(schema.users.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!target[0]) return false
    await tx.raw(sql`
      insert into app.user_security (user_id, totp_enabled, totp_secret_enc, recovery_codes_hash)
      values (${id}, false, null, '{}')
      on conflict (user_id) do update set totp_enabled = false, totp_secret_enc = null, recovery_codes_hash = '{}', updated_at = now()
    `)
    tx.audit({ action: 'admin.user.two_factor_reset', subjectType: 'user', subjectId: id })
    return true
  })
}

/** Frees the original username without discarding its historical identity. UUID suffixes are
 * collision-free across accounts; deleted status and an invalid password still prevent login. */
function deletedLogin(login: string, id: string): string {
  return `${login}.deleted-${id}`
}

/** Legacy endpoint/function name retained for existing clients. Ordinary administrative deletion
 * revokes access while retaining the identity needed by historical records; it is not erasure. */
export async function anonymizeUser(id: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const before = await tx.drizzle
      .select({ status: schema.users.status, login: schema.users.login, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
      .for('update')
    if (!before[0] || before[0].status === 'deleted' || before[0].role === 'super_admin')
      return false

    await tx.drizzle
      .update(schema.users)
      .set({
        status: 'deleted',
        login: deletedLogin(before[0].login, id),
        passwordHash: `!anonymised:${randomBytes(16).toString('hex')}`,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
    await advanceMembershipRevisions(tx, id)
    await tx.raw(sql`
      insert into app.user_security (user_id, totp_enabled, totp_secret_enc, recovery_codes_hash, locked_until)
      values (${id}, false, null, '{}', null)
      on conflict (user_id) do update set totp_enabled = false, totp_secret_enc = null, recovery_codes_hash = '{}', locked_until = null, updated_at = now()
    `)
    await tx.raw(
      sql`update app.sessions set revoked_at = now(), revoked_reason = 'admin_anonymise' where user_id = ${id} and revoked_at is null`,
    )
    tx.audit({
      action: 'admin.user.deleted',
      subjectType: 'user',
      subjectId: id,
      before: { login: before[0].login, status: before[0].status },
      after: { status: 'deleted', login: deletedLogin(before[0].login, id) },
    })
    return true
  })
}

/** Correct only identities erased by the legacy anonymizer. Authentication and the immutable
 * audit records are deliberately untouched. The old login must come from the signed audit chain,
 * never from a caller-supplied username which could misattribute another user's history. */
export async function restoreDeletedIdentity(
  id: string,
  input: {
    givenName: string
    familyName: string
    patronymic?: string | null | undefined
    reason: string
  },
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const [before] = await tx.drizzle
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
      .for('update')
    if (
      !before ||
      before.status !== 'deleted' ||
      before.role === 'super_admin' ||
      !before.deletedAt ||
      before.givenName !== "O'chirilgan" ||
      before.familyName !== 'foydalanuvchi' ||
      !/^deleted-[a-f0-9]{8}$/u.test(before.login)
    )
      return false
    const [source] = await tx.raw<{ login: string | null }>(sql`
      select before->>'login' as login from audit.events
      where action='admin.user.anonymised' and subject_type='user' and subject_id=${id}
      order by seq desc limit 1
    `)
    if (!source?.login) return false
    const login = deletedLogin(source.login, id)
    await tx.drizzle
      .update(schema.users)
      .set({
        givenName: input.givenName,
        familyName: input.familyName,
        patronymic: input.patronymic ?? null,
        login,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
    // Belt-and-braces revocation for an old tombstone, never a credential reset or reactivation.
    await tx.raw(sql`update app.sessions set revoked_at=now(), revoked_reason='historical_identity_correction'
      where user_id=${id} and revoked_at is null`)
    tx.audit({
      action: 'admin.user.deleted_identity_restored',
      subjectType: 'user',
      subjectId: id,
      before: {
        givenName: before.givenName,
        familyName: before.familyName,
        login: before.login,
        status: before.status,
      },
      after: {
        givenName: input.givenName,
        familyName: input.familyName,
        patronymic: input.patronymic ?? null,
        login,
        status: 'deleted',
        reason: input.reason,
      },
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// Analytics

export type AdminAnalytics = {
  generatedAt: Date
  departments: { total: number; active: number; paused: number; archived: number }
  people: {
    total: number
    active: number
    locked: number
    deleted: number
    superAdmins: number
    heads: number
    members: number
  }
  activity: {
    cardsCreated30d: number
    cardsCompleted30d: number
    eventsCreated30d: number
    logins7d: number
    weeklyLogins: { weekStart: string; count: number }[]
  }
  aiSpend: {
    available: boolean
    tokensThisMonth: number
    costUzsThisMonth: number
    byDepartment: { departmentId: string; departmentName: string; tokens: number }[]
  }
}

/** Live analytics describe people who can work in an active department, plus instance admins.
 * Historical accounts remain available in Accounts and Audit, never in this operational count. */
const LIVE_USER = sql`u.status='active' and u.deleted_at is null and
  (u.role='super_admin' or exists (
    select 1 from app.memberships lm join app.departments ld on ld.id=lm.department_id
    where lm.user_id=u.id and lm.status='active' and lm.deleted_at is null
      and ld.status='active' and ld.deleted_at is null))`

async function countByStatus(tx: Tx) {
  const [deptRows, userRows, inactiveUserRows] = await Promise.all([
    tx.raw<{ status: string; count: string }>(
      sql`select status, count(*)::text as count from app.departments where deleted_at is null group by status`,
    ),
    tx.raw<{ role: string; count: string }>(sql`
      select case when u.role='super_admin' then 'super_admin'
        when exists (select 1 from app.memberships hm join app.departments hd on hd.id=hm.department_id
          where hm.user_id=u.id and hm.role='head' and hm.status='active' and hm.deleted_at is null
            and hd.status='active' and hd.deleted_at is null) then 'head'
        else 'member' end as role, count(*)::text as count
      from app.users u where ${LIVE_USER} group by 1
    `),
    tx.raw<{ status: string; count: string }>(sql`
      select status, count(*)::text as count from app.users where status in ('locked','deleted') group by status
    `),
  ])
  return { deptRows, userRows, inactiveUserRows }
}

export async function getGlobalAnalytics(): Promise<AdminAnalytics> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const { deptRows, userRows, inactiveUserRows } = await countByStatus(tx)

    const departments = { total: 0, active: 0, paused: 0, archived: 0 }
    for (const r of deptRows) {
      const n = Number(r.count)
      if (r.status !== 'archived') departments.total += n
      if (r.status === 'active') departments.active += n
      else if (r.status === 'paused_by_admin' || r.status === 'deletion_requested')
        departments.paused += n
      else if (r.status === 'archived') departments.archived += n
    }

    const people = {
      total: 0,
      active: 0,
      locked: 0,
      deleted: 0,
      superAdmins: 0,
      heads: 0,
      members: 0,
    }
    for (const r of userRows) {
      const n = Number(r.count)
      people.total += n
      people.active += n
      if (r.role === 'super_admin') people.superAdmins += n
      else if (r.role === 'head') people.heads += n
      else if (r.role === 'member') people.members += n
    }
    for (const r of inactiveUserRows) {
      if (r.status === 'locked') people.locked += Number(r.count)
      else if (r.status === 'deleted') people.deleted += Number(r.count)
    }

    // `app.cards`/`app.events` belong to the `work`/`events` modules' own schema files, which this
    // module (like `accounts.ts`'s tables) cannot import across the package boundary -- reached here
    // by table name, exactly like `verifyAuditChain`/`checkMigrationsApplied` already do for tables
    // outside the typed `schema` barrel. A Postgres query is parsed in full before any `case when`
    // branch is chosen, so a `to_regclass(...) is null` guard *inside* the same statement as a
    // `select ... from app.cards` would still throw "relation does not exist" on a checkout without
    // that table -- table presence has to be resolved as its own, separate round trip first, and only
    // the queries for tables that actually exist get to run at all.
    const presence = await tx.raw<{ cards: boolean; events: boolean; ai: boolean }>(
      sql`select (to_regclass('app.cards') is not null) as cards, (to_regclass('app.events') is not null) as events,
        (to_regclass('app.ai_traces') is not null) as ai`,
    )
    const hasCards = presence[0]?.cards ?? false
    const hasEvents = presence[0]?.events ?? false

    const [cardsCreated, cardsCompleted, eventsCreated, weeklyLogins, logins7dRows] =
      await Promise.all([
        hasCards
          ? tx.raw<{ count: string }>(
              sql`select count(*)::text as count from app.cards c join app.departments d on d.id=c.department_id
                where c.created_at >= now() - interval '30 days' and c.deleted_at is null and d.deleted_at is null and d.status='active'`,
            )
          : Promise.resolve([{ count: '0' }]),
        hasCards
          ? tx.raw<{ count: string }>(
              sql`select count(*)::text as count from app.cards c join app.departments d on d.id=c.department_id
                where c.done_at >= now() - interval '30 days' and c.deleted_at is null and d.deleted_at is null and d.status='active'`,
            )
          : Promise.resolve([{ count: '0' }]),
        hasEvents
          ? tx.raw<{ count: string }>(
              sql`select count(*)::text as count from app.events e join app.departments d on d.id=e.department_id
                where e.created_at >= now() - interval '30 days' and e.deleted_at is null and d.deleted_at is null and d.status='active'`,
            )
          : Promise.resolve([{ count: '0' }]),
        tx.raw<{ week_start: string; count: string }>(sql`
        with weeks as (
          select generate_series(date_trunc('week',now() at time zone 'Asia/Tashkent')-interval '7 weeks',
            date_trunc('week',now() at time zone 'Asia/Tashkent'),interval '1 week') as week_start
        ), counts as (
          select date_trunc('week',s.created_at at time zone 'Asia/Tashkent') as week_start,count(*)::text as count
          from app.sessions s join app.users u on u.id=s.user_id
          where ${LIVE_USER} and s.created_at >= ((select min(week_start) from weeks) at time zone 'Asia/Tashkent')
          group by 1
        )
        select w.week_start::date::text as week_start,coalesce(c.count,'0') as count
        from weeks w left join counts c using(week_start) order by w.week_start
      `),
        tx.raw<{ count: string }>(
          sql`select count(*)::text as count from app.sessions s join app.users u on u.id=s.user_id
            where s.created_at >= now() - interval '7 days' and ${LIVE_USER}`,
        ),
      ])

    // Metering is historical billing: archiving a department never erases its genuine spend.
    const aiAvailable = presence[0]?.ai ?? false
    const aiRows = aiAvailable
      ? await tx.raw<{
          department_id: string
          department_name: string
          tokens: string
          cost: string
        }>(sql`select t.department_id,d.name as department_name,coalesce(sum(t.total_tokens),0)::text as tokens,
        coalesce(sum(t.cost_uzs),0)::text as cost
      from app.ai_traces t join app.departments d on d.id=t.department_id
      where t.created_at >= (date_trunc('month',now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent')
      group by t.department_id,d.name order by sum(t.total_tokens) desc,t.department_id`)
      : []

    return {
      generatedAt: new Date(),
      departments,
      people,
      activity: {
        cardsCreated30d: Number(cardsCreated[0]?.count ?? 0),
        cardsCompleted30d: Number(cardsCompleted[0]?.count ?? 0),
        eventsCreated30d: Number(eventsCreated[0]?.count ?? 0),
        logins7d: Number(logins7dRows[0]?.count ?? 0),
        weeklyLogins: weeklyLogins.map((r) => ({
          weekStart: r.week_start,
          count: Number(r.count),
        })),
      },
      aiSpend: {
        available: aiAvailable,
        tokensThisMonth: aiRows.reduce((sum, row) => sum + Number(row.tokens), 0),
        costUzsThisMonth: aiRows.reduce((sum, row) => sum + Number(row.cost), 0),
        byDepartment: aiRows.map((row) => ({
          departmentId: row.department_id,
          departmentName: row.department_name,
          tokens: Number(row.tokens),
        })),
      },
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Audit

export type AuditEventRow = {
  seq: number
  id: string
  at: Date
  actorUserId: string | null
  actorRole: string | null
  /** Historical attribution is joined to the retained identity, including deleted accounts.
   * Null denotes a system event or an identity that genuinely cannot be resolved. */
  actorName: string | null
  actorStatus: AdminUserRow['status'] | null
  actorAvatarKey: string | null
  departmentId: string | null
  action: string
  subjectType: string
  subjectId: string | null
  subjectTitle: string | null
}

export type AuditEventFilters = {
  action?: string | undefined
  /** One of `AUDIT_CATEGORIES` (the action's leading dot-segment, e.g. `'session'` for
   * `'session.created'`) or `OTHER_CATEGORY` for "none of the named ones" -- round2 SEV2's chip
   * filter, replacing the raw-grammar text box. */
  category?: string | undefined
  actorUserId?: string | undefined
  departmentId?: string | undefined
  from?: string | undefined
  to?: string | undefined
}
function auditEventConditions(
  input: AuditEventFilters & { cursor?: number | undefined; throughSeq?: number | undefined },
) {
  const conditions = [sql`1 = 1`]
  if (input.action) conditions.push(sql`action = ${input.action}`)
  if (input.category === '__other__') {
    conditions.push(
      sql`action not like 'session.%' and action not like 'accounts.%' and action not like 'admin.%' and action not like 'departments.%'`,
    )
  } else if (input.category) conditions.push(sql`action like ${input.category + '.%'}`)
  if (input.actorUserId) conditions.push(sql`actor_user_id = ${input.actorUserId}::uuid`)
  if (input.departmentId) conditions.push(sql`department_id = ${input.departmentId}::uuid`)
  if (input.from) conditions.push(sql`at >= ${input.from}::timestamptz`)
  if (input.to) conditions.push(sql`at <= ${input.to}::timestamptz`)
  if (input.cursor) conditions.push(sql`seq < ${input.cursor}`)
  if (input.throughSeq !== undefined) conditions.push(sql`seq <= ${input.throughSeq}`)
  return conditions
}
/** Bound the count and freeze an immutable audit high-water mark before starting a download. */
export async function getAuditExportSnapshot(
  input: AuditEventFilters,
  cap: number,
): Promise<{ count: number; throughSeq: number | null }> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.raw<{
      count: number
      through_seq: string | null
    }>(sql`select count(*)::int as count,max(seq) as through_seq from (
    select seq from audit.events where ${sql.join(auditEventConditions(input), sql` and `)} order by seq desc limit ${cap + 1}
  ) bounded`)
    return {
      count: rows[0]!.count,
      throughSeq: rows[0]!.through_seq === null ? null : Number(rows[0]!.through_seq),
    }
  })
}
export async function listAuditEvents(
  input: AuditEventFilters & {
    cursor?: number | undefined
    throughSeq?: number | undefined
    limit: number
  },
): Promise<{ rows: AuditEventRow[]; nextCursor: number | null }> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const conditions = auditEventConditions(input)

    // Blitz integration fix: `audit.events.seq` is `bigint identity` (packages/db migrations,
    // `audit.verify_chain()`'s own `seq bigint`) -- `node-postgres` returns every `bigint` column as a
    // JS `string`, never `number`, specifically to avoid silently losing precision above
    // `Number.MAX_SAFE_INTEGER` (pg's own documented default; there is no repo-wide bigint-parsing
    // helper to reuse, this is the first route to expose one over HTTP). The raw query's declared
    // generic type here was `number`, which TypeScript happily believed with no runtime check --
    // verified end to end that `GET /api/v1/admin/audit/events` 500'd on every real row
    // (`ResponseSerializationError`: `events[n].seq` "expected number, received string") because
    // `schemas.ts`'s `seq: z.number().int()` then rejected the raw string that actually came back.
    // `Number(...)` below is exact for any `seq` this instance's audit chain will ever reach long
    // before `bigint` and `number` could disagree (2^53 audit events).
    const rows = await tx.raw<{
      seq: string
      id: string
      at: string
      actor_user_id: string | null
      actor_role: string | null
      actor_given_name: string | null
      actor_family_name: string | null
      actor_status: AdminUserRow['status'] | null
      actor_avatar_key: string | null
      department_id: string | null
      action: string
      subject_type: string
      subject_id: string | null
      subject_title: string | null
    }>(sql`
      select e.seq, e.id, e.at, e.actor_user_id, e.actor_role, e.department_id, e.action,
        e.subject_type, e.subject_id,
        case when e.action = 'work.card_deleted' then e.before->>'title' else null end as subject_title,
        u.given_name as actor_given_name, u.family_name as actor_family_name,
        u.status as actor_status,u.avatar_key as actor_avatar_key
      from audit.events e
      left join app.users u on u.id = e.actor_user_id
      where ${sql.join(conditions, sql` and `)}
      order by e.seq desc
      limit ${input.limit + 1}
    `)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      rows: page.map((r) => ({
        seq: Number(r.seq),
        id: r.id,
        at: new Date(r.at),
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        actorName:
          r.actor_given_name || r.actor_family_name
            ? `${r.actor_given_name ?? ''} ${r.actor_family_name ?? ''}`.trim()
            : null,
        actorStatus: r.actor_status,
        actorAvatarKey: r.actor_avatar_key,
        departmentId: r.department_id,
        action: r.action,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        subjectTitle: r.subject_title,
      })),
      nextCursor: hasMore && last ? Number(last.seq) : null,
    }
  })
}

/** The export itself is a sensitive, auditable action (a CSV of who-did-what leaving the console) --
 * recorded even though it changes nothing, exactly like `audit.private_reads` records a read of
 * someone else's contact details for a reason that has nothing to do with mutation. */
export async function recordAuditExport(ctx: AuditCtx): Promise<void> {
  await withContext(adminCtx(ctx), async (tx) => {
    tx.audit({ action: 'admin.audit.exported', subjectType: 'audit_export', subjectId: null })
  })
}

// ---------------------------------------------------------------------------------------------
// System health

/** `detail.code` is looked up by the web layer as `admin.console.health.detail.<code>` and
 * `detail.params` interpolated there -- round2 SEV1 found raw English sentences ("0 pending
 * event(s)", "0 group(s) connected") rendering verbatim in the Uzbek/Russian console because no
 * web-layer i18n can reach a string built server-side. A raw `message` param (an underlying DB/fetch
 * error) is left untranslated on purpose -- it is a technical detail for whoever reads the console
 * next, not user-facing copy. */
export type HealthCheck = {
  status: 'ok' | 'degraded' | 'down' | 'not_configured'
  detail: { code: string; params?: Record<string, string | number> } | null
  latencyMs: number | null
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now()
  const result = await fn()
  return { result, ms: Date.now() - start }
}

/** The underlying error text for an `error.raw` detail -- deliberately left untranslated (see
 * `HealthCheck`'s doc comment): it is whatever Postgres/Node/fetch actually said, for whoever reads
 * the console next, not user-facing copy. */
function rawErrorMessage(err: unknown, fallback = 'unknown error'): string {
  return err instanceof Error ? err.message.slice(0, 200) : fallback
}

export async function getSystemHealth(): Promise<{
  checkedAt: Date
  db: HealthCheck
  queue: HealthCheck
  storage: HealthCheck
  telegram: HealthCheck
  ai: HealthCheck
  backups: HealthCheck
}> {
  const ctx = anonymousAdminCtx()

  const db: HealthCheck = await (async () => {
    try {
      const { ms } = await timed(() => withContext(ctx, (tx) => tx.raw(sql`select 1`)))
      return { status: 'ok', detail: null, latencyMs: ms }
    } catch (err) {
      return {
        status: 'down',
        detail: { code: 'error.raw', params: { message: rawErrorMessage(err) } },
        latencyMs: null,
      }
    }
  })()

  const queue: HealthCheck = await (async () => {
    try {
      const rows = await withContext(ctx, (tx) =>
        tx.raw<{ pending: string; oldest_seconds: number | null }>(sql`
          select count(*)::text as pending,
            extract(epoch from (now() - min(created_at)))::int as oldest_seconds
          from app.outbox_events where processed_at is null
        `),
      )
      const pending = Number(rows[0]?.pending ?? 0)
      const oldest = rows[0]?.oldest_seconds ?? 0
      const degraded = oldest !== null && oldest > 300
      return {
        status: degraded ? 'degraded' : 'ok',
        detail:
          oldest > 0
            ? { code: 'queue.pendingOldest', params: { count: pending, seconds: oldest } }
            : { code: 'queue.pending', params: { count: pending } },
        latencyMs: null,
      }
    } catch {
      // `processed_at` is `events-worker.ts`'s own bookkeeping column; if a checkout's outbox schema
      // differs, report degraded rather than crashing the whole health page over one card.
      return { status: 'degraded', detail: { code: 'queue.unreadable' }, latencyMs: null }
    }
  })()

  const [storage, telegram, ai, backups] = await Promise.all([
    probeStorage(),
    probeTelegram(),
    probeAi(),
    probeBackups(),
  ])

  return { checkedAt: new Date(), db, queue, storage, telegram, ai, backups }
}

// ---------------------------------------------------------------------------------------------
// Maintenance + registration

export async function setMaintenance(
  enabled: boolean,
  message: Record<string, string> | null,
  ctx: AuditCtx,
): Promise<void> {
  await withContext(adminCtx(ctx), async (tx) => {
    const before = await tx.drizzle
      .select({ maintenance: schema.instanceSettings.maintenance })
      .from(schema.instanceSettings)
      .where(eq(schema.instanceSettings.id, 1))
      .limit(1)
    await tx.raw(sql`
      insert into app.instance_settings (id, maintenance)
      values (1, ${JSON.stringify({ enabled, message })}::jsonb)
      on conflict (id) do update set maintenance = excluded.maintenance, updated_at = now()
    `)
    tx.audit({
      action: 'admin.maintenance.changed',
      subjectType: 'instance_settings',
      subjectId: 'maintenance',
      before: before[0]?.maintenance ?? null,
      after: { enabled, message },
    })
  })
  invalidateMaintenanceCache()
}

export async function setRegistrationOpen(open: boolean, ctx: AuditCtx): Promise<void> {
  await withContext(adminCtx(ctx), async (tx) => {
    const before = await tx.drizzle
      .select({ registrationOpen: schema.instanceSettings.registrationOpen })
      .from(schema.instanceSettings)
      .where(eq(schema.instanceSettings.id, 1))
      .limit(1)
    await tx.raw(sql`
      insert into app.instance_settings (id, registration_open)
      values (1, ${open})
      on conflict (id) do update set registration_open = excluded.registration_open, updated_at = now()
    `)
    tx.audit({
      action: 'admin.registration.changed',
      subjectType: 'instance_settings',
      subjectId: 'registration_open',
      before: { registrationOpen: before[0]?.registrationOpen ?? true },
      after: { registrationOpen: open },
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Sentinel key + wipe switch

export async function getSentinelStatus(): Promise<{
  hasActiveKey: boolean
  publicKeyB64: string | null
  createdAt: Date | null
}> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.raw<{ public_key_b64: string; created_at: string }>(
      sql`select public_key_b64, created_at from app.sentinel_keys where active = true order by created_at desc limit 1`,
    )
    return {
      hasActiveKey: rows.length > 0,
      publicKeyB64: rows[0]?.public_key_b64 ?? null,
      createdAt: rows[0] ? new Date(rows[0].created_at) : null,
    }
  })
}

/** ADR-014: generates a fresh ed25519 keypair (same call `infra/sentinel/scripts/keygen.mjs` makes
 * for manual use) and returns the *public* half for the operator to paste into `sentinel.conf` --
 * plainly, not a "shown once" secret, since a public key is not one. Only the encrypted private half
 * is ever persisted. */
export async function rotateSentinelKey(csrfSecret: string, ctx: AuditCtx): Promise<string> {
  const { publicKeyB64, privateKeyB64 } = generateSentinelKeypair()
  const privateKeyEnc = encryptSecret(privateKeyB64, csrfSecret)
  await withContext(adminCtx(ctx), async (tx) => {
    await tx.raw(
      sql`update app.sentinel_keys set active = false, deactivated_at = now() where active = true`,
    )
    await tx.raw(
      sql`insert into app.sentinel_keys (public_key_b64, private_key_enc, active, created_by_user_id)
          values (${publicKeyB64}, ${privateKeyEnc}, true, ${ctx.userId})`,
    )
    tx.audit({
      action: 'admin.sentinel.key_rotated',
      subjectType: 'sentinel_key',
      subjectId: null,
      after: { publicKeyB64 },
    })
  })
  return publicKeyB64
}

async function getActiveSentinelKeypair(
  csrfSecret: string,
): Promise<{ publicKeyB64: string; privateKeyB64: string } | null> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.raw<{ public_key_b64: string; private_key_enc: string }>(
      sql`select public_key_b64, private_key_enc from app.sentinel_keys where active = true order by created_at desc limit 1`,
    )
    const row = rows[0]
    if (!row) return null
    return {
      publicKeyB64: row.public_key_b64,
      privateKeyB64: decryptSecret(row.private_key_enc, csrfSecret),
    }
  })
}

const WIPE_COUNTDOWN_SECONDS = 60

export type WipeStartResult =
  | { ok: true; id: string; countdownEndsAt: Date; countdownSeconds: number }
  | { ok: false; reason: 'bad_phrase' | 'bad_password' | 'bad_totp' | 'no_sentinel_key' }

export async function startWipe(
  input: {
    phrase: string
    expectedPhrase: string
    password: string
    totpCode?: string | undefined
  },
  csrfSecret: string,
  ctx: AuditCtx,
): Promise<WipeStartResult> {
  if (input.phrase.trim() !== input.expectedPhrase) return { ok: false, reason: 'bad_phrase' }

  return withContext(adminCtx(ctx), async (tx) => {
    const userRows = await tx.drizzle
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.userId!))
      .limit(1)
    const passwordHash = userRows[0]?.passwordHash
    if (!passwordHash || !(await verifyPassword(passwordHash, input.password))) {
      tx.audit({
        action: 'admin.wipe.rejected',
        subjectType: 'wipe_request',
        subjectId: null,
        after: { reason: 'bad_password' },
      })
      return { ok: false, reason: 'bad_password' }
    }

    const security = await tx.raw<{ totp_secret_enc: string | null; totp_enabled: boolean }>(
      sql`select totp_secret_enc, totp_enabled from app.user_security where user_id = ${ctx.userId}`,
    )
    if (security[0]?.totp_enabled && security[0].totp_secret_enc) {
      const secret = decryptAccountSecret(security[0].totp_secret_enc, csrfSecret)
      if (!input.totpCode || !verifyTotp(secret, input.totpCode)) {
        tx.audit({
          action: 'admin.wipe.rejected',
          subjectType: 'wipe_request',
          subjectId: null,
          after: { reason: 'bad_totp' },
        })
        return { ok: false, reason: 'bad_totp' }
      }
    }

    const activeKey = await tx.raw<{ count: string }>(
      sql`select count(*)::text as count from app.sentinel_keys where active = true`,
    )
    if (Number(activeKey[0]?.count ?? 0) === 0) {
      tx.audit({
        action: 'admin.wipe.rejected',
        subjectType: 'wipe_request',
        subjectId: null,
        after: { reason: 'no_sentinel_key' },
      })
      return { ok: false, reason: 'no_sentinel_key' }
    }

    const countdownEndsAt = new Date(Date.now() + WIPE_COUNTDOWN_SECONDS * 1000)
    const rows = await tx.raw<{ id: string }>(sql`
      insert into app.wipe_requests (initiated_by_user_id, phrase, status, countdown_seconds, countdown_ends_at)
      values (${ctx.userId}, ${input.phrase}, 'countdown', ${WIPE_COUNTDOWN_SECONDS}, ${countdownEndsAt.toISOString()}::timestamptz)
      returning id
    `)
    const id = rows[0]!.id
    tx.audit({
      action: 'admin.wipe.started',
      subjectType: 'wipe_request',
      subjectId: id,
      after: { countdownEndsAt: countdownEndsAt.toISOString() },
    })
    return { ok: true, id, countdownEndsAt, countdownSeconds: WIPE_COUNTDOWN_SECONDS }
  })
}

export type WipeStatusRow = {
  id: string
  status: 'countdown' | 'cancelled' | 'executing' | 'completed' | 'failed'
  countdownEndsAt: Date
  phrase: string
  failureReason: string | null
}

export async function getActiveWipeRequest(): Promise<WipeStatusRow | null> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.raw<{
      id: string
      status: WipeStatusRow['status']
      countdown_ends_at: string
      phrase: string
      failure_reason: string | null
    }>(
      sql`select id, status, countdown_ends_at, phrase, failure_reason from app.wipe_requests where status in ('countdown', 'executing') order by created_at desc limit 1`,
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      status: row.status,
      countdownEndsAt: new Date(row.countdown_ends_at),
      phrase: row.phrase,
      failureReason: row.failure_reason,
    }
  })
}

export async function cancelWipe(ctx: AuditCtx): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`update app.wipe_requests set status = 'cancelled', cancelled_at = now(), cancelled_by_user_id = ${ctx.userId}
          where status = 'countdown' returning id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'admin.wipe.cancelled',
      subjectType: 'wipe_request',
      subjectId: rows[0]!.id,
    })
    return true
  })
}

export type WipeExecuteResult = { ok: true } | { ok: false; reason: string }

/** Re-verifies the countdown has actually elapsed server-side (I-6: never trust client timing) before
 * signing and sending the sentinel command -- the 60-second wait is enforced here, not by the UI that
 * happens to disable its own "confirm" button for 60 seconds. */
export async function executeWipe(csrfSecret: string, ctx: AuditCtx): Promise<WipeExecuteResult> {
  const pending = await getActiveWipeRequest()
  if (!pending || pending.status !== 'countdown') return { ok: false, reason: 'no_pending_wipe' }
  if (pending.countdownEndsAt.getTime() > Date.now())
    return { ok: false, reason: 'countdown_not_elapsed' }

  const keypair = await getActiveSentinelKeypair(csrfSecret)
  if (!keypair) return { ok: false, reason: 'no_sentinel_key' }

  const actorLogin = await withContext(adminCtx(ctx), async (tx) => {
    await tx.raw(sql`update app.wipe_requests set status = 'executing' where id = ${pending.id}`)
    tx.audit({ action: 'admin.wipe.executing', subjectType: 'wipe_request', subjectId: pending.id })
    const rows = await tx.drizzle
      .select({ login: schema.users.login })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.userId!))
      .limit(1)
    return rows[0]?.login ?? 'unknown'
  })

  // `actor` rides along unsigned (ADR-014, `sentinel-client.ts`'s header comment): informational log
  // attribution only -- the sentinel never consults it for the authorization decision.
  const result = await sendWipeCommand(keypair.publicKeyB64, keypair.privateKeyB64, actorLogin)

  await withContext(adminCtx(ctx), async (tx) => {
    await tx.raw(sql`
      update app.wipe_requests
      set status = ${result.ok ? 'completed' : 'failed'},
          executed_at = now(),
          sentinel_response = ${result.ok ? result.response : null},
          failure_reason = ${result.ok ? null : result.error}
      where id = ${pending.id}
    `)
    tx.audit({
      action: result.ok ? 'admin.wipe.completed' : 'admin.wipe.failed',
      subjectType: 'wipe_request',
      subjectId: pending.id,
      after: result.ok ? { response: result.response } : { error: result.error },
    })
  })

  return result.ok ? { ok: true } : { ok: false, reason: result.error }
}
