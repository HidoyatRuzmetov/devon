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
  'GET /api/v1/telegram/departments/:departmentId/setup-checklist',
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
  // v1.1 SPEC §5 -- custom fields. Defining a column on the people table, reordering it, archiving it
  // and asking the whole boshqarma to fill it in are management acts; reading the definitions and
  // writing an answer are not, and are deliberately absent from this list.
  'POST /api/v1/fields/defs',
  'PATCH /api/v1/fields/defs/:id',
  'POST /api/v1/fields/defs/reorder',
  'POST /api/v1/fields/defs/:id/archive',
  'POST /api/v1/fields/defs/:id/restore',
  'POST /api/v1/fields/defs/:id/notify',
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
