// Builds a `@devon/contracts` `Actor` from an authenticated user row. EPIC-002 populates `memberships`
// for real (EPIC-000 shipped no `app.memberships` rows, so it was always `[]` -- see this file's
// former revision) via `Deps.listMembershipsForUser`, the same call `GET /me` uses.
import type { Actor } from '@devon/contracts'
import type { Deps } from '../deps.js'
import type { UserRecord } from '../types.js'

export async function buildActor(deps: Deps, user: UserRecord): Promise<Actor> {
  const memberships = await deps.listMembershipsForUser(user.id)
  return {
    userId: user.id,
    role: user.role,
    memberships: memberships.map((m) => ({ departmentId: m.departmentId, role: m.role })),
    // No "which department is this request acting for" endpoint exists yet (MODULE-GUIDE.md "Web
    // features": the switcher is a client-only stub until one does) -- `can()`'s department checks
    // (`packages/contracts/src/permissions.ts`) read `actor.memberships` directly and never consult
    // this field, so leaving it `null` here costs nothing today.
    departmentId: null,
    // I-8: no delegation-grant table exists yet. `can()` ignores this field for its decision
    // regardless (fail-closed) -- see permissions.ts.
    actingFor: null,
    // I-8a: no view-as endpoint exists yet either; always the real actor's own lens.
    viewAs: null,
  }
}
