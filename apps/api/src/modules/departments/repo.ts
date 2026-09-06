// DB access for `/api/v1/departments/*` (EPIC-002). See `modules/accounts/repo.ts`'s header for why
// this is a module-owned repo file rather than an edit to the shared `apps/api/src/deps.ts`.
//
// RLS note (`migrations/0005_rls.sql`, `0100_accounts_departments.sql`): every function below that
// touches exactly one already-known department opens its `withContext()` with that department's id as
// the GUC and the caller's real membership role -- the same shape every other department-scoped route
// in this codebase uses. The few functions that are inherently cross-department by nature (the public
// join preview, joining by key before the department id is known, approving a request that creates a
// brand-new department id) instead use `actorRole: 'super_admin'` purely as an RLS-evaluation choice
// for that one internal query -- never as a stand-in for the real actor's authorization, which the
// caller (`index.ts`) has already decided via `can()` before any of these functions run. See
// `apps/api/src/db/repo.ts`'s `listMembershipsForUser` for the identical, already-reviewed pattern.
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withContext, type Tx } from '@devon/db'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import type { AuditCtx } from '../../types.js'
import type { Locale } from '../../schemas.js'
import type { CreateDepartmentRequestBody } from './schemas.js'

export type DepartmentUnit = { name: string; colour?: string }

const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // unambiguous: no 0/O, 1/I/L (TECH-SPEC §2.2)
const JOIN_ATTEMPT_WINDOW_MINUTES = 10
const JOIN_ATTEMPT_MAX = 10

function randomFromAlphabet(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += JOIN_ALPHABET[bytes[i]! % JOIN_ALPHABET.length]
  return out
}
const generateJoinKey = () => randomFromAlphabet(12)
const generateJoinPassword = () => randomFromAlphabet(10)

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[ʻʼ'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
  return base.length > 0 ? base.slice(0, 60) : 'department'
}

function adminCtx(ctx: AuditCtx, departmentId: string | null) {
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

function deptCtx(
  ctx: AuditCtx,
  departmentId: string,
  role: 'head' | 'member' | 'super_admin' = 'member',
) {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: role,
    departmentId,
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }
}

// ---------------------------------------------------------------------------------------------
// Requests

export async function createDepartmentRequest(
  requesterUserId: string,
  body: CreateDepartmentRequestBody,
  ctx: AuditCtx,
): Promise<string> {
  return withContext(adminCtx(ctx, null), async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`insert into app.department_requests
            (requester_user_id, name, description, units, locale, status)
          values (
            ${requesterUserId}, ${body.name}, ${body.description ?? null},
            ${JSON.stringify(body.units)}::jsonb, ${body.locale}, 'pending'
          )
          returning id`,
    )
    const id = rows[0]!.id
    tx.audit({
      action: 'departments.request_created',
      subjectType: 'department_request',
      subjectId: id,
    })
    tx.emit({ type: 'departments.request.created', payload: { requestId: id, requesterUserId } })
    return id
  })
}

export type DepartmentRequestRow = {
  id: string
  requesterUserId: string
  requesterName: string
  name: string
  description: string | null
  units: DepartmentUnit[]
  locale: Locale
  status: 'pending' | 'approved' | 'rejected'
  reason: string | null
  createdAt: Date
  reviewedAt: Date | null
  createdDepartmentId: string | null
}

function mapRequestRow(r: {
  id: string
  requester_user_id: string
  requester_given_name: string
  requester_family_name: string
  name: string
  description: string | null
  units: unknown
  locale: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string | null
  created_at: Date
  reviewed_at: Date | null
  created_department_id: string | null
}): DepartmentRequestRow {
  return {
    id: r.id,
    requesterUserId: r.requester_user_id,
    requesterName: `${r.requester_given_name} ${r.requester_family_name}`,
    name: r.name,
    description: r.description,
    units: (r.units ?? []) as DepartmentUnit[],
    locale: r.locale as Locale,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    createdDepartmentId: r.created_department_id,
  }
}

