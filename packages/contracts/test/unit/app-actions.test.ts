// Exhaustive coverage of the v1.1 matrix (SPEC §2.2): every action id in `APP_ACTIONS` is asserted
// for a member, a head, a non-member and a super admin. The table-driven blocks at the bottom mean a
// new action id cannot be added without a decision about all four -- `expectedFor()` has no default
// branch, so an unhandled subject kind fails to typecheck.
import { describe, expect, it } from 'vitest'
import {
  APP_ACTIONS,
  APP_ACTION_IDS,
  FEATURE_AREAS,
  actionsForArea,
  allowsAction,
  canAction,
  isAppActionId,
  type ActionSubjectKind,
  type AppActionId,
  type AppActionSpec,
} from '../../src/app-actions.js'
import type { Action, Actor } from '../../src/permissions.js'

const DEPT = 'd-1'
const OTHER = 'd-2'

function member(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u-member',
    role: 'member',
    memberships: [{ departmentId: DEPT, role: 'member' }],
    departmentId: DEPT,
    actingFor: null,
    viewAs: null,
    ...overrides,
  }
}

function head(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u-head',
    role: 'member', // I-8b: a head's *instance* role is still `member`
    memberships: [{ departmentId: DEPT, role: 'head' }],
    departmentId: DEPT,
    actingFor: null,
    viewAs: null,
    ...overrides,
  }
}

function outsider(): Actor {
  return {
    userId: 'u-outsider',
    role: 'member',
    memberships: [{ departmentId: OTHER, role: 'head' }],
    departmentId: OTHER,
    actingFor: null,
    viewAs: null,
    ...{},
  }
}

function superAdmin(viewAs: string | null = null): Actor {
  return {
    userId: 'u-super',
    role: 'super_admin',
    memberships: [],
    departmentId: viewAs,
    actingFor: null,
    viewAs: viewAs ? { departmentId: viewAs } : null,
  }
}

/** What the matrix says, derived from the declared subject kind alone -- the point of the registry
 * is that the kind *is* the rule. */
function expectedForMember(kind: ActionSubjectKind, action: Action): boolean {
  switch (kind) {
    case 'instance':
      return false
    case 'department_managed':
      return false
    case 'department':
      // `department` reads are open to every member; changing the department row is the head's.
      return action !== 'update' && action !== 'delete'
    case 'department_child':
    case 'owned': // asked without an owner set = the capability question
    case 'personal': // asked about themselves
    case 'own_account': // asked about themselves
    case 'authenticated':
      return true
  }
}

describe('APP_ACTIONS -- registry shape', () => {
  it('every id belongs to a declared feature area', () => {
    for (const id of APP_ACTION_IDS) {
      expect(FEATURE_AREAS).toContain(APP_ACTIONS[id].area)
    }
  })

  it('every feature area owns at least one action', () => {
    for (const area of FEATURE_AREAS) {
      expect(actionsForArea(area).length).toBeGreaterThan(0)
    }
  })

  it('ids are namespaced by their area', () => {
    for (const id of APP_ACTION_IDS) {
      expect(id.startsWith(`${APP_ACTIONS[id].area}.`)).toBe(true)
    }
  })

  it('isAppActionId narrows only real ids', () => {
    expect(isAppActionId('work.card.edit')).toBe(true)
    expect(isAppActionId('work.card.obliterate')).toBe(false)
  })

  it('only structure and telegram actions declare a widener, and unit deletion never does', () => {
    const widened = APP_ACTION_IDS.filter(
      (id) => (APP_ACTIONS[id] as AppActionSpec).widenedBy !== undefined,
    )
    expect(widened.sort()).toEqual(
      [
        'inbox.telegram.group.connect',
        'structure.unit.create',
        'structure.unit.edit',
        'structure.unit.reorder',
        'structure.unitRole.assignSelf',
      ].sort(),
    )
    expect((APP_ACTIONS['structure.unit.delete'] as AppActionSpec).widenedBy).toBeUndefined()
  })
})

