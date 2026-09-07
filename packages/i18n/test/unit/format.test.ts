import { describe, expect, it } from 'vitest'
import { formatDate, formatTime, formatNumber, formatUzs, formatRelativeTime } from '../../src/format.js'
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

  // round2 SEV1: a real embedded-Chromium build resolves 'uz-Latn' to the 'uz' macrolanguage and
  // groups with an ASCII comma ("500,000") regardless of what Node's own ICU does -- so this is
  // asserted directly against the exact input from that report rather than only through the
  // parametrised 1234567.5 case above.
  it('never uses an ASCII comma as the uz-Latn group separator, regardless of runtime ICU', () => {
    expect(formatNumber(500000, 'uz-Latn')).toBe(`500${NBSP}000`)
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

// round2 SEV1: a real embedded-Chromium build resolves 'uz-Latn' to the bare 'uz' macrolanguage tag,
// which has no CLDR relative-time data and silently falls back to English text ("now", "-12 min").
// Node's own ICU does not reproduce this, so the guard has to be a direct never-contains-English
// assertion rather than a snapshot of one call.
describe('formatRelativeTime (uz-Latn must never fall back to English CLDR text)', () => {
  const now = new Date('2026-09-06T13:30:00Z')
  const ENGLISH_LEAK = /\b(min|h|now)\b/i

  it('renders Uzbek words for uz-Latn at every magnitude', () => {
    expect(formatRelativeTime(now, 'uz-Latn', now)).toBe('hozir')
    expect(
      formatRelativeTime(new Date(now.getTime() - 12 * 60 * 1000), 'uz-Latn', now),
    ).toBe('12 daqiqa oldin')
    expect(
      formatRelativeTime(new Date(now.getTime() - 3 * 60 * 60 * 1000), 'uz-Latn', now),
    ).toBe('3 soat oldin')
    expect(
      formatRelativeTime(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), 'uz-Latn', now),
    ).toBe('2 kun oldin')
  })

  it('never contains English relative-time fragments for uz-Latn', () => {
    for (const deltaMs of [0, -30_000, -12 * 60_000, -3 * 3_600_000, -2 * 86_400_000]) {
      expect(formatRelativeTime(new Date(now.getTime() + deltaMs), 'uz-Latn', now)).not.toMatch(
        ENGLISH_LEAK,
      )
    }
  })
})
