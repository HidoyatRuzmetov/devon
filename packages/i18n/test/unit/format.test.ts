import { describe, expect, it } from 'vitest'
import { formatDate, formatTime, formatNumber, formatUzs } from '../../src/format.js'
import type { Locale } from '../../src/locale.js'

const LOCALES: Locale[] = ['uz-Latn', 'uz-Cyrl', 'ru', 'en']
// 2026-09-06 18:30 Asia/Tashkent (UTC+5) == 13:30 UTC.
const SAMPLE = new Date('2026-09-06T13:30:00Z')

describe('formatDate / formatTime (DESIGN.md §5: DD.MM.YYYY and 24h in every locale)', () => {
  it('always renders day.month.year, regardless of locale', () => {
    for (const locale of LOCALES) expect(formatDate(SAMPLE, locale)).toBe('06.09.2026')
  })

  it('always renders 24-hour time, regardless of locale', () => {
    for (const locale of LOCALES) expect(formatTime(SAMPLE, locale)).toBe('18:30')
  })

  it('respects an explicit timezone override', () => {
    expect(formatTime(SAMPLE, 'en', 'UTC')).toBe('13:30')
    expect(formatDate(new Date('2026-01-01T00:30:00Z'), 'en', 'UTC')).toBe('01.01.2026')
  })

  it('normalises midnight to 00:00, not 24:00', () => {
    const midnightTashkent = new Date('2026-09-06T19:00:00Z') // 00:00 next day in Asia/Tashkent
    expect(formatTime(midnightTashkent, 'en')).toBe('00:00')
  })

  it('pads single-digit day and month', () => {
    expect(formatDate(new Date('2026-01-05T00:30:00Z'), 'en', 'UTC')).toBe('05.01.2026')
  })
})

// ICU groups uz-Latn/uz-Cyrl/ru with U+00A0 NO-BREAK SPACE, not a plain space -- asserted
// byte-for-byte here so a future ICU/Node upgrade that changes it is caught immediately rather than
// shipping a silently-wrong grouping character.
const NBSP = ' '

describe('formatNumber (space thousands, comma decimal in uz/ru; standard en)', () => {
  it('uses a (no-break) space thousands separator and a comma decimal for uz-Latn, uz-Cyrl and ru', () => {
    for (const locale of ['uz-Latn', 'uz-Cyrl', 'ru'] as const) {
      expect(formatNumber(1234567.5, locale)).toBe(`1${NBSP}234${NBSP}567,5`)
    }
  })

  it('uses the standard comma-thousands, dot-decimal form for en', () => {
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5')
  })
})

describe('formatUzs (maximumFractionDigits: 0, everyday word rather than the ISO code)', () => {
  it('rounds to whole som and appends the locale-appropriate word', () => {
    expect(formatUzs(1500000, 'uz-Latn')).toBe(`1${NBSP}500${NBSP}000 soʻm`)
    expect(formatUzs(1500000, 'uz-Cyrl')).toBe(`1${NBSP}500${NBSP}000 сўм`)
    expect(formatUzs(1500000, 'ru')).toBe(`1${NBSP}500${NBSP}000 сум`)
    expect(formatUzs(1500000, 'en')).toBe('UZS 1,500,000')
  })

  it('drops fractional som', () => {
    expect(formatUzs(999.9, 'en')).toBe('UZS 1,000')
  })
})
