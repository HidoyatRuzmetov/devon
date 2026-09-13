// EPIC-019: the ICS generator and the "add to calendar" URL builders are pure -- strings and dates
// in, one string out -- so the whole wire format is asserted here without a database or a clock.
//
// Why this file exists at all: every bug in this layer is *invisible until somebody's meeting lands
// an hour out*, or their Cyrillic event title arrives in Outlook as mojibake. Neither shows up in a
// smoke test; both are a one-line assertion here.
import { describe, expect, it } from 'vitest'
import {
  buildCalendar,
  buildSingleEvent,
  escapeIcsText,
  foldLine,
  toIcsUtc,
  type CalendarItem,
} from '../../src/modules/calendar/ics.js'
import {
  googleCalendarUrl,
  office365Url,
  outlookLiveUrl,
  yahooCalendarUrl,
} from '../../src/modules/calendar/links.js'

const EVENT: CalendarItem = {
  id: '33599051-7342-59a6-a6f3-203ce7201cb8',
  kind: 'event',
  title: 'Koʻngillilar kuni: bogʻ ekish',
  body: 'Shahar bogʻida koʻchat ekish aksiyasi',
  startsAt: new Date('2026-08-22T03:00:00.000Z'),
  endsAt: new Date('2026-08-22T07:00:00.000Z'),
  place: 'Yangi bogʻ hududi, Chilonzor',
  // Relative, exactly as `repo.ts` builds it (`'/events?event=' || e.id`): the generator prepends
  // the deployment's own origin, so a deep link that was already absolute would be doubled.
  deepLink: '/events?event=33599051-7342-59a6-a6f3-203ce7201cb8',
  status: 'yes',
  updatedAt: new Date('2026-09-13T00:10:04.000Z'),
}

describe('ICS text escaping (RFC 5545 §3.3.11)', () => {
  it('escapes the four characters that would otherwise end or split a property', () => {
    expect(escapeIcsText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d')
  })

  it('turns a newline into the literal \\n a client expands, never a raw break', () => {
    // A raw CRLF here would terminate the content line and the rest of the description would be
    // parsed as a bogus property -- the classic way a multi-paragraph event body corrupts a feed.
    expect(escapeIcsText('bir\nikki')).toBe('bir\\nikki')
    expect(escapeIcsText('bir\r\nikki')).toBe('bir\\nikki')
  })

  it('escapes the backslash first, so an escape is never double-processed', () => {
    expect(escapeIcsText('\\;')).toBe('\\\\\\;')
  })
})

describe('content-line folding (RFC 5545 §3.1)', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:qisqa')).toBe('SUMMARY:qisqa')
  })

  it('folds at 75 octets with a single leading space on each continuation', () => {
    const folded = foldLine(`SUMMARY:${'a'.repeat(200)}`)
    const lines = folded.split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(Buffer.from(lines[0]!, 'utf8').length).toBeLessThanOrEqual(75)
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' ')).toBe(true)
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75)
    }
  })

  it('never splits a multi-byte character (the mojibake-in-Outlook regression)', () => {
    // Cyrillic is two octets per character: folding on characters rather than octets would put the
    // break inside a codepoint and the continuation line would begin with a lone continuation byte.
    const line = `SUMMARY:${'Ў'.repeat(120)}`
    const folded = foldLine(line)
    // Round-tripping unfolds to exactly the input -- which is only true if every piece is valid
    // UTF-8 on its own.
    const unfolded = folded
      .split('\r\n')
      .map((l, i) => (i === 0 ? l : l.slice(1)))
      .join('')
    expect(unfolded).toBe(line)
    for (const piece of folded.split('\r\n')) {
      expect(piece.includes('�')).toBe(false)
    }
  })
})

describe('UTC stamps', () => {
  it('emits the compact basic format with no punctuation and no milliseconds', () => {
    expect(toIcsUtc(new Date('2026-08-22T03:00:00.000Z'))).toBe('20260822T030000Z')
  })
})

