import { describe, expect, it } from 'vitest'
import { usageAxisTicks } from '../../src/features/admin/usage-axis.js'
import { dayNumber, isoDay, usageBuckets } from '../../src/features/admin/usage-series.js'

const series = (start: string, end: string) =>
  usageBuckets([], { from: dayNumber(start), to: dayNumber(end) }, start === end ? [] : undefined)

describe('AI usage time axis', () => {
  it('places equally spaced labels on bucket centers, with a wider interval on a phone', () => {
    const days = series('2026-11-01', '2026-11-11')
    const wide = usageAxisTicks(days, 930, 'en')
    expect(wide.map((t) => t.label)).toEqual([
      'Nov 1',
      'Nov 3',
      'Nov 5',
      'Nov 7',
      'Nov 9',
      'Nov 11',
    ])
    expect(wide.map((t) => t.position)).toEqual([0, 2, 4, 6, 8, 10].map((i) => (i + 0.5) / 11))
    const narrow = usageAxisTicks(days, 286, 'en')
    expect(narrow.map((t) => t.label)).toEqual(['Nov 1', 'Nov 4', 'Nov 7', 'Nov 10'])
    expect(narrow.map((t) => t.position)).toEqual([0, 3, 6, 9].map((i) => (i + 0.5) / 11))
  })

  it('uses 24-hour clock boundaries, including midnight and no next-day midnight', () => {
    const hours = series('2026-11-11', '2026-11-11')
    expect(usageAxisTicks(hours, 930, 'en').map((t) => t.label)).toEqual([
      '00:00',
      '03:00',
      '06:00',
      '09:00',
      '12:00',
      '15:00',
      '18:00',
      '21:00',
    ])
    expect(usageAxisTicks(hours, 286, 'uz-Cyrl').map((t) => t.label)).toEqual([
      '00:00',
      '06:00',
      '12:00',
      '18:00',
    ])
  })

  it('keeps weekly marks on Mondays after a partial first week', () => {
    const weeks = series('2026-10-03', '2026-11-22')
    const labels = usageAxisTicks(weeks, 310, 'en')
    expect(labels.map((t) => t.label)).toEqual(['Oct 12', 'Oct 26', 'Nov 9'])
    expect(labels.map((t) => isoDay(weeks[Math.floor(t.position * weeks.length)]!.from))).toEqual([
      '2026-10-12',
      '2026-10-26',
      '2026-11-09',
    ])
  })

  it('identifies the year when days across December and January share an axis', () => {
    const days = series('2026-12-18', '2027-01-08')
    expect(usageAxisTicks(days, 286, 'en').map((t) => t.label)).toEqual([
      'Dec 21 2026',
      'Dec 28 2026',
      'Jan 4 2027',
    ])
  })

  it('labels months, quarters and years without displaying dates before the selected history', () => {
    const months = series('2024-08-15', '2027-02-03')
    expect(usageAxisTicks(months, 640, 'en').map((t) => t.label)).toEqual([
      'Jan 2025',
      'Jul 2025',
      'Jan 2026',
      'Jul 2026',
      'Jan 2027',
    ])
    const quarters = series('2021-09-17', '2027-02-11')
    expect(usageAxisTicks(quarters, 930, 'en').map((t) => t.label)).toEqual([
      '2022',
      '2023',
      '2024',
      '2025',
      '2026',
      '2027',
    ])
    const years = series('2015-09-20', '2026-11-11')
    expect(usageAxisTicks(years, 315, 'en').map((t) => t.label)).toEqual([
      '2016',
      '2018',
      '2020',
      '2022',
      '2024',
      '2026',
    ])
  })

  it('uses portal month names in all supported scripts even when embedded browser ICU is limited', () => {
    const days = series('2026-07-01', '2026-07-03')
    const first = (locale: string) => usageAxisTicks(days, 500, locale)[0]!.label
    expect(first('en')).toBe('Jul 1')
    expect(first('ru')).toBe('1 Июл')
    expect(first('uz-Latn')).toBe('1 Iyl')
    expect(first('uz-Cyrl')).toBe('1 Июл')
  })

  it('keeps phone labels apart across all four scripts, including year-bearing labels', () => {
    for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
      for (const width of [160, 245, 286, 360]) {
        const marks = usageAxisTicks(series('2026-12-01', '2027-01-10'), width, locale)
        expect(marks.length).toBeGreaterThan(0)
        let right = -Infinity
        for (const mark of marks) {
          const size = mark.label.length * 7
          const left = Math.min(width - size, Math.max(0, width * mark.position - size / 2))
          expect(left - right).toBeGreaterThanOrEqual(14)
          right = left + size
        }
      }
    }
  })

  it('omits empty axes and labels only the one real observation in a single-bucket range', () => {
    expect(usageAxisTicks([], 300, 'en')).toEqual([])
    expect(usageAxisTicks(series('2026-11-11', '2026-11-11'), 0, 'en')).toEqual([])
    const day = dayNumber('2026-11-22')
    expect(usageAxisTicks([{ from: day, to: day }], 500, 'en')).toEqual([
      { position: 0.5, label: 'Nov 22' },
    ])
  })
})
