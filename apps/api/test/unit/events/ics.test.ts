import { describe, expect, it } from 'vitest'
import { buildIcs } from '../../../src/modules/events/ics.js'

const EVENT = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Kuz piknigi',
  description: 'Jamoaviy chiqish',
  place: 'Chorvoq',
  placeUrl: 'https://maps.example.com/chorvoq',
  startsAt: '2026-09-20T04:00:00.000Z',
  endsAt: '2026-09-20T10:00:00.000Z',
  status: 'open' as const,
}

describe('buildIcs', () => {
  it('wraps every event in one VCALENDAR with the right boundaries', () => {
    const ics = buildIcs([EVENT], 'Mening tadbirlarim')
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/)
    expect(ics).toMatch(/END:VCALENDAR\r\n$/)
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain(`UID:${EVENT.id}@devon.local`)
  })

  it('renders start/end as UTC basic-format timestamps', () => {
    const ics = buildIcs([EVENT], 'cal')
    expect(ics).toContain('DTSTART:20260920T040000Z')
    expect(ics).toContain('DTEND:20260920T100000Z')
  })

  it('marks a cancelled event STATUS:CANCELLED, everything else CONFIRMED', () => {
    const cancelled = buildIcs([{ ...EVENT, status: 'cancelled' }], 'cal')
    expect(cancelled).toContain('STATUS:CANCELLED')
    const open = buildIcs([EVENT], 'cal')
    expect(open).toContain('STATUS:CONFIRMED')
  })

  it('escapes commas, semicolons and newlines in free text', () => {
    const ics = buildIcs(
      [{ ...EVENT, title: 'Tadbir, mashqlar; va boshqalar\nikkinchi qator' }],
      'cal',
    )
    expect(ics).toContain('SUMMARY:Tadbir\\, mashqlar\\; va boshqalar\\nikkinchi qator')
  })

  it('omits DESCRIPTION/LOCATION/URL when the event has none', () => {
    const ics = buildIcs([{ ...EVENT, description: null, place: null, placeUrl: null }], 'cal')
    expect(ics).not.toContain('DESCRIPTION:')
    expect(ics).not.toContain('LOCATION:')
    expect(ics).not.toContain('URL:')
  })

  it('combines multiple events into a single calendar (the per-person feed)', () => {
    const second = { ...EVENT, id: '22222222-2222-2222-2222-222222222222', title: 'Voleybol' }
    const ics = buildIcs([EVENT, second], 'Mening tadbirlarim')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain(`UID:${second.id}@devon.local`)
  })

  it('folds a long content line per RFC 5545 (continuation lines start with a space)', () => {
    const longTitle = 'A'.repeat(120)
    const ics = buildIcs([{ ...EVENT, title: longTitle }], 'cal')
    expect(ics).toMatch(/SUMMARY:A+\r\n A+/)
  })
})
