// Per-person ICS feed (TECH-SPEC §3.4/§7: "ICS per event and per person"). Stateless and
// self-verifying: the URL is `/notifications/ics/:userId/:token`, where `token` is an HMAC of `userId`
// keyed by the server's own `CSRF_SECRET` (a purpose-scoped derivation, never the raw secret) --
// exactly the shape a calendar app's "subscribe by URL" feature expects (no cookie, no login), with no
// extra database table needed (unlike `app.setup_tokens`/`app.telegram_link_codes`, this token is
// long-lived and never consumed -- recomputing and comparing it is cheap and needs no storage).
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IcsItem } from './repo.js'

function hmac(userId: string, secret: string): string {
  return createHmac('sha256', `${secret}:ics-feed`).update(userId).digest('hex')
}

export function signIcsToken(userId: string, secret: string): string {
  return hmac(userId, secret)
}

export function verifyIcsToken(userId: string, token: string, secret: string): boolean {
  const expected = hmac(userId, secret)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(token, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function foldLine(line: string): string {
  // RFC 5545 §3.1: lines over 75 octets are folded with a leading space on the continuation.
  if (line.length <= 75) return line
  const parts: string[] = []
  let rest = line
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75))
    rest = ` ${rest.slice(75)}`
  }
  parts.push(rest)
  return parts.join('\r\n')
}

function toIcsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

const CALENDAR_UID_DOMAIN = 'devon.local'

/** Builds a complete `VCALENDAR` with one `VEVENT` per item carrying a non-null `eventAt` -- always a
 * valid, parseable calendar even with zero events (an empty personal feed is not an error state for a
 * calendar app to render, matching this app's own empty-state philosophy). `locale` picks which of the
 * four localized titles becomes the event `SUMMARY`. */
export function buildIcsCalendar(
  items: readonly IcsItem[],
  locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en',
  publicUrl: string,
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Devon//Inbox//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Devon',
  ]
  const stamp = toIcsDate(new Date())
  for (const item of items) {
    const summary = escapeIcsText(item.title[locale] ?? item.title['uz-Latn'])
    const url = item.deepLink ? `${publicUrl.replace(/\/$/, '')}${item.deepLink}` : null
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${item.id}@${CALENDAR_UID_DOMAIN}`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART:${toIcsDate(item.eventAt)}`)
    lines.push(foldLine(`SUMMARY:${summary}`))
    if (url) lines.push(foldLine(`URL:${url}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // Each entry may already be a pre-folded multi-line string (`foldLine` above) -- folding again here
  // would slice through an embedded CRLF, so this just joins, it never re-folds.
  return lines.join('\r\n') + '\r\n'
}
