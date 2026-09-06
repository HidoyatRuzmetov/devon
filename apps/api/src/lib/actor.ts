// Builds a `@devon/contracts` `Actor` from an authenticated user row. EPIC-000 ships no
// `app.memberships` rows (departments arrive in EPIC-002), so `memberships` is always `[]` here --
// accurate, not a shortcut: nobody can be a member of a department that cannot yet be created.
import type { Actor } from '@devon/contracts'
import type { UserRecord } from '../types.js'

export function buildActor(user: UserRecord): Actor {
  return {
    userId: user.id,
    role: user.role,
    memberships: [],
    departmentId: null,
    // I-8: EPIC-000 ships no delegation-grant table, so no request can ever carry a verified grant.
    // `can()` ignores this field for its decision regardless (fail-closed) -- see permissions.ts.
    actingFor: null,
    // I-8a: no view-as endpoint exists yet either; always the real actor's own lens.
    viewAs: null,
  }
}
