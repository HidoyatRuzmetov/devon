// The single `can()` permission function (design.md §1.6, TECH-SPEC §3.3, I-1, I-6, I-7, I-8, I-8a,
// I-8b). Every route in `@devon/api` and every client-side hide in `@devon/web` reduces to this one
// function; nothing else in the codebase is allowed to hand-roll a permission check (I-7).
//
// Deliberately no import from `@devon/db` even though `Role` and the eventual field-tier maps mirror
// shapes that live there: the package graph is one-way, `contracts ← everything` (design.md §1.2), and
// this package carries no runtime dependency beyond zod (design.md §1.1). `@devon/db` independently
// defines the identical `Role` union in `packages/db/src/context.ts` for the same reason -- the two are
// structurally compatible by construction, not by import.

/** I-8b: exactly these three instance-wide roles. Unit roles (bo'lim boshlig'i etc.) are labels, never
 * permissions, and are never represented here. */
export type Role = 'super_admin' | 'head' | 'member'

export type Membership = {
  departmentId: string
  role: Exclude<Role, 'super_admin'>
}

export type Actor = {
  userId: string
  /** Instance-wide role. Never itself swapped by `actingFor` -- see the field below. */
  role: Role
  memberships: readonly Membership[]
  /** Active department context for this request, if any. Distinct from `viewAs`, which is the
   * super admin's audited, read-only cross-department lens (I-8a). */
  departmentId: string | null
  /**
   * I-8. Populated ONLY from a verified, unexpired delegation row. EPIC-000 ships no grants table, so
   * no code path can ever produce a verified grant yet: `can()` ignores this field entirely for the
   * purpose of the decision (fail-closed) and always evaluates the request against the real `userId`/
   * `role` above. The audit log, not `can()`, is where both identities are ever recorded (I-8) --
   * `on_behalf_of` is written by `@devon/db`/`@devon/api`, never derived here.
   */
  actingFor: { userId: string; role: Role; grantId: string } | null
  /** I-8a: the super admin's read-only cross-department view. Makes every non-read action deny with
   * `read_only_view_as`, and is never an exception to the `personal` owner-only rule. */
  viewAs: { departmentId: string } | null
}

export type Action = 'read' | 'create' | 'update' | 'archive' | 'delete' | 'administer'

export type Subject =
  | { kind: 'instance' } // /api/v1/admin/* -> super_admin only
  // Blitz finding: `POST /api/v1/admin/view-as/stop` is the only way a super_admin ever clears
  // `viewAs` again once set. `{kind:'instance'}`'s P1 rule (this file, below) requires
  // `viewAs === null` for *every* instance action -- if the exit route used that same subject, a
  // super_admin who had entered view-as could never leave it again through the API (the cookie would
  // have to expire on its own). This kind is `super_admin`-only, exactly like `instance`, but is the
  // one deliberate exception that does not also require `viewAs === null` -- see `can()` below.
  | { kind: 'instance_exit_view_as' } // /api/v1/admin/view-as/stop only
  | { kind: 'department'; departmentId: string }
  | { kind: 'department_child'; departmentId: string } // memberships, and every future dept table
  // v1.1 SPEC §2.1 (PERMISSIONS-AUDIT D15): "a department-owned row that only the boshqarma
  // boshlig'i may see or touch". Before this kind existed, every such rule was hand-rolled inside a
  // module (structure and events did it; work, projects, pages, analytics, ai and telegram did not),
  // which is exactly the drift I-7 exists to prevent. Head-only for BOTH reads and writes -- that is
  // the difference from `department`, whose reads are open to every member.
  | { kind: 'department_managed'; departmentId: string }
  // v1.1 SPEC §2.1: a department-owned row whose *writes* belong to a named owner set (the card's
  // giver/assignee/creator, the project's owner, the event's organizer, the page's author) or to the
  // head. Reads behave exactly like `department_child` -- the department's board, wiki and calendar
  // stay transparent; only mutation narrows. `can()` never queries, so the route passes the real
  // owner ids it already loaded (I-7: the decision stays in one function).
  | { kind: 'owned'; departmentId: string; ownerUserIds: readonly string[] }
  | { kind: 'personal'; ownerUserId: string } // I-1: owner only, never head, never view-as
  | { kind: 'own_account'; userId: string }
  // PERMISSIONS-AUDIT D11: "any signed-in person may read this", said out loud. The avatar-bytes
  // route used `{kind:'own_account', userId: <the requester's own id>}`, which is a tautology that
  // reads like an owner check and is not one. Team avatars are deliberately visible to every
  // colleague; this kind is how a route says so without lying about what it checks.
  | { kind: 'authenticated' }
  | { kind: 'audit' }
  | { kind: 'public' } // /healthz, /readyz, login, setup

export type DenyReason =
  | 'not_authenticated'
  | 'not_super_admin'
  | 'not_a_member'
  | 'not_head'
  | 'not_owner'
  | 'read_only_view_as'
  | 'department_paused'
  | 'maintenance'

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason }

const ALLOW: Decision = { allowed: true }

function deny(reason: DenyReason): Decision {
  return { allowed: false, reason }
}

function findMembership(actor: Actor, departmentId: string): Membership | undefined {
  return actor.memberships.find((m) => m.departmentId === departmentId)
}

