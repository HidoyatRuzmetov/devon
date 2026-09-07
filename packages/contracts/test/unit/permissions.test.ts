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
