import { describe, expect, it } from 'vitest'
import { can, type Actor } from '../../src/permissions.js'

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u-self',
    role: 'member',
    memberships: [],
    departmentId: null,
    actingFor: null,
    viewAs: null,
    ...overrides,
  }
}

describe('can() -- not authenticated', () => {
  it('denies any non-public subject when actor is null', () => {
    expect(can(null, 'read', { kind: 'own_account', userId: 'u-1' })).toEqual({
      allowed: false,
      reason: 'not_authenticated',
    })
  })

  it('allows a public subject even when actor is null (health checks, login, setup)', () => {
    expect(can(null, 'read', { kind: 'public' })).toEqual({ allowed: true })
  })
})

describe('can() -- P1: instance is super_admin && !viewAs only', () => {
  it('allows a super_admin with no viewAs', () => {
    const a = actor({ role: 'super_admin', viewAs: null })
    expect(can(a, 'administer', { kind: 'instance' })).toEqual({ allowed: true })
  })

  it('denies a head', () => {
    const a = actor({ role: 'head' })
    expect(can(a, 'administer', { kind: 'instance' })).toEqual({
      allowed: false,
      reason: 'not_super_admin',
    })
  })

  it('denies a member', () => {
    const a = actor({ role: 'member' })
    expect(can(a, 'administer', { kind: 'instance' })).toEqual({
      allowed: false,
      reason: 'not_super_admin',
    })
  })

  it('denies a super_admin who is currently viewing-as a department, even for read', () => {
    const a = actor({ role: 'super_admin', viewAs: { departmentId: 'd-1' } })
    expect(can(a, 'read', { kind: 'instance' })).toEqual({
      allowed: false,
      reason: 'read_only_view_as',
    })
  })
})

// Blitz finding: without this escape hatch, `instance`'s `viewAs === null` requirement (P1 above)
// made `POST /api/v1/admin/view-as/stop` unreachable once a super_admin had entered view-as -- that
// route used `{kind:'instance'}` too, so it denied itself with `read_only_view_as` forever.
describe('can() -- instance_exit_view_as: super_admin only, but never blocked by viewAs itself', () => {
  it('allows a super_admin who is currently viewing-as a department to exit it', () => {
    const a = actor({ role: 'super_admin', viewAs: { departmentId: 'd-1' } })
    expect(can(a, 'administer', { kind: 'instance_exit_view_as' })).toEqual({ allowed: true })
  })

  it('allows a super_admin with no viewAs (idempotent stop)', () => {
    const a = actor({ role: 'super_admin', viewAs: null })
    expect(can(a, 'administer', { kind: 'instance_exit_view_as' })).toEqual({ allowed: true })
  })

  it('denies a head', () => {
    const a = actor({ role: 'head' })
    expect(can(a, 'administer', { kind: 'instance_exit_view_as' })).toEqual({
      allowed: false,
      reason: 'not_super_admin',
    })
  })

  it('denies a member', () => {
    const a = actor({ role: 'member' })
    expect(can(a, 'administer', { kind: 'instance_exit_view_as' })).toEqual({
      allowed: false,
      reason: 'not_super_admin',
    })
  })
})

describe('can() -- P2: personal is owner-only, no exceptions ever', () => {
  it('allows the owner', () => {
    const a = actor({ userId: 'u-1' })
    expect(can(a, 'read', { kind: 'personal', ownerUserId: 'u-1' })).toEqual({ allowed: true })
  })

  it('denies a super_admin who is not the owner -- no super_admin exception', () => {
    const a = actor({ userId: 'u-admin', role: 'super_admin' })
    expect(can(a, 'read', { kind: 'personal', ownerUserId: 'u-1' })).toEqual({
      allowed: false,
      reason: 'not_owner',
    })
  })

  it("denies a head of the owner's department -- no head exception", () => {
    const a = actor({
      userId: 'u-head',
      memberships: [{ departmentId: 'd-1', role: 'head' }],
    })
    expect(can(a, 'read', { kind: 'personal', ownerUserId: 'u-1' })).toEqual({
      allowed: false,
      reason: 'not_owner',
    })
  })

  it("denies a super_admin viewing-as the owner's department -- no view-as exception", () => {
    const a = actor({
      userId: 'u-admin',
      role: 'super_admin',
      viewAs: { departmentId: 'd-1' },
    })
    expect(can(a, 'read', { kind: 'personal', ownerUserId: 'u-1' })).toEqual({
      allowed: false,
      reason: 'not_owner',
    })
  })

  it('still allows the owner to read/write their own personal subject while super_admin viewAs is active on an unrelated department', () => {
    const a = actor({
      userId: 'u-admin',
      role: 'super_admin',
      viewAs: { departmentId: 'd-9' },
    })
    expect(can(a, 'update', { kind: 'personal', ownerUserId: 'u-admin' })).toEqual({
      allowed: true,
    })
  })
})

