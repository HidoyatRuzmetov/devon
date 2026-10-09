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
// `apps/api/src/db/repo.ts`'s `listActiveMembershipsForUser` for the identical, already-reviewed
// pattern (`GET /me`'s only remaining source of membership rows once `listMembershipsForUser` --
// this same idea, duplicated -- was folded into it while integrating the `work` module).
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withContext, type Tx } from '@devon/db'
import { resolveFeatures, type FeatureFlags, type FeatureKey } from '@devon/contracts'
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
    tx.emit({
      type: 'departments.request.created',
      payload: { requestId: id, requesterUserId, actorUserId: requesterUserId },
    })
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

export type ApprovalResult = {
  departmentId: string
  joinKey: string
  joinPassword: string
}

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
    // v1.1 SPEC §2.2 / TECH-SPEC §19: defaults to OFF. The org chart is the department's
    // constitution; a head opens it up deliberately, never by not having thought about it.
    allowStructureEdit: s.allowStructureEdit ?? false,
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
  /** SPEC §7: every Imkoniyatlar switch resolved against `packages/contracts/src/features.ts`'s
   * defaults, so the client never needs to know what the defaults are. */
  features: FeatureFlags
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
    features: unknown
  }>(
    sql`select id, name, slug, description, emoji, colour, locale_default, status, settings,
               join_requires_approval, features
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
        features: unknown
        my_role: 'head' | 'member'
        member_count: number
      }>(
        sql`select d.id, d.name, d.slug, d.description, d.emoji, d.colour, d.locale_default, d.status,
                   d.settings, d.join_requires_approval, d.features, m.role as my_role,
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
        features: resolveFeatures(dept.features),
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
        features: resolveFeatures(dept.features),
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
): Promise<{
  joinKey: string | null
  joinRequiresApproval: boolean
  hasPassword: boolean
} | null> {
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

    const existing = await tx.raw<{
      status: 'active' | 'pending_approval' | 'removed'
    }>(
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
          do update set status = excluded.status, left_at = null,
                        version = app.memberships.version + 1, updated_at = now()`,
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
      payload: { userId, status, actorUserId: userId },
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
      .set({
        status: 'removed',
        leftAt: new Date(),
        updatedAt: new Date(),
        version: sql`${schema.memberships.version} + 1`,
      })
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
    tx.emit({
      type: 'departments.membership.changed',
      departmentId,
      payload: { userId: targetUserId, actorUserId: ctx.userId },
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
    const left = await tx.drizzle
      .update(schema.memberships)
      .set({
        status: 'removed',
        leftAt: new Date(),
        updatedAt: new Date(),
        version: sql`${schema.memberships.version} + 1`,
      })
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, userId),
          eq(schema.memberships.status, 'active'),
          isNull(schema.memberships.deletedAt),
        ),
      )
      .returning({ id: schema.memberships.id })
    if (!left.length) return { ok: true }
    tx.audit({
      action: 'departments.left',
      subjectType: 'membership',
      subjectId: userId,
      departmentId,
    })
    tx.emit({
      type: 'departments.membership.changed',
      departmentId,
      payload: { userId, actorUserId: ctx.userId },
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
  if (fromUserId !== ctx.userId || fromUserId === toUserId) return false
  return withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    // Account locks precede membership locks in the same sorted order as password reset and
    // account administration. Every eligibility check belongs to this writing transaction.
    const users = await tx.raw<{ id: string; status: string; role: string; deleted: boolean }>(sql`
      select id, status, role, deleted_at is not null as deleted from app.users
      where id in (${fromUserId}, ${toUserId}) order by id for share`)
    const actor = users.find((user) => user.id === fromUserId)
    const target = users.find((user) => user.id === toUserId)
    if (
      !actor ||
      actor.status !== 'active' ||
      actor.deleted ||
      !target ||
      target.status !== 'active' ||
      target.deleted ||
      target.role === 'super_admin'
    )
      return false
    const memberships = await tx.raw<{ user_id: string; role: string; status: string }>(sql`
      select user_id, role, status from app.memberships
      where department_id=${departmentId} and user_id in (${fromUserId}, ${toUserId})
        and deleted_at is null order by user_id for update`)
    const actingMembership = memberships.find((member) => member.user_id === fromUserId)
    const targetMembership = memberships.find((member) => member.user_id === toUserId)
    if (
      !actingMembership ||
      actingMembership.role !== 'head' ||
      actingMembership.status !== 'active' ||
      !targetMembership ||
      targetMembership.role !== 'member' ||
      targetMembership.status !== 'active'
    )
      return false

    await tx.drizzle
      .update(schema.memberships)
      .set({
        role: 'member',
        updatedAt: new Date(),
        version: sql`${schema.memberships.version} + 1`,
      })
      .where(
        and(
          eq(schema.memberships.departmentId, departmentId),
          eq(schema.memberships.userId, fromUserId),
        ),
      )
    await tx.drizzle
      .update(schema.memberships)
      .set({ role: 'head', updatedAt: new Date(), version: sql`${schema.memberships.version} + 1` })
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
    tx.emit({
      type: 'departments.membership.changed',
      departmentId,
      payload: { userIds: [fromUserId, toUserId], actorUserId: ctx.userId },
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// v1.1 SPEC §2.2 -- the join-approval queue
//
// `join_requires_approval` shipped in v1.0 as a setting that inserted the membership with
// `status = 'pending_approval'` and then had nothing anywhere that could approve it
// (WALKTHROUGH-FINDINGS §1.3: "anyone who enables the toggle strands every new joiner
// permanently"). These functions are the missing half. Every one of them is head-only at the
// `can()` layer (`{kind:'department_managed'}`, `apps/api/test/unit/head-only-routes.test.ts`).

export type JoinRequestRow = {
  userId: string
  version: number
  givenName: string
  familyName: string
  patronymic: string | null
  title: string | null
  avatarKey: string | null
  requestedAt: Date
}

export async function listJoinRequests(
  departmentId: string,
  ctx: AuditCtx,
): Promise<JoinRequestRow[]> {
  return withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    const rows = await tx.raw<{
      user_id: string
      given_name: string
      family_name: string
      patronymic: string | null
      title: string | null
      avatar_key: string | null
      joined_at: Date | string
      version: number
    }>(
      sql`select m.user_id, u.given_name, u.family_name, u.patronymic, u.title, u.avatar_key,
                 m.joined_at, m.version
          from app.memberships m join app.users u on u.id = m.user_id
          where m.department_id = ${departmentId} and m.status = 'pending_approval'
            and m.deleted_at is null and u.deleted_at is null
          order by m.joined_at asc`,
    )
    return rows.map((r) => ({
      userId: r.user_id,
      version: r.version,
      givenName: r.given_name,
      familyName: r.family_name,
      patronymic: r.patronymic,
      title: r.title,
      avatarKey: r.avatar_key,
      requestedAt: r.joined_at instanceof Date ? r.joined_at : new Date(r.joined_at),
    }))
  })
}

export type JoinDecision = 'approved' | 'rejected' | 'pending'

/**
 * Approve, reject, or undo the exact approval/rejection named by its membership version.
 * User locks precede membership locks, matching account administration. The locked actor must
 * still be an active head, and the target must still be an eligible ordinary member.
 *
 * A conditional status/version update gives concurrent decisions one winner. Undo also requires
 * the original decision and resulting version, so a later removal, rejoin or role change cannot
 * be undone by an older toast. Membership, audit and outbox changes commit together.
 */
export async function decideJoinRequest(
  departmentId: string,
  targetUserId: string,
  decision: JoinDecision,
  ctx: AuditCtx,
  receipt: {
    expectedVersion?: number | undefined
    originalDecision?: 'approve' | 'reject' | undefined
  } = {},
): Promise<boolean> {
  const next =
    decision === 'approved' ? 'active' : decision === 'rejected' ? 'removed' : 'pending_approval'
  const expected =
    decision === 'pending'
      ? receipt.originalDecision === 'approve'
        ? 'active'
        : 'removed'
      : 'pending_approval'
  if (decision === 'pending' && (!receipt.expectedVersion || !receipt.originalDecision))
    return false
  return withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    // Keep both authorization and target eligibility true until the committed transition.
    const actorUser = await tx.raw(sql`select id from app.users where id = ${ctx.userId}
      and status = 'active' and deleted_at is null for share`)
    if (!actorUser.length) return false
    const actorMembership = await tx.raw(sql`select id from app.memberships
      where department_id = ${departmentId} and user_id = ${ctx.userId}
        and role = 'head' and status = 'active' and deleted_at is null for share`)
    if (!actorMembership.length || targetUserId === ctx.userId) return false
    const targetUser = await tx.raw(sql`select id from app.users where id = ${targetUserId}
      and status = 'active' and role <> 'super_admin' and deleted_at is null for share`)
    if (!targetUser.length) return false
    const current = await tx.raw<{ status: string; version: number }>(sql`
      select status, version from app.memberships
      where department_id = ${departmentId} and user_id = ${targetUserId}
        and role = 'member' and deleted_at is null for update`)
    const row = current[0]
    if (
      !row ||
      row.status !== expected ||
      (receipt.expectedVersion !== undefined && row.version !== receipt.expectedVersion)
    )
      return false
    const rows = await tx.raw<{ user_id: string }>(
      sql`update app.memberships
          set status = ${next}, updated_at = now(),
              version = version + 1,
              left_at = ${decision === 'rejected' ? sql`now()` : null}
          where department_id = ${departmentId} and user_id = ${targetUserId}
            and deleted_at is null and status = ${expected} and version = ${row.version}
          returning user_id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action:
        decision === 'approved'
          ? 'departments.join_approved'
          : decision === 'rejected'
            ? 'departments.join_rejected'
            : 'departments.join_decision_undone',
      subjectType: 'membership',
      subjectId: targetUserId,
      departmentId,
      before: { status: row.status, version: row.version },
      after: { status: next, version: row.version + 1 },
    })
    // The joiner learns the outcome in their inbox and (if linked) in Telegram -- the registry
    // resolves `target_user` from this payload (`notifications/registry.ts`).
    if (decision !== 'pending') {
      tx.emit({
        type: 'departments.join_request.decided',
        departmentId,
        payload: { userId: targetUserId, decision, actorUserId: ctx.userId },
      })
    } else {
      tx.emit({
        type: 'departments.membership.changed',
        departmentId,
        payload: { userId: targetUserId, actorUserId: ctx.userId },
      })
    }
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// v1.1 SPEC §7 -- Imkoniyatlar switches

