import { describe, expect, it } from 'vitest'
import {
  average,
  diffEvent,
  eventStatusFromUnits,
  resolveYesRsvp,
  selectWaitlistPromotions,
  validatePollVote,
} from '../../../src/modules/events/logic.js'

const BASE = {
  title: 'Kuz piknigi',
  startsAt: '2026-09-20T09:00:00.000Z',
  endsAt: '2026-09-20T15:00:00.000Z',
  place: 'Chorvoq',
  placeUrl: null,
  capacity: 30,
  costNote: null,
  description: null,
}

describe('diffEvent', () => {
  it('returns no changes when nothing differs', () => {
    expect(diffEvent(BASE, { ...BASE })).toEqual([])
  })

  it('reports only the fields that changed, before/after as strings', () => {
    const changes = diffEvent(BASE, { ...BASE, title: 'Yangi nom', capacity: 40 })
    expect(changes).toEqual([
      { field: 'title', before: 'Kuz piknigi', after: 'Yangi nom' },
      { field: 'capacity', before: '30', after: '40' },
    ])
  })

  it('represents a field cleared to null distinctly from unchanged', () => {
    const changes = diffEvent(BASE, { ...BASE, place: null })
    expect(changes).toEqual([{ field: 'place', before: 'Chorvoq', after: null }])
  })
})

describe('resolveYesRsvp', () => {
  it('always fits when capacity is unlimited', () => {
    expect(
      resolveYesRsvp({
        capacity: null,
        waitlistEnabled: false,
        currentGoingUnits: 999,
        unitsNeeded: 5,
      }),
    ).toEqual({
      status: 'yes',
    })
  })

  it('fits when there is enough room', () => {
    expect(
      resolveYesRsvp({ capacity: 10, waitlistEnabled: true, currentGoingUnits: 5, unitsNeeded: 3 }),
    ).toEqual({
      status: 'yes',
    })
  })

  it('waitlists when full and waitlisting is enabled', () => {
    expect(
      resolveYesRsvp({
        capacity: 10,
        waitlistEnabled: true,
        currentGoingUnits: 10,
        unitsNeeded: 1,
      }),
    ).toEqual({
      status: 'waitlist',
    })
  })

  it('rejects when full and waitlisting is disabled', () => {
    expect(
      resolveYesRsvp({
        capacity: 10,
        waitlistEnabled: false,
        currentGoingUnits: 10,
        unitsNeeded: 1,
      }),
    ).toEqual({
      status: 'rejected',
    })
  })

  it('treats an exact fit as fitting, not waitlisting', () => {
    expect(
      resolveYesRsvp({ capacity: 5, waitlistEnabled: true, currentGoingUnits: 3, unitsNeeded: 2 }),
    ).toEqual({
      status: 'yes',
    })
  })
})

describe('eventStatusFromUnits', () => {
  it('never changes a cancelled/done/draft event', () => {
    expect(eventStatusFromUnits('cancelled', 10, 20)).toBe('cancelled')
    expect(eventStatusFromUnits('done', 10, 0)).toBe('done')
    expect(eventStatusFromUnits('draft', null, 0)).toBe('draft')
  })

  it('flips open <-> full purely from capacity vs going units', () => {
    expect(eventStatusFromUnits('open', 10, 10)).toBe('full')
    expect(eventStatusFromUnits('full', 10, 9)).toBe('open')
  })

  it('is always open when capacity is unlimited', () => {
    expect(eventStatusFromUnits('open', null, 500)).toBe('open')
  })
})

describe('selectWaitlistPromotions', () => {
  it('promotes in arrival order while units fit', () => {
    const waitlist = [
      { id: 'a', units: 1 },
      { id: 'b', units: 2 },
      { id: 'c', units: 1 },
    ]
    expect(selectWaitlistPromotions(waitlist, 3)).toEqual(['a', 'b'])
  })

  it('stops at the first entry that does not fit, never skipping ahead', () => {
    const waitlist = [
      { id: 'a', units: 3 },
      { id: 'b', units: 1 },
    ]
    expect(selectWaitlistPromotions(waitlist, 1)).toEqual([])
  })

  it('promotes nothing when there is no freed capacity', () => {
    expect(selectWaitlistPromotions([{ id: 'a', units: 1 }], 0)).toEqual([])
  })
})

describe('validatePollVote', () => {
  const options = new Set(['o1', 'o2', 'o3'])

  it('accepts exactly one option for single/date polls', () => {
    expect(validatePollVote('single', ['o1'], options)).toBeNull()
    expect(validatePollVote('date', ['o2'], options)).toBeNull()
  })

  it('rejects more than one option for single/date polls', () => {
    expect(validatePollVote('single', ['o1', 'o2'], options)).toBe('single_choice_required')
  })

  it('accepts multiple distinct options for multi polls', () => {
    expect(validatePollVote('multi', ['o1', 'o2'], options)).toBeNull()
  })

  it('rejects a duplicate option id', () => {
    expect(validatePollVote('multi', ['o1', 'o1'], options)).toBe('duplicate_option')
  })

  it('rejects an option id that does not belong to the poll', () => {
    expect(validatePollVote('multi', ['o1', 'zz'], options)).toBe('unknown_option')
  })
})

describe('average', () => {
  it('is null for an empty list', () => {
    expect(average([])).toBeNull()
  })

  it('rounds to one decimal place', () => {
    expect(average([5, 4, 4])).toBeCloseTo(4.3, 5)
  })
})
