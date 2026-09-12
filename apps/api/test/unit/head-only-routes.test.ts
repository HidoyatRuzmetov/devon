// v1.1 SPEC §2 / PERMISSIONS-AUDIT Step 1.4. `public-routes.test.ts` makes "this route needs no
// session" a visible diff; this file does the same for the other end of the matrix: "only the
// boshqarma boshlig'i may touch this".
//
// The two lists below are checked in. Moving a route onto `department_managed` (or letting one slip
// off it) fails here with the exact route in the diff, which is the whole point -- a permission
// change must never be an invisible consequence of an unrelated edit.
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './test-app.js'

/** Every route whose subject is `{kind:'department_managed'}` -- head-only for reads AND writes. */
const HEAD_ONLY_ROUTES: readonly string[] = [
  'DELETE /api/v1/departments/:departmentId/units/:unitId',
  'POST /api/v1/departments/:departmentId/units/:unitId/restore',
  'GET /api/v1/telegram/departments/:departmentId/groups',
  'DELETE /api/v1/pages/onboarding/templates/:id',
  'GET /api/v1/pages/onboarding/templates',
  'PATCH /api/v1/pages/onboarding/templates/:id',
  'POST /api/v1/pages/onboarding/templates',
  'GET /api/v1/departments/:id/join-requests',
  'POST /api/v1/departments/:id/join-requests/:userId/approve',
  'POST /api/v1/departments/:id/join-requests/:userId/reject',
  'POST /api/v1/departments/:id/join-requests/:userId/undo',
  'POST /api/v1/departments/:id/members/:userId/reset-password',
  'GET /api/v1/people/indicators',
  'GET /api/v1/people/indicators/registry',
  'POST /api/v1/labels',
  // v1.1 SPEC §7 (work-plus). The workload grid is head-only by decision (§2.2: "a member sees
  // their own load on Home and on their own person page. No leaderboard anywhere") -- a member's
  // own row comes from `GET /api/v1/work/workload/mine`, which is `department_child` and cannot be
  // widened to anybody else.
  'GET /api/v1/work/workload',
  'POST /api/v1/work/workload/move',
  // A11: a goal is management data -- what the department is being measured on, and by whom.
  'GET /api/v1/goals',
  'POST /api/v1/goals',
  'PATCH /api/v1/goals/:id',
  'DELETE /api/v1/goals/:id',
  // EPIC-017: a xodim never learns that a rule exists; they only see its effect.
  'GET /api/v1/automations',
  'POST /api/v1/automations',
  'PATCH /api/v1/automations/:id',
  'DELETE /api/v1/automations/:id',
  'GET /api/v1/automations/runs',
  'POST /api/v1/automations/pause-all',
]

/** Every route whose subject is `{kind:'authenticated'}` -- any signed-in session, said out loud
 * rather than dressed up as an owner check (D11). */
const AUTHENTICATED_ROUTES: readonly string[] = [
  'GET /api/v1/accounts/avatar/:userId/:uploadId/:size',
]

function routesOfKind(
  routes: readonly { method: string; url: string; subjectKind: string }[],
  kind: string,
): string[] {
  return routes
    .filter((r) => r.subjectKind === kind)
    .map((r) => `${r.method} ${r.url}`)
    .sort()
}

describe('the checked-in head-only route allow-list', () => {
  it('matches exactly the routes registered on {kind:"department_managed"}', async () => {
    const { app } = await buildTestApp()
    expect(routesOfKind(app.routePermissions, 'department_managed')).toEqual(
      [...HEAD_ONLY_ROUTES].sort(),
    )
    await app.close()
  })

  it('matches exactly the routes registered on {kind:"authenticated"}', async () => {
    const { app } = await buildTestApp()
    expect(routesOfKind(app.routePermissions, 'authenticated')).toEqual(
      [...AUTHENTICATED_ROUTES].sort(),
    )
    await app.close()
  })

  it('every authenticated route resolved to a real subject kind', async () => {
    const { app } = await buildTestApp()
    const unresolved = app.routePermissions.filter((r) => r.subjectKind === 'unknown')
    expect(unresolved).toEqual([])
    await app.close()
  })

  it('the personal workspace is owner-only on every one of its routes (I-1)', async () => {
    const { app } = await buildTestApp()
    const personalRoutes = app.routePermissions.filter((r) => r.url.startsWith('/api/v1/personal'))
    expect(personalRoutes.length).toBeGreaterThan(0)
    for (const route of personalRoutes) expect(route.subjectKind).toBe('personal')
    await app.close()
  })

  it('every /api/v1/admin route is instance-scoped (super admin only)', async () => {
    const { app } = await buildTestApp()
    const adminRoutes = app.routePermissions.filter((r) => r.url.startsWith('/api/v1/admin'))
    expect(adminRoutes.length).toBeGreaterThan(0)
    for (const route of adminRoutes) {
      expect(['instance', 'instance_exit_view_as']).toContain(route.subjectKind)
    }
    await app.close()
  })
})