describe('can() -- own_account mirrors owner-only', () => {
  it('allows the account holder', () => {
    const a = actor({ userId: 'u-1' })
    expect(can(a, 'update', { kind: 'own_account', userId: 'u-1' })).toEqual({ allowed: true })
  })

  it('denies anyone else', () => {
    const a = actor({ userId: 'u-2' })
    expect(can(a, 'update', { kind: 'own_account', userId: 'u-1' })).toEqual({
      allowed: false,
      reason: 'not_owner',
    })
  })
})

describe('can() -- P3: department/department_child needs active membership', () => {
  it('allows a member to read their own department', () => {
    const a = actor({ memberships: [{ departmentId: 'd-1', role: 'member' }] })
    expect(can(a, 'read', { kind: 'department', departmentId: 'd-1' })).toEqual({ allowed: true })
  })

  it('denies read of a department the actor does not belong to', () => {
    const a = actor({ memberships: [{ departmentId: 'd-1', role: 'member' }] })
    expect(can(a, 'read', { kind: 'department', departmentId: 'd-2' })).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })

  it('allows a head to update their own department', () => {
    const a = actor({ memberships: [{ departmentId: 'd-1', role: 'head' }] })
    expect(can(a, 'update', { kind: 'department', departmentId: 'd-1' })).toEqual({
      allowed: true,
    })
  })

  it('denies a plain member updating the department itself', () => {
    const a = actor({ memberships: [{ departmentId: 'd-1', role: 'member' }] })
    expect(can(a, 'update', { kind: 'department', departmentId: 'd-1' })).toEqual({
      allowed: false,
      reason: 'not_head',
    })
  })

  it('denies a plain member deleting the department itself', () => {
    const a = actor({ memberships: [{ departmentId: 'd-1', role: 'member' }] })
    expect(can(a, 'delete', { kind: 'department', departmentId: 'd-1' })).toEqual({
      allowed: false,
      reason: 'not_head',
    })
  })

  it('allows a plain member to update a department_child row -- no head requirement there', () => {
    const a = actor({ memberships: [{ departmentId: 'd-1', role: 'member' }] })
    expect(can(a, 'update', { kind: 'department_child', departmentId: 'd-1' })).toEqual({
      allowed: true,
    })
  })
})

describe('can() -- P4: viewAs denies every non-read action with read_only_view_as', () => {
  it('allows a super_admin to read a department only through a matching viewAs', () => {
    const a = actor({ role: 'super_admin', viewAs: { departmentId: 'd-1' } })
    expect(can(a, 'read', { kind: 'department', departmentId: 'd-1' })).toEqual({
      allowed: true,
    })
  })

  it('denies a super_admin write under a matching viewAs', () => {
    const a = actor({ role: 'super_admin', viewAs: { departmentId: 'd-1' } })
    expect(can(a, 'update', { kind: 'department', departmentId: 'd-1' })).toEqual({
      allowed: false,
      reason: 'read_only_view_as',
    })
  })

  it('denies a super_admin create under a matching viewAs on a department_child subject', () => {
    const a = actor({ role: 'super_admin', viewAs: { departmentId: 'd-1' } })
    expect(can(a, 'create', { kind: 'department_child', departmentId: 'd-1' })).toEqual({
      allowed: false,
      reason: 'read_only_view_as',
    })
  })

  it('denies a super_admin with no membership and a non-matching viewAs -- not_a_member, not read_only_view_as', () => {
    const a = actor({ role: 'super_admin', viewAs: { departmentId: 'd-2' } })
    expect(can(a, 'read', { kind: 'department', departmentId: 'd-1' })).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })
})

describe('can() -- P7: actingFor requires a verified grantId; none exist, so any client value is ignored', () => {
  it('a forged actingFor identity never substitutes for the real actor on own_account', () => {
    const a = actor({
      userId: 'u-real',
      actingFor: { userId: 'u-other', role: 'head', grantId: 'forged-grant' },
    })
    // The subject names the *actingFor* identity's account -- if `can()` honoured the forged value,
    // this would incorrectly allow. It must be evaluated against the real actor and deny.
    expect(can(a, 'update', { kind: 'own_account', userId: 'u-other' })).toEqual({
      allowed: false,
      reason: 'not_owner',
    })
  })

  it('a forged actingFor identity does not block the real actor acting on their own account', () => {
    const a = actor({
      userId: 'u-real',
      actingFor: { userId: 'u-other', role: 'head', grantId: 'forged-grant' },
    })
    expect(can(a, 'update', { kind: 'own_account', userId: 'u-real' })).toEqual({ allowed: true })
  })

  it('a forged actingFor identity does not grant department head power the real actor lacks', () => {
    const a = actor({
      userId: 'u-real',
      role: 'member',
      memberships: [{ departmentId: 'd-1', role: 'member' }],
      actingFor: { userId: 'u-other', role: 'head', grantId: 'forged-grant' },
    })
    expect(can(a, 'update', { kind: 'department', departmentId: 'd-1' })).toEqual({
      allowed: false,
      reason: 'not_head',
    })
  })
})

