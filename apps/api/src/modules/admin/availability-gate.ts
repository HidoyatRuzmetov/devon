// TECH-SPEC §11 "pause switch" + the department-pause half of §10 ("pause a department"). Two
// independent availability checks that both pre-date `can()` (I-6): whether the *instance* is in
// maintenance, and whether the *department* a request targets has been paused by the super admin.
// `@devon/contracts`'s `DenyReason` has carried `'maintenance'`/`'department_paused'` and
// `ProblemCode` has carried `'maintenance'` (503) since EPIC-000 waiting for exactly this (see
// `packages/contracts/src/permissions.ts`'s doc comment) -- deliberately NOT folded into `can()`
// itself, which is a pure function of `(Actor, Subject)` with no database access by design (this
// module's own report has the full reasoning): this file is a separate, additive availability gate
// that runs immediately after `req.actor` is resolved and before `can()` ever runs, using the exact
// same `config.permission.subject(req)` every route already declares to learn which department (if
// any) a request targets, without any other module changing a line.
//
// `registerAvailabilityGate(app)` is called once from `app.ts`, between `sessionPlugin` (so
// `req.actor` exists) and `authorizePlugin` (so a paused/maintenance deny short-circuits before a
// permission check ever runs) -- the one other minimal, additive edit outside this module's own
// folder (2 lines, same precedent as `PUBLIC_ROUTES`), documented in this item's report.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { schema, withContext } from '@devon/db'
import type { Subject } from '@devon/contracts'
import { sendProblem } from '../../lib/problem-reply.js'

export type DepartmentStatus = 'active' | 'paused_by_admin' | 'deletion_requested' | 'archived'

type AvailabilityInput = {
  maintenanceEnabled: boolean
  actorRole: 'super_admin' | 'head' | 'member' | null
  exempt: boolean
  action: 'read' | 'create' | 'update' | 'archive' | 'delete' | 'administer' | null
  departmentStatus: DepartmentStatus | null
}

export type AvailabilityDecision =
  { allow: true } | { allow: false; problem: 'maintenance' | 'department_paused' }

/**
 * Pure decision (unit-tested in `test/unit/availability-gate.test.ts` -- no Fastify, no database).
 * Rules:
 * - A `super_admin` actor bypasses both maintenance and department-pause entirely (TECH-SPEC §11:
 *   "super admin login and the console stay reachable"; §10 "pause a department" is a lever the super
 *   admin operates, never one that can lock them out of operating it).
 * - An explicitly `exempt` route (health checks, `/instance`, login, the 2FA login step, `/me`) is
 *   never blocked by maintenance -- the client needs these to render the maintenance page itself and
 *   to let the super admin's login attempt through in the first place.
 * - Otherwise, maintenance blocks everything.
 * - A paused/archived department blocks only non-`read` actions on it, mirroring `can()`'s existing
 *   `read_only_view_as` shape (I-8a): the department's own board stays visible (so its members can see
 *   *why* nothing works) but no one can change it while paused.
 */
export function decideAvailability(input: AvailabilityInput): AvailabilityDecision {
  if (input.actorRole === 'super_admin') return { allow: true }
  if (input.maintenanceEnabled && !input.exempt) return { allow: false, problem: 'maintenance' }
  if (
    input.departmentStatus !== null &&
    input.departmentStatus !== 'active' &&
    input.action !== null &&
    input.action !== 'read'
  ) {
    return { allow: false, problem: 'department_paused' }
  }
  return { allow: true }
}

/** Pre-auth and instance-discovery routes a maintenance page itself depends on -- checked by exact
 * `METHOD url-pattern` against `req.routeOptions.url` (the registered route pattern, not the raw path
 * with real ids substituted in, so this never needs a regex per request). */
const MAINTENANCE_EXEMPT_ROUTES: ReadonlySet<string> = new Set([
  'GET /healthz',
  'GET /readyz',
  'GET /api/v1/instance',
  'GET /api/v1/openapi.json',
  'POST /api/v1/setup/:token',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/accounts/2fa/login-verify',
  'GET /api/v1/me',
])

