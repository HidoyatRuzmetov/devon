// "Add to calendar" links (v1.1 SPEC §10). Pure URL building, unit-tested, shared by the API
// response and -- through the same shapes -- by the web feature's menu.
//
// Why the API builds them rather than the browser: the four services disagree about date format
// (Google wants compact UTC with a `/` separator, Outlook wants ISO), about which parameter carries
// the description, and about how much of it they will keep. Getting that wrong is invisible until
// somebody's meeting lands an hour out, so it is written once, here, with tests.
import { toIcsUtc } from './ics.js'

export type AddToCalendarInput = {
  title: string
  description: string
  place: string
  startsAt: Date
  endsAt: Date
  /** Absolute URL back into WorkPortal, appended to the description so the invitation is traceable
   * to the event it came from. */
  eventUrl: string
}

function googleDates(start: Date, end: Date): string {
  return `${toIcsUtc(start)}/${toIcsUtc(end)}`
}

export function googleCalendarUrl(input: AddToCalendarInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: googleDates(input.startsAt, input.endsAt),
    details: `${input.description}\n\n${input.eventUrl}`.trim(),
    location: input.place,
    ctz: 'Asia/Tashkent',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function outlookUrl(host: string, input: AddToCalendarInput): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: input.title,
    body: `${input.description}\n\n${input.eventUrl}`.trim(),
    location: input.place,
    startdt: input.startsAt.toISOString(),
    enddt: input.endsAt.toISOString(),
  })
  return `https://${host}/calendar/0/deeplink/compose?${params.toString()}`
}

/** Personal Outlook.com. */
export function outlookLiveUrl(input: AddToCalendarInput): string {
  return outlookUrl('outlook.live.com', input)
}

/** Work/school Microsoft 365 -- the one a ministry laptop is actually signed into. */
export function office365Url(input: AddToCalendarInput): string {
  return outlookUrl('outlook.office.com', input)
}

export function yahooCalendarUrl(input: AddToCalendarInput): string {
  const params = new URLSearchParams({
    v: '60',
    title: input.title,
    st: toIcsUtc(input.startsAt),
    et: toIcsUtc(input.endsAt),
    desc: `${input.description}\n\n${input.eventUrl}`.trim(),
    in_loc: input.place,
  })
  return `https://calendar.yahoo.com/?${params.toString()}`
}
