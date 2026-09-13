// EPIC-018: channel names are the realtime layer's entire authorisation surface.
//
// A Centrifugo subscription is granted by a signed per-channel token, and this pair of pure functions
// decides whether one gets minted: `parseChannel` turns a client-supplied string into a subject, and
// `decideChannel` runs `can()` against it. Everything a browser can ever hear is downstream of these
// two, which is why they are tested exhaustively here rather than only through the route.
//
// The one property worth stating up front: **there is no "unknown namespace, allow it" branch.** A
// name that does not parse is refused, and a name that parses is refused unless `can()` says
// otherwise. Both halves are asserted below.
import { describe, expect, it } from 'vitest'
import type { Actor } from '@devon/contracts'
import {
  boardChannel,
  canvasChannel,
  decideChannel,
  departmentChannel,
  parseChannel,
  personalChannel,
} from '../../src/modules/realtime/channels.js'

const DEPT_A = '11111111-1111-4111-8111-111111111111'
const DEPT_B = '22222222-2222-4222-8222-222222222222'
const USER_A = '33333333-3333-4333-8333-333333333333'
const USER_B = '44444444-4444-4444-8444-444444444444'
const CANVAS = '55555555-5555-4555-8555-555555555555'

function member(userId = USER_A, departmentId = DEPT_A): Actor {
  return {
    userId,
    role: 'member',
    memberships: [{ departmentId, role: 'member' }],
    departmentId,
    actingFor: null,
    viewAs: null,
  }
}

function head(userId = USER_A, departmentId = DEPT_A): Actor {
  return { ...member(userId, departmentId), memberships: [{ departmentId, role: 'head' }] }
}

function superAdmin(viewing: string | null = null): Actor {
  return {
    userId: USER_B,
    role: 'super_admin',
    memberships: [],
    departmentId: viewing,
    actingFor: null,
    viewAs: viewing ? { departmentId: viewing } : null,
  }
}

describe('channel names round-trip', () => {
  it('builds and parses each of the four families', () => {
    expect(parseChannel(departmentChannel(DEPT_A))).toEqual({
      namespace: 'dept',
      departmentId: DEPT_A,
    })
    expect(parseChannel(boardChannel(DEPT_A))).toEqual({
      namespace: 'board',
      departmentId: DEPT_A,
    })
    expect(parseChannel(personalChannel(USER_A))).toEqual({
      namespace: 'personal',
      userId: USER_A,
    })
    expect(parseChannel(canvasChannel(CANVAS))).toEqual({
      namespace: 'canvas',
      sharedCanvasId: CANVAS,
    })
  })

  it("uses Centrifugo's `#` user boundary for the personal channel", () => {
    // The `#` is not cosmetic: it makes the *broker itself* refuse the channel to any connection
    // whose token subject differs -- a second lock underneath the API's own check.
    expect(personalChannel(USER_A)).toBe(`personal#${USER_A}`)
  })
})

describe('parseChannel refuses anything it does not recognise', () => {
  const bad = [
    '',
    'dept',
    'dept:',
    'dept:*',
    'dept:not-a-uuid',
    '*',
    'admin:everything',
    `admin:${DEPT_A}`,
    `personal:${USER_A}`, // personal uses `#`, not `:`
    `dept#${DEPT_A}`, // and the others use `:`, not `#`
    `canvas:${CANVAS}extra`,
    `dept:${DEPT_A} ${DEPT_B}`,
  ]

  for (const channel of bad) {
    it(`refuses ${JSON.stringify(channel)}`, () => {
      expect(parseChannel(channel)).toBeNull()
    })
  }

  it('refuses an over-long name before doing any work on it', () => {
    expect(parseChannel(`dept:${'a'.repeat(200)}`)).toBeNull()
  })

  it('refuses a wildcard even under a real namespace (no pattern subscriptions, ever)', () => {
    expect(parseChannel('board:*')).toBeNull()
    expect(parseChannel('personal#*')).toBeNull()
  })
})

describe('decideChannel', () => {
  it('refuses an unparseable channel and an anonymous caller', () => {
    expect(decideChannel(member(), null)).toEqual({
      allowed: false,
      reason: 'unknown_channel',
    })
    expect(decideChannel(null, parseChannel(boardChannel(DEPT_A)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })

  it('lets a member of a department join its data and board channels', () => {
    expect(decideChannel(member(), parseChannel(departmentChannel(DEPT_A)))).toEqual({
      allowed: true,
    })
    expect(decideChannel(member(), parseChannel(boardChannel(DEPT_A)))).toEqual({ allowed: true })
  })

  it('refuses a member another department they do not belong to (the tenancy boundary)', () => {
    expect(decideChannel(member(), parseChannel(departmentChannel(DEPT_B)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
    expect(decideChannel(member(), parseChannel(boardChannel(DEPT_B)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })

  it('gives a head exactly the same channels as a member -- the difference is the screens', () => {
    expect(decideChannel(head(), parseChannel(boardChannel(DEPT_A)))).toEqual({ allowed: true })
    expect(decideChannel(head(), parseChannel(boardChannel(DEPT_B)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })

  it("refuses the head another person's personal channel (I-1: no head exception, ever)", () => {
    // This is the invariant the whole personal workspace rests on. A boshqarma boshligʻi may read
    // every card in the department and not one row of a colleague's inbox.
    expect(decideChannel(head(), parseChannel(personalChannel(USER_B)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })

  it("refuses a super admin another person's personal channel, view-as or not (I-8a)", () => {
    expect(decideChannel(superAdmin(), parseChannel(personalChannel(USER_A)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
    expect(decideChannel(superAdmin(DEPT_A), parseChannel(personalChannel(USER_A)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })

  it('lets each person have their own personal channel', () => {
    expect(decideChannel(member(), parseChannel(personalChannel(USER_A)))).toEqual({
      allowed: true,
    })
    expect(decideChannel(member(USER_B, DEPT_A), parseChannel(personalChannel(USER_A)))).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })

  it('answers `needs_lookup` for a canvas rather than guessing', () => {
    // Whether somebody may watch a shared canvas depends on the share row and on that project's
    // members -- a database question. Returning a third value keeps "I refuse" and "I have not
    // decided yet" from looking alike, so a caller cannot mistake one for the other and mint a token.
    expect(decideChannel(member(), parseChannel(canvasChannel(CANVAS)))).toEqual({
      allowed: false,
      reason: 'needs_lookup',
    })
    expect(decideChannel(head(), parseChannel(canvasChannel(CANVAS)))).toEqual({
      allowed: false,
      reason: 'needs_lookup',
    })
  })

  it('never returns `allowed: true` for a canvas without a lookup', () => {
    for (const actor of [member(), head(), superAdmin(DEPT_A), superAdmin()]) {
      expect(decideChannel(actor, parseChannel(canvasChannel(CANVAS)))).not.toEqual({
        allowed: true,
      })
    }
  })
})
