// Pure quiet-hours math (TECH-SPEC §7). No DB, no clock -- see
// `src/modules/notifications/quiet-hours.ts`'s own header for why this is testable in isolation.
import { describe, expect, it } from 'vitest'
import {
  DEPARTMENT_QUIET_DEFAULT,
  isQuieterOrEqual,
  isWithinQuietHours,
  quietMinutesPerDay,
  resolveEffectiveQuietWindow,
} from '../../src/modules/notifications/quiet-hours.js'

describe('quietMinutesPerDay', () => {
  it('handles a same-day window', () => {
    expect(quietMinutesPerDay({ startMinute: 13 * 60, endMinute: 14 * 60 })).toBe(60)
  })

  it('handles a window that wraps past midnight (the department default)', () => {
    expect(quietMinutesPerDay(DEPARTMENT_QUIET_DEFAULT)).toBe(12 * 60) // 20:00-08:00
  })
})

describe('isWithinQuietHours', () => {
  const window = DEPARTMENT_QUIET_DEFAULT // 20:00-08:00, weekends included

  it('is quiet late at night', () => {
    expect(isWithinQuietHours(21 * 60, false, window)).toBe(true)
  })

  it('is quiet early in the morning (still inside the wrapped window)', () => {
    expect(isWithinQuietHours(6 * 60, false, window)).toBe(true)
  })

  it('is not quiet in the middle of a weekday', () => {
    expect(isWithinQuietHours(14 * 60, false, window)).toBe(false)
  })

  it('is quiet all day on a weekend when includeWeekends is true', () => {
    expect(isWithinQuietHours(14 * 60, true, window)).toBe(true)
  })

  it('is not quiet on a weekend afternoon when includeWeekends is false', () => {
    expect(isWithinQuietHours(14 * 60, true, { ...window, includeWeekends: false })).toBe(false)
  })

  it('handles a same-day window correctly (no wraparound)', () => {
    const lunch = { startMinute: 13 * 60, endMinute: 14 * 60, includeWeekends: false }
    expect(isWithinQuietHours(13 * 60 + 30, false, lunch)).toBe(true)
    expect(isWithinQuietHours(15 * 60, false, lunch)).toBe(false)
  })
})

describe('isQuieterOrEqual ("personal override to quieter", TECH-SPEC §7)', () => {
  const dept = DEPARTMENT_QUIET_DEFAULT // 20:00-08:00 + weekends = 720 min/day

  it('accepts a personal window with strictly more quiet minutes', () => {
    // 19:30-08:30 = 13h/day, strictly more than the department default's 20:00-08:00 = 12h/day.
    expect(isQuieterOrEqual({ startMinute: 19 * 60 + 30, endMinute: 8 * 60 + 30, includeWeekends: true }, dept)).toBe(true)
  })

  it('accepts an identical window', () => {
    expect(isQuieterOrEqual(dept, dept)).toBe(true)
  })

  it('rejects a personal window with fewer quiet minutes ("louder")', () => {
    expect(isQuieterOrEqual({ startMinute: 22 * 60, endMinute: 6 * 60, includeWeekends: true }, dept)).toBe(false)
  })

  it('rejects turning weekend quiet off when the department default has it on, even with equal minutes', () => {
    expect(isQuieterOrEqual({ ...dept, includeWeekends: false }, dept)).toBe(false)
  })

  it('accepts turning weekend quiet on when the department default has it off', () => {
    const deptNoWeekends = { ...dept, includeWeekends: false }
    expect(isQuieterOrEqual({ ...dept, includeWeekends: true }, deptNoWeekends)).toBe(true)
  })
})

describe('resolveEffectiveQuietWindow', () => {
  it('falls back to the department default when there is no personal override', () => {
    const result = resolveEffectiveQuietWindow(null, DEPARTMENT_QUIET_DEFAULT)
    expect(result).toEqual({ ...DEPARTMENT_QUIET_DEFAULT, source: 'department_default' })
  })

  it('falls back to the department default for a fully-null override', () => {
    const result = resolveEffectiveQuietWindow(
      { startMinute: null, endMinute: null, includeWeekends: null },
      DEPARTMENT_QUIET_DEFAULT,
    )
    expect(result.source).toBe('department_default')
  })

  it('fills only the overridden fields, inheriting the rest from the department default', () => {
    const result = resolveEffectiveQuietWindow(
      { startMinute: 21 * 60, endMinute: null, includeWeekends: null },
      DEPARTMENT_QUIET_DEFAULT,
    )
    expect(result).toEqual({
      startMinute: 21 * 60,
      endMinute: DEPARTMENT_QUIET_DEFAULT.endMinute,
      includeWeekends: DEPARTMENT_QUIET_DEFAULT.includeWeekends,
      source: 'personal',
    })
  })
})
