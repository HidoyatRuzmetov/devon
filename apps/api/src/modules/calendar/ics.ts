// RFC 5545 calendar generation (v1.1 SPEC §10, EPIC-019). Pure: strings in, one string out, so
// `test/unit/calendar.ics.test.ts` asserts the whole format -- folding, escaping, the timezone block
// and the alarms -- without a database or a clock.
//
// What a Devon feed contains, in the words of the people who read it: "mening tadbirlarim va
// muddatlarim" -- the department's events (with this person's own RSVP reflected in the STATUS and
// in a PARTSTAT) and this person's own cards with a due date. Nothing from the personal workspace
// (I-1: the feed URL is a bearer token that ends up on a phone).
//
// Two format decisions worth writing down:
//   * a real `VTIMEZONE` for Asia/Tashkent is emitted and every timestamp is UTC (`Z`). Uzbekistan
//     has had no DST since 1995 and a fixed +05:00 offset, so the block is three lines and correct
//     for every date this product deals with -- and a calendar client that ignores VTIMEZONE still
//     gets the right instant from the UTC stamps.
//   * a card's due date becomes a 30-minute `VEVENT` ending at the due time, not an all-day event:
//     "muddat 17:00" belongs at 17:00 in the day grid, where a person planning their afternoon can
//     see it, rather than as a banner at the top of the day.

export type CalendarLocale = 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'

export type CalendarItem = {
  id: string
  kind: 'event' | 'card'
  title: string
  body: string
  startsAt: Date
  endsAt: Date
  place: string
  deepLink: string
  /** For an event: the person's RSVP (`yes`/`maybe`/`no`/`waitlist`/`none`) or `cancelled`. For a
   * card: its own status (`active`/`done`/...). */
  status: string
  updatedAt: Date
}

const PRODID = '-//Devon WorkPortal//Calendar//EN'
const UID_DOMAIN = 'workportal.local'

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** RFC 5545 §3.1: content lines are folded at 75 octets, continuations start with one space. Folding
 * is done on octets, not characters, or a Cyrillic title would fold mid-codepoint and arrive as
 * mojibake in Outlook. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let offset = 0
  let limit = 75
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length)
    // Never split a UTF-8 sequence: walk back off any continuation byte (10xxxxxx).
    while (end > offset && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1
    parts.push((offset === 0 ? '' : ' ') + bytes.subarray(offset, end).toString('utf8'))
    offset = end
    limit = 74 // the leading space costs one octet on every continuation line
  }
  return parts.join('\r\n')
}

export function toIcsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

const TASHKENT_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Tashkent',
  'BEGIN:STANDARD',
  'DTSTART:19950101T000000',
  'TZOFFSETFROM:+0500',
  'TZOFFSETTO:+0500',
  'TZNAME:+05',
  'END:STANDARD',
  'END:VTIMEZONE',
]

const FEED_NAME: Record<CalendarLocale, string> = {
  'uz-Latn': 'WorkPortal — mening kalendarim',
  'uz-Cyrl': 'WorkPortal — менинг календарим',
  ru: 'WorkPortal — мой календарь',
  en: 'WorkPortal — my calendar',
}

const CARD_PREFIX: Record<CalendarLocale, string> = {
  'uz-Latn': 'Muddat',
  'uz-Cyrl': 'Муддат',
  ru: 'Срок',
  en: 'Due',
}

const REMINDER_TEXT: Record<CalendarLocale, string> = {
  'uz-Latn': 'Eslatma',
  'uz-Cyrl': 'Эслатма',
  ru: 'Напоминание',
  en: 'Reminder',
}

/** RSVP answer -> the `PARTSTAT` a calendar client understands. `waitlist` has no iCalendar
 * equivalent, and `TENTATIVE` is the honest reading of "you are on the waiting list". */
function partstatFor(status: string): string {
  switch (status) {
    case 'yes':
      return 'ACCEPTED'
    case 'no':
      return 'DECLINED'
    case 'maybe':
    case 'waitlist':
      return 'TENTATIVE'
    default:
      return 'NEEDS-ACTION'
  }
}

export type BuildCalendarOptions = {
  items: readonly CalendarItem[]
  locale: CalendarLocale
  publicUrl: string
  /** Minutes before the start to fire a `VALARM`. `null` for no alarm at all -- a person who already
   * gets a Telegram reminder does not need their phone to buzz twice. */
  reminderMinutes: number | null
  now?: Date
}

/** A complete `VCALENDAR`. Always valid, including with zero items -- an empty calendar is a normal
 * state for a new xodim, not an error for a calendar client to choke on. */
export function buildCalendar(options: BuildCalendarOptions): string {
  const { items, locale, publicUrl, reminderMinutes } = options
  const stamp = toIcsUtc(options.now ?? new Date())
  const base = publicUrl.replace(/\/$/, '')
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeIcsText(FEED_NAME[locale])}`),
    'X-WR-TIMEZONE:Asia/Tashkent',
    // Outlook and Google both honour this as "do not poll more often than"; twelve hours is plenty
    // for a calendar of meetings and deadlines and keeps a subscribed phone off the battery.
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...TASHKENT_VTIMEZONE,
  ]

  for (const item of items) {
    const summary = item.kind === 'card' ? `${CARD_PREFIX[locale]}: ${item.title}` : item.title
    const start =
      item.kind === 'card' ? new Date(item.startsAt.getTime() - 30 * 60_000) : item.startsAt
    const end = item.kind === 'card' ? item.endsAt : item.endsAt
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${item.kind}-${item.id}@${UID_DOMAIN}`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART:${toIcsUtc(start)}`)
    lines.push(`DTEND:${toIcsUtc(end)}`)
    lines.push(`LAST-MODIFIED:${toIcsUtc(item.updatedAt)}`)
    lines.push(foldLine(`SUMMARY:${escapeIcsText(summary)}`))
    if (item.body) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(item.body)}`))
    if (item.place) lines.push(foldLine(`LOCATION:${escapeIcsText(item.place)}`))
    lines.push(foldLine(`URL:${base}${item.deepLink}`))
    lines.push(`CATEGORIES:${item.kind === 'card' ? 'TASK' : 'EVENT'}`)
    if (item.status === 'cancelled') lines.push('STATUS:CANCELLED')
    else if (item.kind === 'card' && item.status === 'done') lines.push('STATUS:CONFIRMED')
    else if (item.kind === 'event')
      lines.push(`STATUS:${partstatFor(item.status) === 'ACCEPTED' ? 'CONFIRMED' : 'TENTATIVE'}`)
    if (item.kind === 'event') lines.push(`X-DEVON-RSVP:${item.status}`)
    lines.push('TRANSP:OPAQUE')
    if (reminderMinutes !== null && reminderMinutes > 0 && item.status !== 'cancelled') {
      lines.push('BEGIN:VALARM')
      lines.push('ACTION:DISPLAY')
      lines.push(foldLine(`DESCRIPTION:${escapeIcsText(`${REMINDER_TEXT[locale]}: ${summary}`)}`))
      lines.push(`TRIGGER:-PT${reminderMinutes}M`)
      lines.push('END:VALARM')
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** One event as its own `.ics` attachment -- what "Yuklab olish (.ics)" on an event hands a person
 * whose calendar app does not do subscriptions. */
export function buildSingleEvent(
  item: CalendarItem,
  locale: CalendarLocale,
  publicUrl: string,
  now?: Date,
): string {
  return buildCalendar({
    items: [item],
    locale,
    publicUrl,
    reminderMinutes: 60,
    ...(now ? { now } : {}),
  })
}
