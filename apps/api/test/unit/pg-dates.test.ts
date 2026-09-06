import { describe, expect, it } from 'vitest'
import { pgTimestampToDate } from '../../src/lib/pg-dates.js'

// The exact text forms Postgres emits for `timestamptz` under the default `DateStyle = ISO` -- what
// `Tx.raw()` actually hands `modules/accounts/repo.ts` (see `src/lib/pg-dates.ts`). The full
// end-to-end proof against a real database is `test/checks/accounts-prove.ts`.
describe('pgTimestampToDate', () => {
  it('parses every text form Postgres emits for timestamptz', () => {
    const cases: ReadonlyArray<[text: string, iso: string]> = [
      ['2026-09-06 12:34:56.789123+00', '2026-09-06T12:34:56.789Z'], // microseconds, UTC session
      ['2026-09-06 12:34:56.789+00', '2026-09-06T12:34:56.789Z'],
      ['2026-09-06 12:34:56+00', '2026-09-06T12:34:56.000Z'], // no fractional part at all
      ['2026-09-06 17:34:56.789123+05', '2026-09-06T12:34:56.789Z'], // Asia/Tashkent session TimeZone
      ['2026-09-06 18:04:56.789123+05:30', '2026-09-06T12:34:56.789Z'],
      ['2026-09-06 08:34:56.789123-04', '2026-09-06T12:34:56.789Z'],
    ]
    for (const [text, iso] of cases) {
      expect(pgTimestampToDate(text).toISOString(), text).toBe(iso)
    }
  })

  it('passes null and an already-parsed Date through unchanged', () => {
    expect(pgTimestampToDate(null)).toBeNull()
    const date = new Date('2026-09-06T12:34:56.789Z')
    expect(pgTimestampToDate(date)).toBe(date)
  })

  it('throws on text it cannot parse instead of yielding an Invalid Date', () => {
    expect(() => pgTimestampToDate('not a timestamp')).toThrow(/unparseable timestamp/)
    expect(() => pgTimestampToDate('')).toThrow(/unparseable timestamp/)
  })
})
