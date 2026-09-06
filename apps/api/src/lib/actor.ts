// Builds a `@devon/contracts` `Actor` from an authenticated user row plus that user's active
// memberships. EPIC-002 ships no department switcher endpoint yet, so `departmentId` (the request's
// active department) defaults to the first membership -- `plugins/session.ts` fetches memberships in
// `joined_at` order for exactly this reason, mirroring the client's own fallback
// (`apps/web/src/lib/session.ts`'s `useDepartment()`: "the user's first membership").
import type { Actor, Membership } from '@devon/contracts'
import type { MembershipRecord, UserRecord } from '../types.js'

export function buildActor(user: UserRecord, memberships: readonly MembershipRecord[]): Actor {
  const contractMemberships: Membership[] = memberships.map((m) => ({
    departmentId: m.departmentId,
    role: m.role,
  }))

  return {
    userId: user.id,
    role: user.role,
    memberships: contractMemberships,
    departmentId: contractMemberships[0]?.departmentId ?? null,
    // I-8: EPIC-000 ships no delegation-grant table, so no request can ever carry a verified grant.
    // `can()` ignores this field for its decision regardless (fail-closed) -- see permissions.ts.
    actingFor: null,
    // I-8a: no view-as endpoint exists yet either; always the real actor's own lens.
    viewAs: null,
  }
}