export async function updateFeatures(
  departmentId: string,
  patch: Partial<Record<FeatureKey, boolean>>,
  ctx: AuditCtx,
): Promise<FeatureFlags> {
  return withContext(deptCtx(ctx, departmentId, 'head'), async (tx) => {
    const before = await tx.raw<{ features: unknown }>(
      sql`select features from app.departments where id = ${departmentId}`,
    )
    const previous = resolveFeatures(before[0]?.features)
    const merged = { ...previous, ...patch }
    await tx.raw(
      sql`update app.departments set features = ${JSON.stringify(merged)}::jsonb, updated_at = now()
          where id = ${departmentId}`,
    )
    tx.audit({
      action: 'departments.features_updated',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      before: previous,
      after: merged,
    })
    return merged
  })
}

// ---------------------------------------------------------------------------------------------
// v1.1 SPEC §2.2 -- the head resets a member's password
//
// Before v1.1 `POST /accounts/:userId/reset-password` was `{kind:'instance'}`, so every forgotten
// password in every department escalated to the single ministry super admin while the login screen
// told people to ask their head (WALKTHROUGH-FINDINGS §2.5). This is the department-scoped twin: the
// head may reset the password of an **active member of their own department**, and of nobody else.

export type ResetMemberPasswordOutcome =
  | { ok: true; temporaryPassword: string }
  | { ok: false; reason: 'not_a_member' | 'is_self' | 'is_head' }

