// Builds a `@devon/contracts` `Actor` from an authenticated user row plus that user's active
// memberships. EPIC-000 shipped no `app.memberships` rows, so this used to hard-code
// `memberships: []` -- accurate then, but departments and memberships exist from EPIC-000.5's
// migrations onward, and `can()`'s `department_child` check (`packages/contracts/src/permissions.ts`,
// entirely a function of `Actor.memberships`, in-memory, resolved once per request here -- there is no
// other seam) needs to actually see them. `memberships` is now real, fetched by `plugins/session.ts`
// through `app.devon.listActiveMembershipsForUser` (never a direct `@devon/db` call from here, same
// seam every other route goes through) and passed in, `joined_at`-ordered so `departmentId` below (the
// request's active department -- no switcher endpoint exists yet) defaults to a stable "first
// membership", mirroring the client's own fallback (`apps/web/src/lib/session.ts`'s `useDepartment()`).
// `GET /me` (`modules/me/index.ts`) reads the same `listActiveMembershipsForUser` call for its own
// response, rather than a second, separate lookup.
import type { Actor, Membership } from '@devon/contracts'
import type { MembershipRecord, UserRecord } from '../types.js'

export function buildActor(user: UserRecord, memberships: readonly MembershipRecord[] = []): Actor {
  const contractMemberships: Membership[] = memberships.map((m) => ({
    departmentId: m.departmentId,
    role: m.role,
  }))

  return {
    userId: user.id,
    role: user.role,
    memberships: contractMemberships,
    // First membership, if any -- the same "no server-chosen active department yet" tradeoff
    // `useDepartment()` documents client-side. Nothing in this item's routes reads `Actor.departmentId`;
    // every one of them takes `departmentId` from the URL instead, so a person in more than one
    // department is never limited to whichever one happens to be first here.
    departmentId: contractMemberships[0]?.departmentId ?? null,
    // I-8: no delegation-grant table exists yet. `can()` ignores this field for its decision
    // regardless (fail-closed) -- see permissions.ts.
    actingFor: null,
    // I-8a: no view-as endpoint exists yet either; always the real actor's own lens.
    viewAs: null,
  }
}