describe('buildCalendar', () => {
  const ics = buildCalendar({
    items: [EVENT],
    locale: 'uz-Latn',
    publicUrl: 'https://portal.example.uz',
    reminderMinutes: null,
  })

  it('wraps the whole document and names the product', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//Devon WorkPortal//Calendar//EN')
  })

  it('carries a real Asia/Tashkent VTIMEZONE at a fixed +05:00', () => {
    // Uzbekistan has had no DST since 1995. A client that ignores VTIMEZONE still gets the right
    // instant from the UTC stamps; one that honours it gets the right wall clock.
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:Asia/Tashkent')
    expect(ics).toContain('TZOFFSETTO:+0500')
    expect(ics).not.toContain('BEGIN:DAYLIGHT')
  })

  it('uses CRLF line endings everywhere (a bare LF is not a valid content-line break)', () => {
    expect(ics.includes('\r\n')).toBe(true)
    expect(/[^\r]\n/.test(ics)).toBe(false)
  })

  it('gives every item a globally unique UID and keeps the deep link', () => {
    expect(ics).toContain(`UID:event-${EVENT.id}@workportal.local`)
    expect(ics).toContain('URL:https://portal.example.uz/events?event=')
    // ...and exactly once: a deep link is relative and the origin is added here, so a doubled
    // origin (`https://x.uzhttps://x.uz/...`) would be an invalid URL in every feed entry.
    expect(ics).not.toContain('uzhttps://')
  })

  it('tells a subscribing client how often to come back', () => {
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT12H')
    expect(ics).toContain('X-PUBLISHED-TTL:PT12H')
  })

  it('emits an alarm only when one was asked for', () => {
    expect(ics).not.toContain('BEGIN:VALARM')
    const withAlarm = buildCalendar({
      items: [EVENT],
      locale: 'uz-Latn',
      publicUrl: 'https://portal.example.uz',
      reminderMinutes: 30,
    })
    expect(withAlarm).toContain('BEGIN:VALARM')
    expect(withAlarm).toContain('TRIGGER:-PT30M')
  })

  it('produces a complete document for an empty feed rather than an empty body', () => {
    // A calendar app given a zero-byte response shows "could not subscribe"; given a valid empty
    // VCALENDAR it shows an empty calendar, which is the honest answer for a new feed.
    const empty = buildCalendar({
      items: [],
      locale: 'uz-Latn',
      publicUrl: 'https://x.uz',
      reminderMinutes: null,
    })
    expect(empty).toContain('BEGIN:VCALENDAR')
    expect(empty).toContain('END:VCALENDAR')
    expect(empty).not.toContain('BEGIN:VEVENT')
  })
})

describe('buildSingleEvent', () => {
  it('is a one-event VCALENDAR, which is what an .ics attachment has to be', () => {
    const one = buildSingleEvent(EVENT, 'uz-Latn', 'https://portal.example.uz')
    expect(one.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(one.split('BEGIN:VEVENT').length - 1).toBe(1)
  })
})

describe('add-to-calendar links', () => {
  const input = {
    title: 'Koʻngillilar kuni',
    description: 'Koʻchat ekish',
    place: 'Chilonzor',
    startsAt: new Date('2026-08-22T03:00:00.000Z'),
    endsAt: new Date('2026-08-22T07:00:00.000Z'),
    eventUrl: 'https://portal.example.uz/events?event=1',
  }

  it('Google takes compact UTC joined by a slash, plus the Tashkent timezone', () => {
    const url = new URL(googleCalendarUrl(input))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20260822T030000Z/20260822T070000Z')
    expect(url.searchParams.get('ctz')).toBe('Asia/Tashkent')
    expect(url.searchParams.get('text')).toBe('Koʻngillilar kuni')
  })

  it('Outlook takes ISO 8601, not the compact form (the formats are not interchangeable)', () => {
    const url = new URL(outlookLiveUrl(input))
    expect(url.hostname).toBe('outlook.live.com')
    expect(url.searchParams.get('startdt')).toBe('2026-08-22T03:00:00.000Z')
    expect(url.searchParams.get('enddt')).toBe('2026-08-22T07:00:00.000Z')
  })

  it('Microsoft 365 is the same shape on the work/school host', () => {
    const url = new URL(office365Url(input))
    expect(url.hostname).toBe('outlook.office.com')
    expect(url.searchParams.get('rru')).toBe('addevent')
  })

  it('Yahoo takes the compact form in two separate parameters', () => {
    const url = new URL(yahooCalendarUrl(input))
    expect(url.hostname).toBe('calendar.yahoo.com')
    expect(url.searchParams.get('st')).toBe('20260822T030000Z')
    expect(url.searchParams.get('et')).toBe('20260822T070000Z')
  })

  it('carries the event URL back into WorkPortal on every service', () => {
    for (const build of [googleCalendarUrl, outlookLiveUrl, office365Url, yahooCalendarUrl]) {
      expect(build(input)).toContain(encodeURIComponent(input.eventUrl).slice(0, 20))
    }
  })

  it('percent-encodes a title that would otherwise break the query string', () => {
    const url = new URL(googleCalendarUrl({ ...input, title: 'a&b=c d' }))
    expect(url.searchParams.get('text')).toBe('a&b=c d')
  })
})