describe('canAction() -- every action, every role', () => {
  it.each(APP_ACTION_IDS)('%s: a member gets the matrix answer', (id) => {
    const spec = APP_ACTIONS[id]
    expect(allowsAction(member(), id, { departmentId: DEPT })).toBe(
      expectedForMember(spec.subject, spec.action),
    )
  })

  it.each(APP_ACTION_IDS)('%s: a head of the department is allowed', (id) => {
    const spec = APP_ACTIONS[id]
    // The only thing a head is denied is the instance console.
    const expected = spec.subject !== 'instance'
    expect(allowsAction(head(), id, { departmentId: DEPT })).toBe(expected)
  })

  it.each(APP_ACTION_IDS)('%s: someone from another department is denied', (id) => {
    const spec = APP_ACTIONS[id]
    // `personal`/`own_account`/`authenticated` are about the actor themselves, not the department.
    const selfShaped =
      spec.subject === 'personal' ||
      spec.subject === 'own_account' ||
      spec.subject === 'authenticated'
    expect(allowsAction(outsider(), id, { departmentId: DEPT })).toBe(selfShaped)
  })

  it.each(APP_ACTION_IDS)('%s: an anonymous visitor is denied', (id) => {
    expect(canAction(null, id, { departmentId: DEPT })).toEqual({
      allowed: false,
      reason: 'not_authenticated',
    })
  })

  it.each(APP_ACTION_IDS)('%s: a super admin under view-as may read and never write', (id) => {
    const spec = APP_ACTIONS[id]
    const decision = canAction(superAdmin(DEPT), id, { departmentId: DEPT })
    if (spec.subject === 'instance') {
      expect(decision).toEqual({
        allowed: false,
        reason: 'read_only_view_as',
      })
      return
    }
    if (spec.subject === 'personal' || spec.subject === 'own_account') {
      // About the super admin themselves -- allowed, and never a window into somebody else (I-1).
      expect(decision.allowed).toBe(true)
      return
    }
    if (spec.subject === 'authenticated') {
      expect(decision.allowed).toBe(true)
      return
    }
    expect(decision.allowed).toBe(spec.action === 'read')
  })
})

describe('canAction() -- the four SEV1 leaks the audit found are closed', () => {
  const leaks: AppActionId[] = [
    'ai.budget.read',
    'ai.usage.readAll',
    'analytics.perPerson.read',
    'analytics.export.perPerson',
  ]

  it.each(leaks)('%s is denied to a member with not_head', (id) => {
    expect(canAction(member(), id, { departmentId: DEPT })).toEqual({
      allowed: false,
      reason: 'not_head',
    })
  })

  it.each(leaks)('%s is allowed to the head', (id) => {
    expect(canAction(head(), id, { departmentId: DEPT }).allowed).toBe(true)
  })
})

describe('canAction() -- owned actions with a real owner set', () => {
  it('a member may edit a card they were given', () => {
    expect(
      allowsAction(member(), 'work.card.edit', {
        departmentId: DEPT,
        ownerUserIds: ['u-member'],
      }),
    ).toBe(true)
  })

  it('a member may not edit a card they neither gave, own nor created', () => {
    expect(
      canAction(member(), 'work.card.edit', {
        departmentId: DEPT,
        ownerUserIds: ['u-someone-else'],
      }),
    ).toEqual({ allowed: false, reason: 'not_owner' })
  })

  it('a member may still READ a card that is not theirs -- the board is the product', () => {
    expect(
      allowsAction(member(), 'work.board.read', {
        departmentId: DEPT,
        ownerUserIds: ['u-someone-else'],
      }),
    ).toBe(true)
  })

  it('the head may edit any card in their department', () => {
    expect(
      allowsAction(head(), 'work.card.edit', {
        departmentId: DEPT,
        ownerUserIds: ['u-someone-else'],
      }),
    ).toBe(true)
  })

  it('an empty owner set denies every member but the head', () => {
    expect(
      canAction(member(), 'pages.delete', {
        departmentId: DEPT,
        ownerUserIds: [],
      }),
    ).toEqual({ allowed: false, reason: 'not_owner' })
    expect(
      allowsAction(head(), 'pages.delete', {
        departmentId: DEPT,
        ownerUserIds: [],
      }),
    ).toBe(true)
  })
})

