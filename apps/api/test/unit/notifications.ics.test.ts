// Per-person ICS feed (TECH-SPEC §3.4/§7). Pure and stateless -- see `ics.ts`'s header comment for
// why the token needs no database row.
import { describe, expect, it } from 'vitest'
import {
  buildIcsCalendar,
  signIcsToken,
  verifyIcsToken,
} from '../../src/modules/notifications/ics.js'
import type { IcsItem } from '../../src/modules/notifications/repo.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222'
const SECRET = 'test-only-example-secret'

describe('signIcsToken / verifyIcsToken', () => {
  it('verifies a token signed for the same user and secret', () => {
    const token = signIcsToken(USER_ID, SECRET)
    expect(verifyIcsToken(USER_ID, token, SECRET)).toBe(true)
  })

  it('rejects a token signed for a different user', () => {
    const token = signIcsToken(USER_ID, SECRET)
    expect(verifyIcsToken(OTHER_USER_ID, token, SECRET)).toBe(false)
  })

  it('rejects a token signed with a different secret', () => {
    const token = signIcsToken(USER_ID, SECRET)
    expect(verifyIcsToken(USER_ID, token, 'a-different-secret')).toBe(false)
  })

  it('rejects a garbage token of the wrong length without throwing', () => {
    expect(verifyIcsToken(USER_ID, 'not-a-real-token', SECRET)).toBe(false)
  })

  it('is deterministic: the same user and secret always produce the same token', () => {
    expect(signIcsToken(USER_ID, SECRET)).toBe(signIcsToken(USER_ID, SECRET))
  })
})

const SAMPLE_ITEM: IcsItem = {
  id: '33333333-3333-3333-3333-333333333333',
  title: {
    'uz-Latn': 'Jamoaviy sayr',
    'uz-Cyrl': 'Жамоавий сайр',
    ru: 'Командный выезд',
    en: 'Team outing',
  },
  deepLink: '/events/33333333-3333-3333-3333-333333333333',
  eventAt: new Date('2026-09-12T10:00:00.000Z'),
}

describe('buildIcsCalendar', () => {
  it('produces a valid, parseable VCALENDAR with zero events (empty state, never an error)', () => {
    const ics = buildIcsCalendar([], 'uz-Latn', 'https://portal.example')
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it("renders one VEVENT per item, with the requested locale's title as SUMMARY", () => {
    const ics = buildIcsCalendar([SAMPLE_ITEM], 'ru', 'https://portal.example')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:Командный выезд')
    expect(ics).toContain('UID:33333333-3333-3333-3333-333333333333@devon.local')
    expect(ics).toContain('DTSTART:20260912T100000Z')
    expect(ics).toContain('URL:https://portal.example/events/33333333-3333-3333-3333-333333333333')
  })

  it('falls back to uz-Latn when the requested locale key is missing', () => {
    const partialItem: IcsItem = {
      ...SAMPLE_ITEM,
      title: { ...SAMPLE_ITEM.title, en: '' } as never,
    }
    const ics = buildIcsCalendar([partialItem], 'uz-Latn', 'https://portal.example')
    expect(ics).toContain('SUMMARY:Jamoaviy sayr')
  })

  it('uses CRLF line endings (RFC 5545)', () => {
    const ics = buildIcsCalendar([SAMPLE_ITEM], 'en', 'https://portal.example')
    expect(ics).toContain('\r\n')
    expect(ics.endsWith('\r\n')).toBe(true)
  })

  it('folds a long SUMMARY line rather than emitting one raw line over 75 octets', () => {
    const longTitle = 'A'.repeat(120)
    const longItem: IcsItem = { ...SAMPLE_ITEM, title: { ...SAMPLE_ITEM.title, en: longTitle } }
    const ics = buildIcsCalendar([longItem], 'en', 'https://portal.example')
    const lines = ics.split('\r\n')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(75)
  })
})