export async function listDepartmentRequests(
  statusFilter?: 'pending' | 'approved' | 'rejected',
): Promise<DepartmentRequestRow[]> {
  return withContext(
    adminCtx(
      {
        requestId: randomUUID(),
        userId: null,
        actorRole: null,
        actingForUserId: null,
        ip: '',
        userAgent: '',
      },
      null,
    ),
    async (tx) => {
      const rows = await tx.raw<Parameters<typeof mapRequestRow>[0]>(
        statusFilter
          ? sql`select r.*, u.given_name as requester_given_name, u.family_name as requester_family_name
              from app.department_requests r join app.users u on u.id = r.requester_user_id
              where r.status = ${statusFilter}
              order by r.created_at desc`
          : sql`select r.*, u.given_name as requester_given_name, u.family_name as requester_family_name
              from app.department_requests r join app.users u on u.id = r.requester_user_id
              order by r.created_at desc`,
      )
      return rows.map(mapRequestRow)
    },
  )
}

export async function listOwnDepartmentRequests(userId: string): Promise<DepartmentRequestRow[]> {
  return withContext(
    adminCtx(
      {
        requestId: randomUUID(),
        userId,
        actorRole: null,
        actingForUserId: null,
        ip: '',
        userAgent: '',
      },
      null,
    ),
    async (tx) => {
      const rows = await tx.raw<Parameters<typeof mapRequestRow>[0]>(
        sql`select r.*, u.given_name as requester_given_name, u.family_name as requester_family_name
          from app.department_requests r join app.users u on u.id = r.requester_user_id
          where r.requester_user_id = ${userId}
          order by r.created_at desc`,
      )
      return rows.map(mapRequestRow)
    },
  )
}

export type ApprovalResult = { departmentId: string; joinKey: string; joinPassword: string }

export async function approveDepartmentRequest(
  requestId: string,
  ctx: AuditCtx,
): Promise<ApprovalResult | null> {
  const departmentId = randomUUID()
  const joinKey = generateJoinKey()
  const joinPassword = generateJoinPassword()
  const joinPasswordHash = await hashPassword(joinPassword)

  return withContext(adminCtx(ctx, departmentId), async (tx) => {
    const requestRows = await tx.raw<{
      id: string
      requester_user_id: string
      name: string
      description: string | null
      locale: string
      status: string
    }>(sql`select id, requester_user_id, name, description, locale, status
           from app.department_requests where id = ${requestId} for update`)
    const request = requestRows[0]
    if (!request || request.status !== 'pending') return null

    const slugBase = slugify(request.name)
    const slug = `${slugBase}-${departmentId.slice(0, 8)}`

    await tx.drizzle.insert(schema.departments).values({
      id: departmentId,
      name: request.name,
      slug,
      description: request.description,
      localeDefault: request.locale,
    })
    await tx.raw(
      sql`update app.departments
          set join_key = ${joinKey}, join_password_hash = ${joinPasswordHash},
              join_requires_approval = false, created_from_request_id = ${requestId}
          where id = ${departmentId}`,
    )
    await tx.drizzle.insert(schema.memberships).values({
      departmentId,
      userId: request.requester_user_id,
      role: 'head',
    })
    await tx.raw(
      sql`update app.department_requests
          set status = 'approved', reviewed_by = ${ctx.userId}, reviewed_at = now(),
              created_department_id = ${departmentId}, updated_at = now()
          where id = ${requestId}`,
    )

    tx.audit({
      action: 'departments.request_approved',
      subjectType: 'department_request',
      subjectId: requestId,
      departmentId,
      after: { departmentId, name: request.name },
    })
    tx.emit({
      type: 'departments.department.created',
      departmentId,
      payload: { departmentId, headUserId: request.requester_user_id },
    })
    return { departmentId, joinKey, joinPassword }
  })
}

