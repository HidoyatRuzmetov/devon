// CalDAV, read-only (v1.1 SPEC §10: "a CalDAV-lite read-only endpoint if feasible in time").
//
// It was feasible, so here it is -- deliberately the smallest subset that makes a real client (Apple
// Calendar, Thunderbird, DAVx⁵, Evolution) mount the calendar and keep it fresh:
//
//   OPTIONS   /caldav/<secret>/...              -> DAV: 1, 3, calendar-access
//   PROPFIND  /caldav/<secret>/                 -> principal: current-user-principal, calendar-home-set
//   PROPFIND  /caldav/<secret>/calendar/        -> the collection (Depth 0) or its items (Depth 1)
//   REPORT    /caldav/<secret>/calendar/        -> calendar-query and calendar-multiget
//   GET       /caldav/<secret>/calendar/<uid>.ics -> one VEVENT
//
// What it deliberately does NOT do, and why: no PUT/DELETE/MKCALENDAR (this calendar is a view of
// work that is decided in WorkPortal -- a card's due date moves when the card moves, not when a phone
// drags a block), no free/busy, no scheduling (iTIP/iMIP would mean sending mail on a civil servant's
// behalf), no sync-collection REPORT (a `getctag` change already makes every client re-read, and a
// real sync-token needs a change log this feature does not have). Anything not listed answers 403 or
// 405 rather than pretending.
//
// Authentication is the same feed secret as the ICS URL, carried in the path. Clients that insist on
// credentials may send anything as HTTP Basic; the username is accepted as the secret too, which is
// what makes bare-URL discovery (`/caldav/`) work in Apple Calendar.
//
// Pure string building, no Fastify: `test/unit/calendar.caldav.test.ts` asserts the XML.
import { buildCalendar, type CalendarItem, type CalendarLocale } from './ics.js'

export const DAV_HEADER = '1, 3, calendar-access'
export const XML_CONTENT_TYPE = 'application/xml; charset=utf-8'

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Every href this server hands out is absolute-path, never a full URL: a ministry box reached
 * through Caddy on one hostname and through a tunnel on another must not pin a client to whichever
 * one it happened to discover first. */
export function principalPath(base: string, secret: string): string {
  return `${base}/caldav/${encodeURIComponent(secret)}/`
}
export function calendarPath(base: string, secret: string): string {
  return `${base}/caldav/${encodeURIComponent(secret)}/calendar/`
}
export function itemPath(base: string, secret: string, item: CalendarItem): string {
  return `${calendarPath(base, secret)}${item.kind}-${item.id}.ics`
}

/** A weak ETag per item, derived from what actually changes it. Two reads of an unchanged item
 * produce the same value, which is what lets a client skip the body. */
export function itemEtag(item: CalendarItem): string {
  return `"${item.kind}-${item.updatedAt.getTime().toString(36)}"`
}

/** The collection tag every CalDAV client polls: change it and the client re-reads everything. The
 * newest `updated_at` in the collection is exactly the right value -- it moves when, and only when,
 * something in the calendar moved. */
export function collectionCtag(items: readonly CalendarItem[]): string {
  const newest = items.reduce((max, i) => Math.max(max, i.updatedAt.getTime()), 0)
  return `"ctag-${newest.toString(36)}-${items.length}"`
}

const MULTISTATUS_OPEN =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" ' +
  'xmlns:CS="http://calendarserver.org/ns/" xmlns:IC="http://apple.com/ns/ical/">'
const MULTISTATUS_CLOSE = '</D:multistatus>'

function response(href: string, propsXml: string, notFoundProps = ''): string {
  const found = `<D:propstat><D:prop>${propsXml}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`
  const missing = notFoundProps
    ? `<D:propstat><D:prop>${notFoundProps}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`
    : ''
  return `<D:response><D:href>${xmlEscape(href)}</D:href>${found}${missing}</D:response>`
}

/** PROPFIND on the principal: "who am I and where is my calendar". Apple Calendar asks for exactly
 * these two properties when a person types a bare server URL. */
export function principalPropfind(base: string, secret: string, displayName: string): string {
  const props =
    `<D:resourcetype><D:principal/></D:resourcetype>` +
    `<D:displayname>${xmlEscape(displayName)}</D:displayname>` +
    `<D:current-user-principal><D:href>${xmlEscape(principalPath(base, secret))}</D:href></D:current-user-principal>` +
    `<D:principal-URL><D:href>${xmlEscape(principalPath(base, secret))}</D:href></D:principal-URL>` +
    `<C:calendar-home-set><D:href>${xmlEscape(principalPath(base, secret))}</D:href></C:calendar-home-set>` +
    `<C:calendar-user-address-set><D:href>${xmlEscape(principalPath(base, secret))}</D:href></C:calendar-user-address-set>`
  return `${MULTISTATUS_OPEN}${response(principalPath(base, secret), props)}${MULTISTATUS_CLOSE}`
}

/** PROPFIND on the principal with `Depth: 1` -- the principal itself plus the one calendar
 * collection it holds. Most clients enumerate the home set this way rather than with a second
 * request, and answering both in one `multistatus` is what makes the mount a single round trip. */
