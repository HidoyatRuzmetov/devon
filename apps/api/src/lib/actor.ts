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

export function buildActor(
  user: UserRecord,
  memberships: readonly MembershipRecord[] = [],
  /** v1.1 SPEC §2.3: the department named by the signed `devon_dept` cookie, already verified by
   * `plugins/session.ts`. Honoured only when it is one of this user's own active memberships --
   * anything else falls back to the first membership, exactly as before. */
  requestedDepartmentId: string | null = null,
): Actor {
  const contractMemberships: Membership[] = memberships.map((m) => ({
    departmentId: m.departmentId,
    role: m.role,
  }))

  const requested =
    requestedDepartmentId !== null &&
    contractMemberships.some((m) => m.departmentId === requestedDepartmentId)
      ? requestedDepartmentId
      : null

  return {
    userId: user.id,
    role: user.role,
    memberships: contractMemberships,
    // First membership, if any -- the same "no server-chosen active department yet" tradeoff
    // `useDepartment()` documents client-side. Nothing in this item's routes reads `Actor.departmentId`;
    // every one of them takes `departmentId` from the URL instead, so a person in more than one
    // department is never limited to whichever one happens to be first here.
    departmentId: requested ?? contractMemberships[0]?.departmentId ?? null,
    // I-8: no delegation-grant table exists yet. `can()` ignores this field for its decision
    // regardless (fail-closed) -- see permissions.ts.
    actingFor: null,
    // I-8a: `plugins/session.ts` overwrites this for a super admin carrying a verified view-as
    // cookie; every other session's lens is their own. (The "no view-as endpoint exists yet" comment
    // this line used to carry was stale -- EPIC-013 shipped one.)
    viewAs: null,
  }
}

/** The actor's role **inside one department** -- never `Actor.role`, which is the instance-wide role
 * and is only ever `'member'` or `'super_admin'` (I-8b). Every "is this the boshqarma boshlig'i?"
 * question in the API resolves here, so there is exactly one answer to it.
 *
 * PERMISSIONS-AUDIT Step 4 asked for this: `modules/events/index.ts` had grown its own copy, and the
 * modules that had not grown one simply had no head distinction at all. */
export function departmentRoleOf(
  actor: Actor | null,
  departmentId: string | null,
): 'head' | 'member' | null {
  if (!actor || !departmentId) return null
  return actor.memberships.find((m) => m.departmentId === departmentId)?.role ?? null
}

export function isHeadOf(actor: Actor | null, departmentId: string | null): boolean {
  return departmentRoleOf(actor, departmentId) === 'head'
}

/** The role a `@devon/db` `RequestContext` should carry for RLS (`app.department_role`). A super
 * admin under a matching view-as reads as a head for the purpose of *reading* -- every write policy
 * additionally requires `not app.is_view_as()`, so this cannot widen anything (I-8a). */
export function contextDepartmentRole(
  actor: Actor | null,
  departmentId: string | null,
): 'head' | 'member' | null {
  const role = departmentRoleOf(actor, departmentId)
  if (role) return role
  if (actor?.role === 'super_admin' && actor.viewAs?.departmentId === departmentId) return 'head'
  return null
}