export async function rejectDepartmentRequest(
  requestId: string,
  reason: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(adminCtx(ctx, null), async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`update app.department_requests
          set status = 'rejected', reason = ${reason}, reviewed_by = ${ctx.userId}, reviewed_at = now(), updated_at = now()
          where id = ${requestId} and status = 'pending'
          returning id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'departments.request_rejected',
      subjectType: 'department_request',
      subjectId: requestId,
      after: { reason },
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// Departments: settings, invite, membership

type SettingsJson = {
  allowSelfAssign?: boolean
  allowStructureEdit?: boolean
  whoCanConnectTelegramGroup?: 'everyone' | 'head'
  quietHours?: { start: string; end: string } | null
}

function normalizeSettings(raw: unknown): Required<SettingsJson> {
  const s = (raw ?? {}) as SettingsJson
  return {
    allowSelfAssign: s.allowSelfAssign ?? true,
    allowStructureEdit: s.allowStructureEdit ?? true,
    whoCanConnectTelegramGroup: s.whoCanConnectTelegramGroup ?? 'everyone',
    quietHours: s.quietHours ?? null,
  }
}

export type DepartmentDetail = {
  id: string
  name: string
  slug: string
  description: string | null
  emoji: string | null
  colour: string | null
  localeDefault: Locale
  status: 'active' | 'paused_by_admin' | 'deletion_requested' | 'archived'
  joinRequiresApproval: boolean
  settings: Required<SettingsJson>
  myRole: 'head' | 'member'
  memberCount: number
}

async function selectDepartmentCore(tx: Tx, departmentId: string) {
  const rows = await tx.raw<{
    id: string
    name: string
    slug: string
    description: string | null
    emoji: string | null
    colour: string | null
    locale_default: string
    status: DepartmentDetail['status']
    settings: unknown
    join_requires_approval: boolean
  }>(
    sql`select id, name, slug, description, emoji, colour, locale_default, status, settings, join_requires_approval
        from app.departments where id = ${departmentId} and deleted_at is null`,
  )
  return rows[0] ?? null
}

/** Every department a user belongs to, with settings/member counts -- for `GET /departments/mine`
 * (the switcher, the settings entry points) and `GET /departments/:id`. One query, not one per
 * membership (MODULE-GUIDE.md / TECH-SPEC §16: no query in a loop) -- the per-department member count
 * is a correlated subquery the database evaluates as part of the same round trip. */
export async function listMyDepartments(userId: string): Promise<DepartmentDetail[]> {
  return withContext(
    {
      requestId: randomUUID(),
      userId,
      actorRole: 'super_admin',
      departmentId: null,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: '',
    },
    async (tx) => {
      const rows = await tx.raw<{
        id: string
        name: string
        slug: string
        description: string | null
        emoji: string | null
        colour: string | null
        locale_default: string
        status: DepartmentDetail['status']
        settings: unknown
        join_requires_approval: boolean
        my_role: 'head' | 'member'
        member_count: number
      }>(
        sql`select d.id, d.name, d.slug, d.description, d.emoji, d.colour, d.locale_default, d.status,
                   d.settings, d.join_requires_approval, m.role as my_role,
                   (select count(*)::int from app.memberships m2
                      where m2.department_id = d.id and m2.status = 'active' and m2.deleted_at is null
                   ) as member_count
            from app.memberships m
            join app.departments d on d.id = m.department_id and d.deleted_at is null
            where m.user_id = ${userId} and m.status = 'active' and m.deleted_at is null
            order by d.name`,
      )
      return rows.map((dept) => ({
        id: dept.id,
        name: dept.name,
        slug: dept.slug,
        description: dept.description,
        emoji: dept.emoji,
        colour: dept.colour,
        localeDefault: dept.locale_default as Locale,
        status: dept.status,
        joinRequiresApproval: dept.join_requires_approval,
        settings: normalizeSettings(dept.settings),
        myRole: dept.my_role,
        memberCount: dept.member_count,
      }))
    },
  )
}

export async function getDepartmentDetail(
  departmentId: string,
  userId: string,
  role: 'head' | 'member',
): Promise<DepartmentDetail | null> {
  return withContext(
    deptCtx(
      {
        requestId: randomUUID(),
        userId,
        actorRole: role,
        actingForUserId: null,
        ip: '',
        userAgent: '',
      },
      departmentId,
      role,
    ),
    async (tx) => {
      const dept = await selectDepartmentCore(tx, departmentId)
      if (!dept) return null
      const countRows = await tx.raw<{ count: number }>(
        sql`select count(*)::int as count from app.memberships
          where department_id = ${departmentId} and status = 'active' and deleted_at is null`,
      )
      return {
        id: dept.id,
        name: dept.name,
        slug: dept.slug,
        description: dept.description,
        emoji: dept.emoji,
        colour: dept.colour,
        localeDefault: dept.locale_default as Locale,
        status: dept.status,
        joinRequiresApproval: dept.join_requires_approval,
        settings: normalizeSettings(dept.settings),
        myRole: role,
        memberCount: countRows[0]?.count ?? 0,
      }
    },
  )
}

export type SettingsPatch = {
  allowSelfAssign?: boolean | undefined
  allowStructureEdit?: boolean | undefined
  joinRequiresApproval?: boolean | undefined
  whoCanConnectTelegramGroup?: ('everyone' | 'head') | undefined
  quietHours?: { start: string; end: string } | null | undefined
  name?: string | undefined
  description?: string | null | undefined
  emoji?: string | null | undefined
  colour?: string | null | undefined
  localeDefault?: Locale | undefined
}

export async function updateDepartmentSettings(
  departmentId: string,
  userId: string,
  patch: SettingsPatch,
  ctx: AuditCtx,
): Promise<void> {
  await withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    const dept = await selectDepartmentCore(tx, departmentId)
    if (!dept) throw new Error('department not found')
    const merged = normalizeSettings(dept.settings)
    if (patch.allowSelfAssign !== undefined) merged.allowSelfAssign = patch.allowSelfAssign
    if (patch.allowStructureEdit !== undefined) merged.allowStructureEdit = patch.allowStructureEdit
    if (patch.whoCanConnectTelegramGroup !== undefined)
      merged.whoCanConnectTelegramGroup = patch.whoCanConnectTelegramGroup
    if (patch.quietHours !== undefined) merged.quietHours = patch.quietHours

    await tx.drizzle
      .update(schema.departments)
      .set({
        settings: merged,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
        ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
        ...(patch.localeDefault !== undefined ? { localeDefault: patch.localeDefault } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.departments.id, departmentId))

    if (patch.joinRequiresApproval !== undefined) {
      await tx.raw(
        sql`update app.departments set join_requires_approval = ${patch.joinRequiresApproval} where id = ${departmentId}`,
      )
    }

    tx.audit({
      action: 'departments.settings_updated',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      after: patch as Record<string, unknown>,
    })
  })
}

export async function requestDepartmentDeletion(
  departmentId: string,
  ctx: AuditCtx,
): Promise<void> {
  await withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    await tx.drizzle
      .update(schema.departments)
      .set({ status: 'deletion_requested', updatedAt: new Date() })
      .where(eq(schema.departments.id, departmentId))
    tx.audit({
      action: 'departments.deletion_requested',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
    })
  })
}

export async function getInvite(
  departmentId: string,
  userId: string,
): Promise<{ joinKey: string | null; joinRequiresApproval: boolean; hasPassword: boolean } | null> {
  return withContext(
    deptCtx(
      {
        requestId: randomUUID(),
        userId,
        actorRole: 'head',
        actingForUserId: null,
        ip: '',
        userAgent: '',
      },
      departmentId,
      'head',
    ),
    async (tx) => {
      const rows = await tx.raw<{
        join_key: string | null
        join_requires_approval: boolean
        join_password_hash: string | null
      }>(
        sql`select join_key, join_requires_approval, join_password_hash from app.departments where id = ${departmentId}`,
      )
      const row = rows[0]
      if (!row) return null
      return {
        joinKey: row.join_key,
        joinRequiresApproval: row.join_requires_approval,
        hasPassword: row.join_password_hash !== null,
      }
    },
  )
}

export async function rotateJoinKey(departmentId: string, ctx: AuditCtx): Promise<string> {
  const joinKey = generateJoinKey()
  await withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    await tx.raw(sql`update app.departments set join_key = ${joinKey} where id = ${departmentId}`)
    tx.audit({
      action: 'departments.invite_key_rotated',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
    })
  })
  return joinKey
}

export async function rotateJoinPassword(departmentId: string, ctx: AuditCtx): Promise<string> {
  const password = generateJoinPassword()
  const hash = await hashPassword(password)
  await withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    await tx.raw(
      sql`update app.departments set join_password_hash = ${hash} where id = ${departmentId}`,
    )
    tx.audit({
      action: 'departments.invite_password_rotated',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
    })
  })
  return password
}

export async function setJoinPassword(
  departmentId: string,
  password: string,
  ctx: AuditCtx,
): Promise<void> {
  const hash = await hashPassword(password)
  await withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    await tx.raw(
      sql`update app.departments set join_password_hash = ${hash} where id = ${departmentId}`,
    )
    tx.audit({
      action: 'departments.invite_password_set',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
    })
  })
}

export async function setJoinApproval(
  departmentId: string,
  joinRequiresApproval: boolean,
  ctx: AuditCtx,
): Promise<void> {
  await withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    await tx.raw(
      sql`update app.departments set join_requires_approval = ${joinRequiresApproval} where id = ${departmentId}`,
    )
    tx.audit({
      action: 'departments.invite_approval_toggled',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      after: { joinRequiresApproval },
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Join

export async function getJoinPreview(key: string): Promise<{
  name: string
  emoji: string | null
  colour: string | null
  joinRequiresApproval: boolean
} | null> {
  return withContext(
    {
      requestId: randomUUID(),
      userId: null,
      actorRole: 'super_admin',
      departmentId: null,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: '',
    },
    async (tx) => {
      const rows = await tx.raw<{
        name: string
        emoji: string | null
        colour: string | null
        join_requires_approval: boolean
      }>(
        sql`select name, emoji, colour, join_requires_approval from app.departments
            where join_key = ${key} and status = 'active' and deleted_at is null`,
      )
      const row = rows[0]
      if (!row) return null
      return {
        name: row.name,
        emoji: row.emoji,
        colour: row.colour,
        joinRequiresApproval: row.join_requires_approval,
      }
    },
  )
}

export type JoinOutcome =
  | { ok: true; departmentId: string; status: 'active' | 'pending_approval' }
  | { ok: false; reason: 'invalid' | 'rate_limited' }

export async function joinByKeyAndPassword(
  userId: string,
  key: string,
  password: string,
  ctx: AuditCtx,
): Promise<JoinOutcome> {
  const systemCtx = {
    requestId: ctx.requestId,
    userId,
    actorRole: 'super_admin' as const,
    departmentId: null,
    actingForUserId: null,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }

  const rateLimited = await withContext(systemCtx, async (tx) => {
    const rows = await tx.raw<{ count: number }>(
      sql`select count(*)::int as count from app.join_attempts
          where (join_key = ${key} or ip = ${ctx.ip || null})
            and at > now() - (${JOIN_ATTEMPT_WINDOW_MINUTES} * interval '1 minute')`,
    )
    return (rows[0]?.count ?? 0) >= JOIN_ATTEMPT_MAX
  })
  if (rateLimited) return { ok: false, reason: 'rate_limited' }

  return withContext(systemCtx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      join_password_hash: string | null
      join_requires_approval: boolean
      status: string
    }>(
      sql`select id, join_password_hash, join_requires_approval, status from app.departments
          where join_key = ${key} and deleted_at is null`,
    )
    const dept = rows[0]
    const passwordOk =
      dept?.join_password_hash != null && (await verifyPassword(dept.join_password_hash, password))
    const ok = Boolean(dept && dept.status === 'active' && passwordOk)

    await tx.raw(
      sql`insert into app.join_attempts (join_key, department_id, ip, user_id, ok)
          values (${key}, ${dept?.id ?? null}, ${ctx.ip || null}, ${userId}, ${ok})`,
    )

    if (!dept || !ok) {
      tx.audit({
        action: 'departments.join_failed',
        subjectType: 'department',
        subjectId: dept?.id ?? null,
      })
      return { ok: false, reason: 'invalid' }
    }

    const existing = await tx.raw<{ status: 'active' | 'pending_approval' | 'removed' }>(
      sql`select status from app.memberships
          where department_id = ${dept.id} and user_id = ${userId} and deleted_at is null`,
    )
    if (existing[0] && existing[0].status !== 'removed') {
      return { ok: true, departmentId: dept.id, status: existing[0].status }
    }

    const status = dept.join_requires_approval ? 'pending_approval' : 'active'
    // `memberships_write`'s `WITH CHECK` (0005_rls.sql) requires `department_id = current_department_id()`
    // -- `systemCtx` opened this transaction with that GUC `null` (the department wasn't known yet), so
    // it is retargeted here, inside the same transaction (`SET LOCAL` semantics, still scoped to this
    // transaction alone), now that `dept.id` is.
    await tx.raw(sql`select set_config('app.department_id', ${dept.id}, true)`)
    await tx.raw(
      sql`insert into app.memberships (department_id, user_id, role, status)
          values (${dept.id}, ${userId}, 'member', ${status})
          on conflict (department_id, user_id) where deleted_at is null
          do update set status = excluded.status, left_at = null`,
    )
    tx.audit({
      action: 'departments.joined',
      subjectType: 'membership',
      subjectId: userId,
      departmentId: dept.id,
      after: { status },
    })
    tx.emit({
      type: 'departments.member.joined',
      departmentId: dept.id,
      payload: { userId, status },
    })
    return { ok: true, departmentId: dept.id, status }
  })
}

// ---------------------------------------------------------------------------------------------
// Membership management

export type MemberRow = {
  userId: string
  givenName: string
  familyName: string
  patronymic: string | null
  title: string | null
  avatarKey: string | null
  role: 'head' | 'member'
  status: 'active' | 'pending_approval' | 'removed'
  joinedAt: Date
}

export async function listMembers(
  departmentId: string,
  userId: string,
  role: 'head' | 'member',
): Promise<MemberRow[]> {
  return withContext(
    deptCtx(
      {
        requestId: randomUUID(),
        userId,
        actorRole: role,
        actingForUserId: null,
        ip: '',
        userAgent: '',
      },
      departmentId,
      role,
    ),
    async (tx) => {
      const rows = await tx.drizzle
        .select({
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          status: schema.memberships.status,
          joinedAt: schema.memberships.joinedAt,
          givenName: schema.users.givenName,
          familyName: schema.users.familyName,
          patronymic: schema.users.patronymic,
          title: schema.users.title,
          avatarKey: schema.users.avatarKey,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(
          and(
            eq(schema.memberships.departmentId, departmentId),
            isNull(schema.memberships.deletedAt),
          ),
        )
      return rows
    },
  )
}

export async function removeMember(
  departmentId: string,
  targetUserId: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    const rows = await tx.drizzle
      .update(schema.memberships)
      .set({ status: 'removed', leftAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, targetUserId),
        ),
      )
      .returning({ id: schema.memberships.id })
    if (rows.length === 0) return false
    tx.audit({
      action: 'departments.member_removed',
      subjectType: 'membership',
      subjectId: targetUserId,
      departmentId,
    })
    return true
  })
}

export async function leaveDepartment(
  departmentId: string,
  userId: string,
  ctx: AuditCtx,
): Promise<{ ok: true } | { ok: false; reason: 'is_only_head' }> {
  return withContext(deptCtx(ctx, departmentId, 'member'), async (tx) => {
    const own = await tx.drizzle
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, userId),
        ),
      )
      .limit(1)
    if (own[0]?.role === 'head') {
      return { ok: false, reason: 'is_only_head' as const }
    }
    await tx.drizzle
      .update(schema.memberships)
      .set({ status: 'removed', leftAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, userId),
        ),
      )
    tx.audit({
      action: 'departments.left',
      subjectType: 'membership',
      subjectId: userId,
      departmentId,
    })
    return { ok: true }
  })
}

export async function transferHeadship(
  departmentId: string,
  fromUserId: string,
  toUserId: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    const target = await tx.drizzle
      .select({ status: schema.memberships.status })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, toUserId),
        ),
      )
      .limit(1)
    if (!target[0] || target[0].status !== 'active') return false

    await tx.drizzle
      .update(schema.memberships)
      .set({ role: 'member', updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, fromUserId),
        ),
      )
    await tx.drizzle
      .update(schema.memberships)
      .set({ role: 'head', updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, toUserId),
        ),
      )
    tx.audit({
      action: 'departments.headship_transferred',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      after: { from: fromUserId, to: toUserId },
    })
    return true
  })
}