function isMaintenanceExempt(req: FastifyRequest): boolean {
  const url = req.routeOptions.url ?? req.url
  if (MAINTENANCE_EXEMPT_ROUTES.has(`${req.method} ${url}`)) return true
  // The console itself (every `/api/v1/admin/*` route) stays reachable so a super admin can log in
  // during maintenance and turn it back off -- `can()` still applies afterwards (a non-super-admin
  // hitting these gets its ordinary 403, never a 503 that would leak "this route exists").
  return url.startsWith('/api/v1/admin')
}

const MAINTENANCE_TTL_MS = 2_000
let maintenanceCache: { enabled: boolean; expiresAt: number } | null = null

/** `refresh` is the only DB access this function ever performs, injected so `app.ts`'s wiring can
 * reuse `app.devon.getInstanceSettings()` (already polled by `GET /instance` and `GET /me`) instead of
 * a second, competing read path -- a 2-second in-process cache stands in for TECH-SPEC §11's Valkey
 * mirror at this scale (a single-node self-hosted deployment, ADR-002), documented as a deliberate
 * simplification in this item's report rather than adding a Valkey dependency this epic does not
 * otherwise need. */
async function getMaintenanceEnabled(refresh: () => Promise<boolean>): Promise<boolean> {
  const now = Date.now()
  if (maintenanceCache && maintenanceCache.expiresAt > now) return maintenanceCache.enabled
  const enabled = await refresh()
  maintenanceCache = { enabled, expiresAt: now + MAINTENANCE_TTL_MS }
  return enabled
}

/** Called by `modules/admin/repo.ts` right after writing `instance_settings.maintenance` so a toggle
 * takes effect on the very next request instead of waiting out the cache TTL. */
export function invalidateMaintenanceCache(): void {
  maintenanceCache = null
}

const DEPARTMENT_STATUS_TTL_MS = 5_000
const departmentStatusCache = new Map<string, { status: DepartmentStatus; expiresAt: number }>()

async function getDepartmentStatusCached(departmentId: string): Promise<DepartmentStatus | null> {
  const now = Date.now()
  const cached = departmentStatusCache.get(departmentId)
  if (cached && cached.expiresAt > now) return cached.status
  const status = await withContext(
    {
      requestId: 'availability-gate',
      userId: null,
      actorRole: 'super_admin',
      departmentId: null,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: '',
    },
    async (tx) => {
      const rows = await tx.drizzle
        .select({ status: schema.departments.status })
        .from(schema.departments)
        .where(eq(schema.departments.id, departmentId))
        .limit(1)
      return rows[0]?.status ?? null
    },
  )
  if (status)
    departmentStatusCache.set(departmentId, { status, expiresAt: now + DEPARTMENT_STATUS_TTL_MS })
  return status
}

/** Called by `modules/admin/repo.ts` right after pausing/resuming/archiving/restoring a department. */
export function invalidateDepartmentStatusCache(departmentId: string): void {
  departmentStatusCache.delete(departmentId)
}

function subjectDepartmentId(subject: Subject): string | null {
  if (subject.kind === 'department' || subject.kind === 'department_child') {
    return subject.departmentId
  }
  return null
}

export function registerAvailabilityGate(app: FastifyInstance): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const permission = req.routeOptions.config?.permission
    // No permission config yet means either a not-yet-matched route (the admin module's own
    // `setNotFoundHandler` runs its own `denyForSubject`, unaffected by this hook) or a boot-time
    // failure `authorizePlugin`'s `onRoute` guard already refuses -- nothing for this gate to add.
    if (!permission || 'public' in permission) return

    const subject = permission.subject(req)
    const departmentId = subjectDepartmentId(subject)
    const [maintenanceEnabled, departmentStatus] = await Promise.all([
      getMaintenanceEnabled(
        async () => (await app.devon.getInstanceSettings()).maintenance.enabled,
      ),
      departmentId ? getDepartmentStatusCached(departmentId) : Promise.resolve(null),
    ])

    const decision = decideAvailability({
      maintenanceEnabled,
      actorRole: req.actor?.role ?? null,
      exempt: isMaintenanceExempt(req),
      action: permission.action,
      departmentStatus,
    })
    if (decision.allow) return
    sendProblem(reply, decision.problem === 'maintenance' ? 'maintenance' : 'forbidden')
  })
}