// ---------------------------------------------------------------------------------------------
// H1.16: the privilege-escalation ladder, tested negatively at every rung, and H1.2's object-level
// half at the `can()` layer -- the same request with a *different department id* substituted must
// deny. (The database half of H1.2 -- an id from another department being invisible even to a
// correct query -- is `packages/db/test/integration/rls.isolation.test.ts`, which the `migrate`
// gate runs; these are the two independent layers the item asks for.)
// ---------------------------------------------------------------------------------------------

describe('privilege-escalation ladder (H1.16)', () => {
  const memberOfA = actor({
    userId: 'u-member',
    role: 'member',
    memberships: [{ departmentId: 'd-a', role: 'member' }],
    departmentId: 'd-a',
  })
  const headOfA = actor({
    userId: 'u-head',
    role: 'head',
    memberships: [{ departmentId: 'd-a', role: 'head' }],
    departmentId: 'd-a',
  })
  const superAdmin = actor({ userId: 'u-root', role: 'super_admin' })

  it('rung 1 -- member cannot take a head-only action in their own department', () => {
    for (const action of ['update', 'delete'] as const) {
      expect(can(memberOfA, action, { kind: 'department', departmentId: 'd-a' })).toEqual({
        allowed: false,
        reason: 'not_head',
      })
    }
  })

  it('rung 2 -- head cannot take an instance (super admin) action', () => {
    for (const action of ['read', 'create', 'update', 'delete', 'administer'] as const) {
      expect(can(headOfA, action, { kind: 'instance' })).toEqual({
        allowed: false,
        reason: 'not_super_admin',
      })
    }
  })

  it('rung 2b -- member cannot take an instance action either', () => {
    expect(can(memberOfA, 'administer', { kind: 'instance' })).toEqual({
      allowed: false,
      reason: 'not_super_admin',
    })
  })

  it('rung 3 -- an instance-wide role claim never substitutes for a membership', () => {
    // A `super_admin` with no membership in `d-a` cannot write to it; the top of the ladder is not
    // a shortcut into a department's data (I-8a: the only cross-department lens is read-only).
    expect(can(superAdmin, 'update', { kind: 'department_child', departmentId: 'd-a' })).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })

  it('rung 4 -- nobody reaches another user’s personal workspace, at any rung', () => {
    for (const a of [memberOfA, headOfA, superAdmin]) {
      expect(can(a, 'read', { kind: 'personal', ownerUserId: 'someone-else' })).toEqual({
        allowed: false,
        reason: 'not_owner',
      })
    }
  })
})

describe('object-level access: the same request with another department’s id (H1.2)', () => {
  const headOfA = actor({
    userId: 'u-head',
    role: 'head',
    memberships: [{ departmentId: 'd-a', role: 'head' }],
    departmentId: 'd-a',
  })

  it('every action a head may take in d-a is denied when the id is swapped to d-b', () => {
    for (const action of ['read', 'create', 'update', 'archive', 'delete'] as const) {
      for (const kind of ['department', 'department_child'] as const) {
        expect(can(headOfA, action, { kind, departmentId: 'd-a' }).allowed).toBe(true)
        expect(can(headOfA, action, { kind, departmentId: 'd-b' })).toEqual({
          allowed: false,
          reason: 'not_a_member',
        })
      }
    }
  })

  it('a super admin’s view-as lens does not transfer to a different department id', () => {
    const viewer = actor({
      userId: 'u-root',
      role: 'super_admin',
      departmentId: 'd-a',
      viewAs: { departmentId: 'd-a' },
    })
    expect(can(viewer, 'read', { kind: 'department', departmentId: 'd-a' }).allowed).toBe(true)
    expect(can(viewer, 'read', { kind: 'department', departmentId: 'd-b' })).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })

  it('a membership in a *removed* state is not in `memberships` and therefore never matches', () => {
    // `plugins/session.ts` builds `Actor.memberships` from `listActiveMembershipsForUser`, so a
    // removed member's id simply is not there -- asserted here so a future change that starts
    // passing inactive rows into `Actor` fails this test rather than silently re-granting access.
    const removed = actor({ userId: 'u-ex', role: 'member', memberships: [], departmentId: 'd-a' })
    expect(can(removed, 'read', { kind: 'department', departmentId: 'd-a' })).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })
})