describe('canAction() -- department switches widen a member, never narrow a head', () => {
  it('structure editing is denied by default (SPEC §2.2: the switch defaults to off)', () => {
    expect(canAction(member(), 'structure.unit.create', { departmentId: DEPT })).toEqual({
      allowed: false,
      reason: 'not_head',
    })
  })

  it('structure editing opens to members when the head switches it on', () => {
    expect(
      allowsAction(member(), 'structure.unit.create', {
        departmentId: DEPT,
        settings: { allowStructureEdit: true },
      }),
    ).toBe(true)
  })

  it('deleting a bo‘lim stays head-only even with the switch on', () => {
    expect(
      canAction(member(), 'structure.unit.delete', {
        departmentId: DEPT,
        settings: { allowStructureEdit: true },
      }),
    ).toEqual({ allowed: false, reason: 'not_head' })
  })

  it('connecting a Telegram group honours who_can_connect_telegram_group (D9)', () => {
    expect(
      canAction(member(), 'inbox.telegram.group.connect', {
        departmentId: DEPT,
      }),
    ).toEqual({
      allowed: false,
      reason: 'not_head',
    })
    expect(
      allowsAction(member(), 'inbox.telegram.group.connect', {
        departmentId: DEPT,
        settings: { whoCanConnectTelegramGroup: 'everyone' },
      }),
    ).toBe(true)
    expect(
      allowsAction(member(), 'inbox.telegram.group.connect', {
        departmentId: DEPT,
        settings: { whoCanConnectTelegramGroup: 'head' },
      }),
    ).toBe(false)
  })
})

describe('canAction() -- personal workspace has no head exception (I-1)', () => {
  it("a head cannot read a member's personal workspace", () => {
    expect(
      canAction(head(), 'personal.workspace.read', {
        departmentId: DEPT,
        subjectUserId: 'u-member',
      }),
    ).toEqual({ allowed: false, reason: 'not_owner' })
  })

  it('a super admin cannot either, view-as or not', () => {
    expect(
      canAction(superAdmin(DEPT), 'personal.workspace.read', {
        departmentId: DEPT,
        subjectUserId: 'u-member',
      }),
    ).toEqual({ allowed: false, reason: 'not_owner' })
  })

  it('but the head may see the aggregate focus minutes on a person page', () => {
    expect(
      allowsAction(head(), 'personal.focus.readAggregate', {
        departmentId: DEPT,
      }),
    ).toBe(true)
    expect(
      allowsAction(member(), 'personal.focus.readAggregate', {
        departmentId: DEPT,
      }),
    ).toBe(false)
  })
})

describe("canAction() -- a member's own person page vs somebody else's", () => {
  it('a member may read their own', () => {
    expect(
      allowsAction(member(), 'people.person.readOwn', {
        subjectUserId: 'u-member',
      }),
    ).toBe(true)
  })

  it("a member may not read a colleague's", () => {
    expect(
      canAction(member(), 'people.person.readOwn', {
        subjectUserId: 'u-other',
      }),
    ).toEqual({ allowed: false, reason: 'not_owner' })
    expect(canAction(member(), 'people.person.read', { departmentId: DEPT })).toEqual({
      allowed: false,
      reason: 'not_head',
    })
  })

  it('a member keeps the plain directory', () => {
    expect(allowsAction(member(), 'people.directory.read', { departmentId: DEPT })).toBe(true)
  })
})
