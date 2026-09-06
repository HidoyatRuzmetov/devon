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
  | { kind: 'department'; departmentId: string }
  | { kind: 'department_child'; departmentId: string } // memberships, and every future dept table
  | { kind: 'personal'; ownerUserId: string } // I-1: owner only, never head, never view-as
  | { kind: 'own_account'; userId: string }
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
