// RFC 5545 ICS export (TECH-SPEC §3.4: "ICS per event and per person"). Pure string building, no I/O
// -- unit-tested directly (`apps/api/test/unit/events/ics.test.ts`).
export type IcsEventInput = {
  id: string
  title: string
  description: string | null
  place: string | null
  placeUrl: string | null
  startsAt: string
  endsAt: string
  status: 'draft' | 'open' | 'full' | 'cancelled' | 'done'
}

/** RFC 5545 §3.3.11 TEXT escaping: backslash, then the three characters it would otherwise be
 * ambiguous with, in that order (escaping the backslash first is why this is not a plain four-way
 * replace-in-place). */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function toIcsUtc(iso: string): string {
  const d = new Date(iso)
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/** Folds a content line at 75 octets per RFC 5545 §3.1 (continuation lines start with a single
 * space) -- a long `DESCRIPTION`/`SUMMARY` would otherwise produce a line no ICS reader can parse. */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 75))
  rest = rest.slice(75)
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`)
    rest = rest.slice(74)
  }
  return parts.join('\r\n')
}

function buildVevent(event: IcsEventInput, stamp: string): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}@devon.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(event.startsAt)}`,
    `DTEND:${toIcsUtc(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ]
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
  if (event.place) lines.push(`LOCATION:${escapeIcsText(event.place)}`)
  if (event.placeUrl) lines.push(`URL:${escapeIcsText(event.placeUrl)}`)
  lines.push(`STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`)
  lines.push('END:VEVENT')
  return lines.map(foldLine).join('\r\n')
}

/** One `VCALENDAR` wrapping every event given -- used both for a single event's own `.ics` and for a
 * person's combined feed of everything they RSVPed yes/maybe to. */
export function buildIcs(events: readonly IcsEventInput[], calendarName: string): string {
  const stamp = toIcsUtc(new Date().toISOString())
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Devon//Events//EN',
    'CALSCALE:GREGORIAN',
    foldLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`),
    ...events.map((event) => buildVevent(event, stamp)),
    'END:VCALENDAR',
  ]
  return `${body.join('\r\n')}\r\n`
}
