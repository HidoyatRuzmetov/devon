// v1.1 critique SEV2 #10 -- the per-cell unit tests the adjudication asked for: every combination of
// (who is asking) x (what they own) x (what they are trying to change), against the module's own
// guard rather than against a description of it.
//
// The finding, stated plainly: every events route declared `{kind:'department_child'}`, whose P3
// rule grants any active member every action -- `delete` at `index.ts:332` and `:412` included. What
// actually stopped a xodim deleting a colleague's event was three hand-written copies of
// `if (x !== actor.userId && !actor.isHead) throw` inside `service.ts`, plus a dozen
// `canManage: owner === viewer || isHead` expressions in the DTO builders. The behaviour was right;
// the structure was the one I-7 exists to forbid, in the busiest module in the product, and one bad
// refactor of that guard would have opened event deletion with nothing failing.
//
// `guards.ts` now answers every one of those questions through `can()` with `{kind:'owned'}`. This
// file is the matrix: if somebody re-introduces a private rule, one of these cells changes.
import { describe, expect, it } from 'vitest'
import type { Actor as PermissionActor } from '@devon/contracts'
import { mayManage, viewerCanManage, assertManage } from '../../../src/modules/events/guards.js'
import { EventForbiddenError } from '../../../src/modules/events/errors.js'

const DEPT = '00000000-0000-4000-8000-00000000dept'
const OTHER_DEPT = '00000000-0000-4000-8000-0000000other'

const ORGANIZER = 'u-organizer'
const COLLEAGUE = 'u-colleague'
const HEAD = 'u-head'
const OUTSIDER = 'u-outsider'
const SUPER = 'u-super'

function principal(userId: string, over: Partial<PermissionActor> = {}): PermissionActor {
  return {
    userId,
    role: 'member',
    memberships: [{ departmentId: DEPT, role: 'member' }],
    departmentId: DEPT,
    actingFor: null,
    viewAs: null,
    ...over,
  }
}

function actor(userId: string, over: Partial<PermissionActor> = {}) {
  return {
    userId,
    departmentId: DEPT,
    principal: principal(userId, over),
    givenName: 'Test',
    familyName: 'User',
  }
}

const asOrganizer = actor(ORGANIZER)
const asColleague = actor(COLLEAGUE)
const asHead = actor(HEAD, { memberships: [{ departmentId: DEPT, role: 'head' }] })
const asOutsider = actor(OUTSIDER, {
  memberships: [{ departmentId: OTHER_DEPT, role: 'member' }],
  departmentId: OTHER_DEPT,
})
const asSuperAdmin = actor(SUPER, { role: 'super_admin', memberships: [] })
const asSuperAdminViewing = actor(SUPER, {
  role: 'super_admin',
  memberships: [],
  viewAs: { departmentId: DEPT },
})

/** One row per object this module protects. The owner id is what `guards.ts` is handed. */
const OBJECTS: { name: string; owner: string }[] = [
  { name: 'an event (its organizer)', owner: ORGANIZER },
  { name: 'a comment (its author)', owner: ORGANIZER },
  { name: 'a carpool (its driver)', owner: ORGANIZER },
  { name: 'a poll (its creator)', owner: ORGANIZER },
  { name: 'a photo (whoever uploaded it)', owner: ORGANIZER },
]

describe('SEV2 #10 -- the events ownership matrix, decided by can()', () => {
  it.each(OBJECTS)('the owner may manage $name', ({ owner }) => {
    expect(mayManage(asOrganizer, [owner])).toBe(true)
  })

  it.each(OBJECTS)('the boshqarma boshligʻi may manage $name', ({ owner }) => {
    expect(mayManage(asHead, [owner])).toBe(true)
  })

  it.each(OBJECTS)('a colleague who does not own it may NOT manage $name', ({ owner }) => {
    expect(mayManage(asColleague, [owner])).toBe(false)
  })

  it.each(OBJECTS)('somebody from another department may NOT manage $name', ({ owner }) => {
    expect(mayManage(asOutsider, [owner])).toBe(false)
  })

  it('a super admin with no membership here may not manage anything in this department', () => {
    expect(mayManage(asSuperAdmin, [ORGANIZER])).toBe(false)
  })

  it('a super admin under view-as is read-only, so managing is still refused (I-8a)', () => {
    expect(mayManage(asSuperAdminViewing, [ORGANIZER])).toBe(false)
  })

  it('an unauthenticated principal is refused', () => {
    const anonymous = { ...asColleague, principal: null }
    expect(mayManage(anonymous, [ORGANIZER])).toBe(false)
  })

  it('an object with no owner at all is head-only', () => {
    expect(mayManage(asHead, [null])).toBe(true)
    expect(mayManage(asColleague, [null])).toBe(false)
    expect(mayManage(asOrganizer, [])).toBe(false)
  })

  it('an owner set with several people admits every one of them', () => {
    expect(mayManage(asColleague, [ORGANIZER, COLLEAGUE])).toBe(true)
    expect(mayManage(asOrganizer, [ORGANIZER, COLLEAGUE])).toBe(true)
    expect(mayManage(asOutsider, [ORGANIZER, COLLEAGUE])).toBe(false)
  })

  it('a blank owner id never matches a blank actor id', () => {
    const nameless = { ...asColleague, principal: principal('') }
    expect(mayManage(nameless, [''])).toBe(false)
  })
})

describe('SEV2 #10 -- assertManage raises this module’s own forbidden error', () => {
  it('throws for a colleague', () => {
    expect(() => assertManage(asColleague, [ORGANIZER])).toThrow(EventForbiddenError)
  })

  it('is silent for the owner and for the head', () => {
    expect(() => assertManage(asOrganizer, [ORGANIZER])).not.toThrow()
    expect(() => assertManage(asHead, [ORGANIZER])).not.toThrow()
  })
})

describe('SEV2 #10 -- the DTO’s canManage answers the same question', () => {
  it('is true for the owner, true for the head, false for everyone else', () => {
    expect(viewerCanManage(ORGANIZER, ORGANIZER, false)).toBe(true)
    expect(viewerCanManage(ORGANIZER, COLLEAGUE, true)).toBe(true)
    expect(viewerCanManage(ORGANIZER, COLLEAGUE, false)).toBe(false)
  })

  it('an unowned row is manageable only by the head', () => {
    expect(viewerCanManage(null, COLLEAGUE, false)).toBe(false)
    expect(viewerCanManage(null, COLLEAGUE, true)).toBe(true)
  })

  it('agrees with mayManage on every cell of the matrix', () => {
    const cells: { who: typeof asHead; isHead: boolean }[] = [
      { who: asOrganizer, isHead: false },
      { who: asColleague, isHead: false },
      { who: asHead, isHead: true },
    ]
    for (const { who, isHead } of cells) {
      expect(viewerCanManage(ORGANIZER, who.userId, isHead)).toBe(mayManage(who, [ORGANIZER]))
    }
  })
})
