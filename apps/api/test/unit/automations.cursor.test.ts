import { describe, expect, it } from 'vitest'
import {
  decodeRunCursor,
  encodeRunCursor,
  runCursorSchema,
} from '../../src/modules/automations/cursor.js'

describe('automation run cursor compatibility and validation', () => {
  it('retains exact microseconds and UUID tie-breakers', () => {
    const at = '2026-10-01T10:00:00.123456Z'
    const id = 'c6da1051-1bac-4e09-b5ca-f82f3c839596'
    const value = encodeRunCursor(at, id)
    expect(runCursorSchema.parse(value)).toBe(value)
    expect(decodeRunCursor(value)).toEqual({ at, id })
  })
  it('accepts former timestamp cursors including explicit timezone offsets', () => {
    const at = '2026-10-01T15:00:00+05:00'
    expect(decodeRunCursor(at)).toEqual({ at, id: null })
  })
  it.each([
    'not-a-cursor',
    '2026-02-30T10:00:00Z',
    '2026-10-01T25:00:00Z',
    '2026-10-01T10:00:00',
    encodeRunCursor('2026-10-01T10:00:00Z', 'not-an-id'),
  ])('rejects invalid cursors: %s', (value) => {
    expect(runCursorSchema.safeParse(value).success).toBe(false)
    expect(decodeRunCursor(value)).toBeNull()
  })
})