/**
 * The single permission check (design.md §1.6). Rules encoded, one assertion per rule in
 * `test/unit/permissions.test.ts`:
 *
 * - P1 `{kind:'instance'}` -> allowed iff `actor.role === 'super_admin'` and `viewAs === null`.
 * - P2 `{kind:'personal'}` -> allowed iff `subject.ownerUserId === actor.userId`. No `super_admin`
 *   exception, no `viewAs` exception, ever (I-1).
 * - P3 `{kind:'department'|'department_child'}` -> allowed iff an active membership matches
 *   `departmentId`; `update`/`delete` on `{kind:'department'}` additionally require that
 *   membership's `role === 'head'`. A `super_admin` with no matching membership may only `read`,
 *   and only through a matching `viewAs`.
 * - P4 Under `viewAs`, every non-`read` action on `instance`/`department`/`department_child` denies
 *   with `read_only_view_as`.
 * - P7 `actingFor` is honoured only from a verified grant row; since none exist in this epic, any
 *   client-supplied value is ignored and the decision is always made against the real actor.
 * - P8 (v1.1) `{kind:'department_managed'}` -> allowed iff the matching membership's
 *   `role === 'head'`, for every action including `read`. A `super_admin` with a matching `viewAs`
 *   may `read` only.
 * - P9 (v1.1) `{kind:'owned'}` -> `read` behaves exactly like `department_child`; every other action
 *   requires `role === 'head'` on the matching membership, or `actor.userId` inside
 *   `subject.ownerUserIds`.
 * - P10 (v1.1) `{kind:'authenticated'}` -> any non-null actor.
 */
export function can(actor: Actor | null, action: Action, subject: Subject): Decision {
  // Public routes (health checks, login, setup) never require a session, and never depend on the
  // rest of this function's actor-shaped logic.
  if (subject.kind === 'public') return ALLOW

  if (actor === null) return deny('not_authenticated')

  switch (subject.kind) {
    case 'instance': {
      if (actor.role !== 'super_admin') return deny('not_super_admin')
      if (actor.viewAs !== null) return deny('read_only_view_as')
      return ALLOW
    }

    // Blitz finding: the escape hatch out of view-as. Same role check as `instance`, deliberately
    // without its `viewAs === null` requirement -- otherwise this route could never be reached once
    // `viewAs` was set, and view-as would be a one-way door for the rest of the cookie's lifetime.
    case 'instance_exit_view_as': {
      if (actor.role !== 'super_admin') return deny('not_super_admin')
      return ALLOW
    }

    case 'audit': {
      // No route consumes `{kind:'audit'}` in this epic (admin/audit/verify uses `{kind:'instance'}`,
      // per design.md §3.4). Reserved for a later epic's per-department audit view; kept fail-closed
      // in the meantime with the same shape as `instance`.
      if (actor.role !== 'super_admin') return deny('not_super_admin')
      if (actor.viewAs !== null) return deny('read_only_view_as')
      return ALLOW
    }

    case 'personal': {
      // I-1: owner only. `actor.role` and `actor.viewAs` are never consulted here -- there is no
      // exception, ever, for anyone other than the owner themselves.
      if (subject.ownerUserId !== actor.userId) return deny('not_owner')
      return ALLOW
    }

    case 'own_account': {
      if (subject.userId !== actor.userId) return deny('not_owner')
      return ALLOW
    }

    // D11: every authenticated session passes. Deliberately not `department_child` -- the resource
    // (an avatar's bytes) is legitimately readable by a colleague in any shared department, and
    // pretending otherwise would either break the board or require a per-request department lookup
    // for a 64x64 PNG.
    case 'authenticated':
      return ALLOW

    // v1.1 SPEC §2.1. Head-only row, reads included.
    case 'department_managed': {
      const managedMembership = findMembership(actor, subject.departmentId)
      if (managedMembership) {
        if (managedMembership.role !== 'head') return deny('not_head')
        return ALLOW
      }
      if (actor.role === 'super_admin' && actor.viewAs?.departmentId === subject.departmentId) {
        if (action === 'read') return ALLOW
        return deny('read_only_view_as')
      }
      return deny('not_a_member')
    }

    // v1.1 SPEC §2.1. Read like `department_child`; write for the owner set or the head.
    case 'owned': {
      const ownedMembership = findMembership(actor, subject.departmentId)
      if (ownedMembership) {
        if (action === 'read') return ALLOW
        if (ownedMembership.role === 'head') return ALLOW
        if (subject.ownerUserIds.includes(actor.userId)) return ALLOW
        return deny('not_owner')
      }
      if (actor.role === 'super_admin' && actor.viewAs?.departmentId === subject.departmentId) {
        if (action === 'read') return ALLOW
        return deny('read_only_view_as')
      }
      return deny('not_a_member')
    }

    case 'department':
    case 'department_child': {
      const membership = findMembership(actor, subject.departmentId)
      if (membership) {
        if (
          subject.kind === 'department' &&
          (action === 'update' || action === 'delete') &&
          membership.role !== 'head'
        ) {
          return deny('not_head')
        }
        return ALLOW
      }

      if (actor.role === 'super_admin' && actor.viewAs?.departmentId === subject.departmentId) {
        if (action === 'read') return ALLOW
        return deny('read_only_view_as')
      }

      return deny('not_a_member')
    }
  }
}
