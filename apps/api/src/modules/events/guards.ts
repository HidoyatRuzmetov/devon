// v1.1 critique SEV2 #10 -- the events module's half of I-7 ("nothing else in the codebase is
// allowed to hand-roll a permission check").
//
// Every event route declared `{kind:'department_child'}`, for which `can()`'s P3 rule grants any
// active member every action -- `delete` included. The real protection lived in `service.ts` as
// three copies of `if (x.organizer_user_id !== actor.userId && !actor.isHead) throw`, plus a dozen
// `canManage: row.organizer_user_id === viewerUserId || isHead` expressions scattered through the
// DTO builders. The outcome was correct, which is exactly what made it dangerous: it is the same
// pattern that made the fields leak in SEV1 #1 a live leak, in the busiest module in the product,
// and one bad refactor of that guard would have opened event deletion with no test failing.
//
// So: every ownership question in this module now goes through `can()` with `{kind:'owned'}`, the
// subject kind SPEC §2.1 defines for exactly this ("the object's owner set **or** the head"), and
// `role === 'head'` appears nowhere in the module again.
//
// **Why the route config still says `department_child` for a mutation.** An event's organizer, a
// comment's author and a photo's owner are rows: a `subject(req)` function is synchronous and cannot
// read them. Declaring `{kind:'owned', ownerUserIds: []}` at the route would deny every organizer
// who is not the head, and declaring `ownerUserIds: [actor.userId]` would be the tautology D11 calls
// out by name. So the split is the one `apps/api/src/modules/work/index.ts` already documents and
// MODULE-GUIDE.md states as the contract: the route proves *membership*, and the per-object owner
// decision is made here, by the same `can()`, once the row is loaded. `events.matrix.test.ts` walks
// every cell of that decision.
import { can, type Actor as PermissionActor } from '@devon/contracts'
import { EventForbiddenError } from './errors.js'

/**
 * Who is asking, and about which department. `principal` is the real `req.actor` -- the same object
 * the route-level check ran against -- so the two halves of the decision can never disagree about
 * who the caller is.
 *
 * `givenName`/`familyName` are carried for the notification text builders, not for any decision.
 */
export type Actor = {
  userId: string
  departmentId: string
  principal: PermissionActor | null
  givenName: string
  familyName: string
}

/**
 * "May this person change an object owned by `ownerUserIds`?" -- the organizer of an event, the
 * author of a comment, the driver of a carpool, the uploader of a photo, the creator of a poll.
 *
 * Owner or head, decided by `can()`. Nothing in this module re-implements that sentence.
 */
export function mayManage(actor: Actor, ownerUserIds: readonly (string | null)[]): boolean {
  const owners = ownerUserIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return can(actor.principal, 'update', {
    kind: 'owned',
    departmentId: actor.departmentId,
    ownerUserIds: owners,
  }).allowed
}

/** The same decision, raised as this module's own forbidden error. */
export function assertManage(actor: Actor, ownerUserIds: readonly (string | null)[]): void {
  if (!mayManage(actor, ownerUserIds)) throw new EventForbiddenError()
}

/**
 * `canManage` for a DTO that is *read* by somebody who is not the actor of a write -- the list
 * endpoints compute it per row for a known viewer. Same rule, expressed against a plain viewer id
 * plus the head fact the caller already resolved through `isHeadOf`, because the list builders do
 * not carry a full `Actor`.
 *
 * Deliberately the one place a boolean `isHead` is still accepted: it is produced by
 * `lib/actor.ts`'s `isHeadOf` (the single source of the per-department role, I-8b), never by a
 * `role === 'head'` comparison inside this module.
 */
export function viewerCanManage(
  ownerUserId: string | null,
  viewerUserId: string,
  isHead: boolean,
): boolean {
  return isHead || (ownerUserId !== null && ownerUserId === viewerUserId)
}
