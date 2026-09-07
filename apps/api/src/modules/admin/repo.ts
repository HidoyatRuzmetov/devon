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
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { schema, withContext, type Tx } from '@devon/db'
import { verifyPassword } from '../../lib/password.js'
import { verifyTotp } from '../accounts/totp.js'
import { decryptSecret as decryptAccountSecret } from '../accounts/crypto.js'
import type { AuditCtx } from '../../types.js'
import type { Locale } from '../../schemas.js'
import { encryptSecret, decryptSecret } from './crypto.js'
import { sendWipeCommand } from './sentinel-client.js'
import { invalidateDepartmentStatusCache, invalidateMaintenanceCache } from './availability-gate.js'

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
      const [cursorCreatedAt, cursorId] = input.cursor.split('|')
      if (cursorCreatedAt && cursorId) {
        conditions.push(
          sql`(d.created_at, d.id) < (${new Date(cursorCreatedAt).toISOString()}::timestamptz, ${cursorId}::uuid)`,
        )
      }
    }

    const rows = await tx.raw<{
      id: string
      name: string
      slug: string
      status: AdminDepartmentRow['status']
      created_at: string
      member_count: string
      head_name: string | null
    }>(sql`
      select d.id, d.name, d.slug, d.status, d.created_at,
        (select count(*) from app.memberships m where m.department_id = d.id and m.status = 'active' and m.deleted_at is null) as member_count,
        (select u.given_name || ' ' || u.family_name from app.memberships hm
           join app.users u on u.id = hm.user_id
           where hm.department_id = d.id and hm.role = 'head' and hm.status = 'active' and hm.deleted_at is null
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
      nextCursor: hasMore && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null,
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
        (select count(*) from app.memberships m where m.department_id = d.id and m.status = 'active' and m.deleted_at is null) as member_count,
        (select u.given_name || ' ' || u.family_name from app.memberships hm
           join app.users u on u.id = hm.user_id
           where hm.department_id = d.id and hm.role = 'head' and hm.status = 'active' and hm.deleted_at is null
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
}

export type AdminUserDetail = AdminUserRow & {
  email: string | null
  locale: Locale
  mustChangePassword: boolean
  twoFactorEnabled: boolean
  lockedUntil: Date | null
  memberships: { departmentId: string; departmentName: string; role: 'head' | 'member' }[]
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
    if (input.role) conditions.push(eq(schema.users.role, input.role))
    if (input.query) {
      const q = `%${input.query}%`
      conditions.push(
        or(
          ilike(schema.users.login, q),
          ilike(schema.users.givenName, q),
          ilike(schema.users.familyName, q),
        )!,
      )
    }
    if (input.cursor) {
      const [cursorCreatedAt, cursorId] = input.cursor.split('|')
      if (cursorCreatedAt && cursorId) {
        conditions.push(
          sql`(${schema.users.createdAt}, ${schema.users.id}) < (${new Date(cursorCreatedAt).toISOString()}::timestamptz, ${cursorId}::uuid)`,
        )
      }
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await tx.drizzle
      .select()
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
      })),
      nextCursor: hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    }
  })
}

export async function getUserDetail(id: string): Promise<AdminUserDetail | null> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.drizzle
      .select()
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

export async function lockUser(id: string, reason: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const before = await tx.drizzle
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
    if (!before[0] || before[0].status === 'deleted') return false

    const lockedUntil = new Date()
    lockedUntil.setFullYear(lockedUntil.getFullYear() + LOCK_FAR_FUTURE_YEARS)
    await tx.drizzle
      .update(schema.users)
      .set({ status: 'locked', updatedAt: new Date() })
      .where(eq(schema.users.id, id))
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
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
    if (!before[0] || before[0].status !== 'locked') return false
    await tx.drizzle
      .update(schema.users)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(schema.users.id, id))
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

export async function forceTwoFactorReset(id: string, ctx: AuditCtx): Promise<void> {
  await withContext(adminCtx(ctx), async (tx) => {
    await tx.raw(sql`
      insert into app.user_security (user_id, totp_enabled, totp_secret_enc, recovery_codes_hash)
      values (${id}, false, null, '{}')
      on conflict (user_id) do update set totp_enabled = false, totp_secret_enc = null, recovery_codes_hash = '{}', updated_at = now()
    `)
    tx.audit({ action: 'admin.user.two_factor_reset', subjectType: 'user', subjectId: id })
  })
}

const ANONYMISED_GIVEN_NAME = "O'chirilgan"
const ANONYMISED_FAMILY_NAME = 'foydalanuvchi'

export async function anonymizeUser(id: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(adminCtx(ctx), async (tx) => {
    const before = await tx.drizzle
      .select({ status: schema.users.status, login: schema.users.login })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
    if (!before[0] || before[0].status === 'deleted') return false

    const randomSuffix = randomBytes(4).toString('hex')
    await tx.drizzle
      .update(schema.users)
      .set({
        status: 'deleted',
        login: `deleted-${randomSuffix}`,
        email: null,
        givenName: ANONYMISED_GIVEN_NAME,
        familyName: ANONYMISED_FAMILY_NAME,
        patronymic: null,
        title: null,
        avatarKey: null,
        passwordHash: `!anonymised:${randomBytes(16).toString('hex')}`,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
    await tx.raw(sql`
      insert into app.user_security (user_id, totp_enabled, totp_secret_enc, recovery_codes_hash, locked_until)
      values (${id}, false, null, '{}', null)
      on conflict (user_id) do update set totp_enabled = false, totp_secret_enc = null, recovery_codes_hash = '{}', locked_until = null, updated_at = now()
    `)
    await tx.raw(
      sql`update app.sessions set revoked_at = now(), revoked_reason = 'admin_anonymise' where user_id = ${id} and revoked_at is null`,
    )
    tx.audit({
      action: 'admin.user.anonymised',
      subjectType: 'user',
      subjectId: id,
      before: { login: before[0].login, status: before[0].status },
      after: { status: 'deleted' },
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

async function countByStatus(tx: Tx) {
  const [deptRows, userRows] = await Promise.all([
    tx.raw<{ status: string; count: string }>(
      sql`select status, count(*)::text as count from app.departments where deleted_at is null group by status`,
    ),
    tx.raw<{ role: string; status: string; count: string }>(
      sql`select role, status, count(*)::text as count from app.users group by role, status`,
    ),
  ])
  return { deptRows, userRows }
}

export async function getGlobalAnalytics(): Promise<AdminAnalytics> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const { deptRows, userRows } = await countByStatus(tx)

    const departments = { total: 0, active: 0, paused: 0, archived: 0 }
    for (const r of deptRows) {
      const n = Number(r.count)
      departments.total += n
      if (r.status === 'active') departments.active += n
      else if (r.status === 'paused_by_admin') departments.paused += n
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
      if (r.status === 'active') people.active += n
      else if (r.status === 'locked') people.locked += n
      else if (r.status === 'deleted') people.deleted += n
      if (r.role === 'super_admin') people.superAdmins += n
      else if (r.role === 'head') people.heads += n
      else if (r.role === 'member') people.members += n
    }

    // `app.cards`/`app.events` belong to the `work`/`events` modules' own schema files, which this
    // module (like `accounts.ts`'s tables) cannot import across the package boundary -- reached here
    // by table name, exactly like `verifyAuditChain`/`checkMigrationsApplied` already do for tables
    // outside the typed `schema` barrel. A Postgres query is parsed in full before any `case when`
    // branch is chosen, so a `to_regclass(...) is null` guard *inside* the same statement as a
    // `select ... from app.cards` would still throw "relation does not exist" on a checkout without
    // that table -- table presence has to be resolved as its own, separate round trip first, and only
    // the queries for tables that actually exist get to run at all.
    const presence = await tx.raw<{ cards: boolean; events: boolean }>(
      sql`select (to_regclass('app.cards') is not null) as cards, (to_regclass('app.events') is not null) as events`,
    )
    const hasCards = presence[0]?.cards ?? false
    const hasEvents = presence[0]?.events ?? false

    const [cardsCreated, cardsCompleted, eventsCreated, weeklyLogins, logins7dRows] =
      await Promise.all([
        hasCards
          ? tx.raw<{ count: string }>(
              sql`select count(*)::text as count from app.cards where created_at >= now() - interval '30 days' and deleted_at is null`,
            )
          : Promise.resolve([{ count: '0' }]),
        hasCards
          ? tx.raw<{ count: string }>(
              sql`select count(*)::text as count from app.cards where done_at >= now() - interval '30 days' and deleted_at is null`,
            )
          : Promise.resolve([{ count: '0' }]),
        hasEvents
          ? tx.raw<{ count: string }>(
              sql`select count(*)::text as count from app.events where created_at >= now() - interval '30 days' and deleted_at is null`,
            )
          : Promise.resolve([{ count: '0' }]),
        tx.raw<{ week_start: string; count: string }>(sql`
        select date_trunc('week', created_at)::date::text as week_start, count(*)::text as count
        from app.sessions
        where created_at >= now() - interval '8 weeks'
        group by 1
        order by 1
      `),
        tx.raw<{ count: string }>(
          sql`select count(*)::text as count from app.sessions where created_at >= now() - interval '7 days'`,
        ),
      ])

    // No AI module/schema exists in this checkout yet (EPIC-009+): report the shape honestly rather
    // than guessing a table name that does not exist, so the console renders "not available" instead
    // of a fabricated zero that looks like real telemetry.
    const aiAvailable = await tx.raw<{ present: boolean }>(
      sql`select (to_regclass('app.ai_usage') is not null) as present`,
    )

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
        available: aiAvailable[0]?.present ?? false,
        tokensThisMonth: 0,
        costUzsThisMonth: 0,
        byDepartment: [],
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
  departmentId: string | null
  action: string
  subjectType: string
  subjectId: string | null
}

export async function listAuditEvents(input: {
  action?: string | undefined
  actorUserId?: string | undefined
  departmentId?: string | undefined
  from?: string | undefined
  to?: string | undefined
  cursor?: number | undefined
  limit: number
}): Promise<{ rows: AuditEventRow[]; nextCursor: number | null }> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const conditions = [sql`1 = 1`]
    if (input.action) conditions.push(sql`action = ${input.action}`)
    if (input.actorUserId) conditions.push(sql`actor_user_id = ${input.actorUserId}::uuid`)
    if (input.departmentId) conditions.push(sql`department_id = ${input.departmentId}::uuid`)
    if (input.from) conditions.push(sql`at >= ${input.from}::timestamptz`)
    if (input.to) conditions.push(sql`at <= ${input.to}::timestamptz`)
    if (input.cursor) conditions.push(sql`seq < ${input.cursor}`)

    const rows = await tx.raw<{
      seq: number
      id: string
      at: string
      actor_user_id: string | null
      actor_role: string | null
      department_id: string | null
      action: string
      subject_type: string
      subject_id: string | null
    }>(sql`
      select seq, id, at, actor_user_id, actor_role, department_id, action, subject_type, subject_id
      from audit.events
      where ${sql.join(conditions, sql` and `)}
      order by seq desc
      limit ${input.limit + 1}
    `)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      rows: page.map((r) => ({
        seq: r.seq,
        id: r.id,
        at: new Date(r.at),
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        departmentId: r.department_id,
        action: r.action,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
      })),
      nextCursor: hasMore && last ? last.seq : null,
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

export type HealthCheck = {
  status: 'ok' | 'degraded' | 'down' | 'not_configured'
  detail: string | null
  latencyMs: number | null
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now()
  const result = await fn()
  return { result, ms: Date.now() - start }
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
        detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
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
        detail: `${pending} pending event(s)${oldest ? `, oldest ${oldest}s` : ''}`,
        latencyMs: null,
      }
    } catch {
      // `processed_at` is `events-worker.ts`'s own bookkeeping column; if a checkout's outbox schema
      // differs, report degraded rather than crashing the whole health page over one card.
      return { status: 'degraded', detail: 'could not read the outbox queue', latencyMs: null }
    }
  })()

  const storage: HealthCheck = await (async () => {
    const dir = process.env['DEVON_STORAGE_DIR']
    if (!dir) return { status: 'not_configured', detail: null, latencyMs: null }
    try {
      const { statfs } = await import('node:fs/promises')
      const stats = await statfs(dir)
      const freeBytes = stats.bfree * stats.bsize
      const freeGb = Math.round((freeBytes / 1024 ** 3) * 10) / 10
      return {
        status: freeGb < 2 ? 'degraded' : 'ok',
        detail: `${freeGb} GB free`,
        latencyMs: null,
      }
    } catch (err) {
      return {
        status: 'down',
        detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
        latencyMs: null,
      }
    }
  })()

  const telegram: HealthCheck = await (async () => {
    try {
      const rows = await withContext(ctx, (tx) =>
        tx.raw<{ present: boolean; groups: string }>(sql`
          select (to_regclass('app.telegram_groups') is not null) as present,
            case when to_regclass('app.telegram_groups') is null then '0'
              else (select count(*)::text from app.telegram_groups) end as groups
        `),
      )
      if (!rows[0]?.present) return { status: 'not_configured', detail: null, latencyMs: null }
      return { status: 'ok', detail: `${rows[0].groups} group(s) connected`, latencyMs: null }
    } catch {
      return { status: 'not_configured', detail: null, latencyMs: null }
    }
  })()

  const ai: HealthCheck = await (async () => {
    const apiKey = process.env['AI_API_KEY']
    if (!apiKey) return { status: 'not_configured', detail: null, latencyMs: null }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const { ms } = await timed(() =>
        fetch('https://api-llm.gpu.uz/v1/models', {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        }),
      )
      clearTimeout(timeout)
      return { status: 'ok', detail: null, latencyMs: ms }
    } catch (err) {
      return {
        status: 'down',
        detail: err instanceof Error ? err.message.slice(0, 200) : 'unreachable',
        latencyMs: null,
      }
    }
  })()

  const backups: HealthCheck = await (async () => {
    const dir = process.env['DEVON_BACKUP_DIR']
    if (!dir) return { status: 'not_configured', detail: null, latencyMs: null }
    try {
      const { readdir, stat } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const entries = await readdir(dir)
      if (entries.length === 0)
        return { status: 'degraded', detail: 'no backups found', latencyMs: null }
      let newest = 0
      for (const entry of entries) {
        const s = await stat(join(dir, entry))
        if (s.mtimeMs > newest) newest = s.mtimeMs
      }
      const ageHours = (Date.now() - newest) / 3_600_000
      return {
        status: ageHours > 48 ? 'degraded' : 'ok',
        detail: `latest backup ${Math.round(ageHours)}h ago`,
        latencyMs: null,
      }
    } catch (err) {
      return {
        status: 'down',
        detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
        latencyMs: null,
      }
    }
  })()

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
  createdAt: Date | null
}> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.raw<{ created_at: string }>(
      sql`select created_at from app.sentinel_keys where active = true order by created_at desc limit 1`,
    )
    return {
      hasActiveKey: rows.length > 0,
      createdAt: rows[0] ? new Date(rows[0].created_at) : null,
    }
  })
}

/** Returns the raw hex key exactly once (the response body); only `key_enc` is ever persisted. */
export async function rotateSentinelKey(csrfSecret: string, ctx: AuditCtx): Promise<string> {
  const rawKey = randomBytes(32).toString('hex')
  const keyEnc = encryptSecret(rawKey, csrfSecret)
  await withContext(adminCtx(ctx), async (tx) => {
    await tx.raw(
      sql`update app.sentinel_keys set active = false, deactivated_at = now() where active = true`,
    )
    await tx.raw(
      sql`insert into app.sentinel_keys (key_enc, active, created_by_user_id) values (${keyEnc}, true, ${ctx.userId})`,
    )
    tx.audit({ action: 'admin.sentinel.key_rotated', subjectType: 'sentinel_key', subjectId: null })
  })
  return rawKey
}

async function getActiveSentinelKey(csrfSecret: string): Promise<string | null> {
  return withContext(anonymousAdminCtx(), async (tx) => {
    const rows = await tx.raw<{ key_enc: string }>(
      sql`select key_enc from app.sentinel_keys where active = true order by created_at desc limit 1`,
    )
    if (!rows[0]) return null
    return decryptSecret(rows[0].key_enc, csrfSecret)
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

  const key = await getActiveSentinelKey(csrfSecret)
  if (!key) return { ok: false, reason: 'no_sentinel_key' }

  await withContext(adminCtx(ctx), async (tx) => {
    await tx.raw(sql`update app.wipe_requests set status = 'executing' where id = ${pending.id}`)
    tx.audit({ action: 'admin.wipe.executing', subjectType: 'wipe_request', subjectId: pending.id })
  })

  const result = await sendWipeCommand(key, pending.id)

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