// --- v1.1 (SPEC §2.1, PERMISSIONS-AUDIT D15) -----------------------------------------------------

describe("can() -- P8: department_managed is the head's own row, reads included", () => {
  const headActor = actor({
    userId: 'u-head',
    memberships: [{ departmentId: 'd-a', role: 'head' }],
    departmentId: 'd-a',
  })
  const memberActor = actor({
    userId: 'u-mem',
    memberships: [{ departmentId: 'd-a', role: 'member' }],
    departmentId: 'd-a',
  })

  it('allows the head for every action', () => {
    for (const action of ['read', 'create', 'update', 'archive', 'delete'] as const) {
      expect(can(headActor, action, { kind: 'department_managed', departmentId: 'd-a' })).toEqual({
        allowed: true,
      })
    }
  })

  it('denies a member even a read -- this is the difference from `department`', () => {
    expect(can(memberActor, 'read', { kind: 'department_managed', departmentId: 'd-a' })).toEqual({
      allowed: false,
      reason: 'not_head',
    })
  })

  it('denies a non-member with not_a_member, not not_head', () => {
    const outsider = actor({ memberships: [{ departmentId: 'd-b', role: 'head' }] })
    expect(can(outsider, 'read', { kind: 'department_managed', departmentId: 'd-a' })).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })

  it('lets a super admin read under a matching view-as, and never write', () => {
    const viewer = actor({
      role: 'super_admin',
      memberships: [],
      viewAs: { departmentId: 'd-a' },
    })
    expect(can(viewer, 'read', { kind: 'department_managed', departmentId: 'd-a' })).toEqual({
      allowed: true,
    })
    expect(can(viewer, 'update', { kind: 'department_managed', departmentId: 'd-a' })).toEqual({
      allowed: false,
      reason: 'read_only_view_as',
    })
    expect(can(viewer, 'read', { kind: 'department_managed', departmentId: 'd-b' })).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })
})

describe('can() -- P9: owned reads like department_child and writes like an owner set', () => {
  const owner = actor({
    userId: 'u-owner',
    memberships: [{ departmentId: 'd-a', role: 'member' }],
    departmentId: 'd-a',
  })
  const bystander = actor({
    userId: 'u-bystander',
    memberships: [{ departmentId: 'd-a', role: 'member' }],
    departmentId: 'd-a',
  })
  const headActor = actor({
    userId: 'u-head',
    memberships: [{ departmentId: 'd-a', role: 'head' }],
    departmentId: 'd-a',
  })
  const subject = {
    kind: 'owned' as const,
    departmentId: 'd-a',
    ownerUserIds: ['u-owner', 'u-giver'],
  }

  it('any member of the department may read', () => {
    expect(can(bystander, 'read', subject)).toEqual({ allowed: true })
  })

  it('an owner may write', () => {
    for (const action of ['create', 'update', 'archive', 'delete'] as const) {
      expect(can(owner, action, subject)).toEqual({ allowed: true })
    }
  })

  it('a bystander may not write, and the reason is not_owner', () => {
    expect(can(bystander, 'update', subject)).toEqual({ allowed: false, reason: 'not_owner' })
  })

  it('the head may write regardless of the owner set', () => {
    expect(can(headActor, 'delete', subject)).toEqual({ allowed: true })
  })

  it('a non-member is denied even the read', () => {
    const outsider = actor({ memberships: [{ departmentId: 'd-b', role: 'head' }] })
    expect(can(outsider, 'read', subject)).toEqual({ allowed: false, reason: 'not_a_member' })
  })

  it('a super admin under view-as reads and never writes', () => {
    const viewer = actor({
      role: 'super_admin',
      memberships: [],
      viewAs: { departmentId: 'd-a' },
    })
    expect(can(viewer, 'read', subject)).toEqual({ allowed: true })
    expect(can(viewer, 'update', subject)).toEqual({
      allowed: false,
      reason: 'read_only_view_as',
    })
  })
})

describe('can() -- P10: authenticated is every signed-in session, and nothing else', () => {
  it('allows any actor', () => {
    expect(can(actor(), 'read', { kind: 'authenticated' })).toEqual({ allowed: true })
  })

  it('denies an anonymous visitor', () => {
    expect(can(null, 'read', { kind: 'authenticated' })).toEqual({
      allowed: false,
      reason: 'not_authenticated',
    })
  })
})