export function homeSetPropfind(
  base: string,
  secret: string,
  displayName: string,
  items: readonly CalendarItem[],
): string {
  const principal = response(
    principalPath(base, secret),
    `<D:resourcetype><D:principal/><D:collection/></D:resourcetype>` +
      `<D:displayname>${xmlEscape(displayName)}</D:displayname>` +
      `<D:current-user-principal><D:href>${xmlEscape(principalPath(base, secret))}</D:href></D:current-user-principal>` +
      `<C:calendar-home-set><D:href>${xmlEscape(principalPath(base, secret))}</D:href></C:calendar-home-set>`,
  )
  const calendar = response(
    calendarPath(base, secret),
    calendarCollectionProps(base, secret, displayName, items),
  )
  return `${MULTISTATUS_OPEN}${principal}${calendar}${MULTISTATUS_CLOSE}`
}

function calendarCollectionProps(
  base: string,
  secret: string,
  displayName: string,
  items: readonly CalendarItem[],
): string {
  return (
    `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>` +
    `<D:displayname>${xmlEscape(displayName)}</D:displayname>` +
    `<D:current-user-principal><D:href>${xmlEscape(principalPath(base, secret))}</D:href></D:current-user-principal>` +
    // Read-only, said in the vocabulary a client actually checks before offering an "add event"
    // button. A client that ignores this and PUTs anyway gets a 403 from the route itself.
    `<D:current-user-privilege-set><D:privilege><D:read/></D:privilege></D:current-user-privilege-set>` +
    `<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>` +
    `<C:calendar-description>${xmlEscape(displayName)}</C:calendar-description>` +
    `<C:calendar-timezone>Asia/Tashkent</C:calendar-timezone>` +
    `<CS:getctag>${collectionCtag(items)}</CS:getctag>` +
    `<IC:calendar-color>#1b4a76</IC:calendar-color>` +
    `<D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>`
  )
}

/** PROPFIND on the calendar collection. `Depth: 0` describes the collection; `Depth: 1` adds one
 * `<response>` per item carrying its etag, which is how a client works out what to fetch. */
export function calendarPropfind(
  base: string,
  secret: string,
  displayName: string,
  items: readonly CalendarItem[],
  depth: '0' | '1',
): string {
  const parts = [
    response(calendarPath(base, secret), calendarCollectionProps(base, secret, displayName, items)),
  ]
  if (depth === '1') {
    for (const item of items) {
      parts.push(
        response(
          itemPath(base, secret, item),
          `<D:getetag>${itemEtag(item)}</D:getetag>` +
            `<D:getcontenttype>text/calendar; charset=utf-8; component=VEVENT</D:getcontenttype>` +
            `<D:resourcetype/>`,
        ),
      )
    }
  }
  return `${MULTISTATUS_OPEN}${parts.join('')}${MULTISTATUS_CLOSE}`
}

/** REPORT: `calendar-query` (give me everything, optionally in a window) and `calendar-multiget`
 * (give me these hrefs). Both answer with the item's own `calendar-data`, which is a one-VEVENT
 * VCALENDAR built by the same `ics.ts` the subscription URL uses -- one formatter, two transports. */
export function calendarReport(
  base: string,
  secret: string,
  items: readonly CalendarItem[],
  locale: CalendarLocale,
  publicUrl: string,
  wantedHrefs: readonly string[] | null,
): string {
  const selected =
    wantedHrefs === null
      ? items
      : items.filter((item) =>
          wantedHrefs.some((href) => href.endsWith(`${item.kind}-${item.id}.ics`)),
        )
  const parts = selected.map((item) =>
    response(
      itemPath(base, secret, item),
      `<D:getetag>${itemEtag(item)}</D:getetag>` +
        `<C:calendar-data>${xmlEscape(
          buildCalendar({ items: [item], locale, publicUrl, reminderMinutes: null }),
        )}</C:calendar-data>`,
    ),
  )
  return `${MULTISTATUS_OPEN}${parts.join('')}${MULTISTATUS_CLOSE}`
}

/** The two things this module needs out of a REPORT body, extracted without an XML parser
 * dependency: which report it is, and (for `calendar-multiget`) which hrefs it asks for. A request
 * body this simple does not justify pulling a parser into a government codebase's dependency tree,
 * and anything unrecognised falls back to "the whole collection", which is always a correct -- if
 * larger -- answer to a query. */
export function parseReport(body: string): {
  kind: 'calendar-query' | 'calendar-multiget' | 'unknown'
  hrefs: string[] | null
} {
  const isMultiget = /calendar-multiget/i.test(body)
  const isQuery = /calendar-query/i.test(body)
  if (isMultiget) {
    const hrefs = [...body.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/gi)].map((m) =>
      m[1]!.trim(),
    )
    return { kind: 'calendar-multiget', hrefs: hrefs.length > 0 ? hrefs : [] }
  }
  if (isQuery) return { kind: 'calendar-query', hrefs: null }
  return { kind: 'unknown', hrefs: null }
}

/** `Depth` header -> what we will actually do. `infinity` is refused by collapsing to `1`: this
 * collection is one level deep, so there is nothing deeper to walk and no way to make the server
 * work harder by asking for it. */
export function normaliseDepth(header: string | undefined): '0' | '1' {
  return header === '0' ? '0' : '1'
}

/** A Basic credential whose *username* is the feed secret, for clients that discover from a bare
 * `/caldav/` URL and insist on a login box. Returns null for anything else. */
export function secretFromBasicAuth(header: string | undefined): string | null {
  if (!header || !/^basic /i.test(header)) return null
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
    const username = decoded.split(':')[0] ?? ''
    return username.length >= 16 ? username : null
  } catch {
    return null
  }
}
