import { describe, expect, it } from 'vitest'
import {
  currentCheckinStart,
  cycleDates,
  tashkentDay,
} from '../../src/modules/checkins/calendar.js'

describe('Tashkent fortnight calendar', () => {
  it.each([
    ['2026-10-28T08:00:00Z', '2026-11-02'],
    ['2026-11-02T18:59:59Z', '2026-11-02'],
    ['2026-11-13T18:59:59Z', '2026-11-02'],
    ['2026-11-13T19:00:00Z', '2026-11-16'],
    ['2026-11-16T04:00:00Z', '2026-11-16'],
    ['2026-11-27T19:00:00Z', '2026-11-30'],
  ])('selects the draft at %s', (date, expected) =>
    expect(currentCheckinStart(new Date(date))).toBe(expected),
  )
  it('locks at the end of Monday and the second Friday, independent of server timezone', () => {
    const cycle = cycleDates('2026-11-02')
    expect(cycle.endsOn).toBe('2026-11-13')
    expect(cycle.checkinDeadline.toISOString()).toBe('2026-11-02T19:00:00.000Z')
    expect(cycle.checkoutDeadline.toISOString()).toBe('2026-11-13T19:00:00.000Z')
    expect(tashkentDay(new Date('2026-11-01T19:00:00Z'))).toBe('2026-11-02')
  })
})