export async function resetMemberPassword(
  departmentId: string,
  targetUserId: string,
  actorUserId: string,
  ctx: AuditCtx,
): Promise<ResetMemberPasswordOutcome> {
  if (targetUserId === actorUserId) return { ok: false, reason: 'is_self' }
  if (actorUserId !== ctx.userId) return { ok: false, reason: 'not_a_member' }

  const membership = await withContext(deptCtx(ctx, departmentId, 'head'), async (tx) =>
    tx.raw<{ role: 'head' | 'member'; status: string }>(
      sql`select role, status from app.memberships
          where department_id = ${departmentId} and user_id = ${targetUserId} and deleted_at is null`,
    ),
  )
  const row = membership[0]
  if (!row || row.status !== 'active') return { ok: false, reason: 'not_a_member' }
  // A head resetting another head's password would be a lateral privilege move inside the
  // department; headship transfer is the sanctioned path, and the super admin stays the escalation
  // route for a head who is locked out.
  if (row.role === 'head') return { ok: false, reason: 'is_head' }

  const temporaryPassword = `${randomFromAlphabet(12)}aA1!`
  const passwordHash = await hashPassword(temporaryPassword)

  return withContext(
    deptCtx(ctx, departmentId, 'head'),
    async (tx): Promise<ResetMemberPasswordOutcome> => {
      // Hashing deliberately happens outside the transaction. Admission can change during that
      // work, so lock and recheck the real actor and target before any credential/session write.
      // Sorted user locks precede membership locks, matching account administration.
      const users = await tx.raw<{
        id: string
        status: string
        role: string
        deleted: boolean
      }>(sql`
      select id, status, role, deleted_at is not null as deleted from app.users
      where id in (${actorUserId}, ${targetUserId}) order by id for update`)
      const actor = users.find((user) => user.id === actorUserId)
      const target = users.find((user) => user.id === targetUserId)
      if (
        !actor ||
        actor.status !== 'active' ||
        actor.deleted ||
        !target ||
        target.status !== 'active' ||
        target.deleted ||
        target.role === 'super_admin'
      )
        return { ok: false, reason: 'not_a_member' }
      const memberships = await tx.raw<{ user_id: string; role: string; status: string }>(sql`
      select user_id, role, status from app.memberships where department_id=${departmentId}
        and user_id in (${actorUserId}, ${targetUserId}) and deleted_at is null
      order by user_id for share`)
      const actingMembership = memberships.find((member) => member.user_id === actorUserId)
      const targetMembership = memberships.find((member) => member.user_id === targetUserId)
      if (
        !actingMembership ||
        actingMembership.role !== 'head' ||
        actingMembership.status !== 'active' ||
        !targetMembership ||
        targetMembership.status !== 'active'
      )
        return { ok: false, reason: 'not_a_member' }
      if (targetMembership.role === 'head') return { ok: false, reason: 'is_head' }
      await tx.raw(
        sql`update app.users
          set password_hash = ${passwordHash}, must_change_password = true, updated_at = now()
          where id = ${targetUserId} and deleted_at is null`,
      )
      // Same rule as the super admin's reset: a deliberate credential reset revokes every live session.
      await tx.raw(
        sql`update app.sessions set revoked_at = now(), revoked_reason = 'password_reset'
          where user_id = ${targetUserId} and revoked_at is null`,
      )
      tx.audit({
        action: 'accounts.password_reset_by_head',
        subjectType: 'user',
        subjectId: targetUserId,
        departmentId,
        after: { mustChangePassword: true },
      })
      tx.emit({
        type: 'accounts.password.reset_by_head',
        departmentId,
        payload: { userId: targetUserId, actorUserId },
      })
      return { ok: true, temporaryPassword }
    },
  )
}
