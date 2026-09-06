import { describe, expect, it } from 'vitest'
import {
  formatMinuteRange,
  minutesToTimeInput,
  timeInputToMinutes,
} from '../../src/features/inbox/time.js'

describe('inbox quiet-hours time helpers', () => {
  it('converts minutes-since-midnight to a zero-padded HH:MM', () => {
    expect(minutesToTimeInput(0)).toBe('00:00')
    expect(minutesToTimeInput(5)).toBe('00:05')
    expect(minutesToTimeInput(60)).toBe('01:00')
    expect(minutesToTimeInput(20 * 60)).toBe('20:00')
    expect(minutesToTimeInput(1439)).toBe('23:59')
  })

  it('renders an empty string for null (no override set)', () => {
    expect(minutesToTimeInput(null)).toBe('')
  })

  it('parses a valid "HH:MM" back to minutes-since-midnight', () => {
    expect(timeInputToMinutes('00:00')).toBe(0)
    expect(timeInputToMinutes('08:00')).toBe(480)
    expect(timeInputToMinutes('23:59')).toBe(1439)
  })

  it('treats an empty or malformed input as null (falls back to the department default)', () => {
    expect(timeInputToMinutes('')).toBeNull()
    expect(timeInputToMinutes('9:00')).toBeNull()
    expect(timeInputToMinutes('24:00')).toBeNull()
    expect(timeInputToMinutes('12:60')).toBeNull()
    expect(timeInputToMinutes('not-a-time')).toBeNull()
  })

  it('round-trips every minute of the day', () => {
    for (let m = 0; m < 24 * 60; m += 37) {
      expect(timeInputToMinutes(minutesToTimeInput(m))).toBe(m)
    }
  })

  it('formats a start-end range, including one that wraps past midnight', () => {
    expect(formatMinuteRange(8 * 60, 18 * 60)).toBe('08:00–18:00')
    expect(formatMinuteRange(20 * 60, 8 * 60)).toBe('20:00–08:00')
  })
})
