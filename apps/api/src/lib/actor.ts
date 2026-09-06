// Builds a `@devon/contracts` `Actor` from an authenticated user row. EPIC-000 shipped no
// `app.memberships` rows, so this used to hard-code `memberships: []` -- accurate then, but
// departments and memberships exist from EPIC-000.5's migrations onward, and EPIC-003 (structure)
// needs `can()`'s `department_child` check to actually see them (`packages/contracts/src/
// permissions.ts`'s decision is entirely a function of `Actor.memberships`, in-memory, resolved once
// per request here -- there is no other seam). `memberships` is now real, fetched by
// `plugins/session.ts` through `app.devon.listActiveMembershipsForUser` (never a direct `@devon/db`
// call from here, same seam every other route goes through) and passed in. EPIC-002 (accounts/
// departments) still owns surfacing this to the *client* via `/me` (`modules/me/index.ts`'s own
// `Deps.listMembershipsForUser` call is that module's own, separate lookup, left untouched here) --
// this fix is only about what the server's own permission checks see.
import type { Actor, Membership } from '@devon/contracts'
import type { UserRecord } from '../types.js'

export function buildActor(user: UserRecord, memberships: readonly Membership[] = []): Actor {
  return {
    userId: user.id,
    role: user.role,
    memberships: [...memberships],
    // First membership, if any -- the same "no server-chosen active department yet" tradeoff
    // `apps/web/src/lib/session.ts`'s `useDepartment()` documents client-side. Nothing in this item's routes
    // reads `Actor.departmentId`; every one of them takes `departmentId` from the URL instead, so a
    // person in more than one department is never limited to whichever one happens to be first here.
    departmentId: memberships[0]?.departmentId ?? null,
    // I-8: no delegation-grant table exists yet, so no request can ever carry a verified grant.
    // `can()` ignores this field for its decision regardless (fail-closed) -- see permissions.ts.
    actingFor: null,
    // I-8a: no view-as endpoint exists yet either; always the real actor's own lens.
    viewAs: null,
  }
}
