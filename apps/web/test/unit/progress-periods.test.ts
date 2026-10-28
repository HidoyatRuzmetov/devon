import { expect, it } from 'vitest'
import { progressPeriods } from '../../src/features/analytics/progress-periods.js'
const cycle = (id: string, startsOn: string, endsOn: string) => ({
  id,
  startsOn,
  endsOn,
  checkinLockedAt: null,
  checkoutLockedAt: null,
})
it('shows a six-month grid before future cycles exist without fabricating results', () => {
  const periods = progressPeriods([cycle('a', '2026-11-02', '2026-11-13')])
  expect(periods).toHaveLength(13)
  expect(periods[0]?.cycle?.id).toBe('a')
  expect(periods.slice(1).every((p) => p.cycle === null)).toBe(true)
  expect(periods[4]).toMatchObject({ startsOn: '2026-12-28', endsOn: '2027-01-08' })
})
it('keeps historical gaps empty and extends the reporting horizon beyond the latest cycle', () => {
  const periods = progressPeriods([
    cycle('b', '2027-11-01', '2027-11-12'),
    cycle('a', '2026-11-02', '2026-11-13'),
  ])
  expect(periods).toHaveLength(30)
  expect(periods[1]?.cycle).toBe(null)
  expect(periods[26]?.cycle?.id).toBe('b')
  expect(new Set(periods.map((p) => p.id)).size).toBe(periods.length)
})
