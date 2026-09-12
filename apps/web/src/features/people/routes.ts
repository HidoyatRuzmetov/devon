// Where the person page lives, in one place.
//
// `apps/web/src/lib/router.tsx` matches **exact paths only** -- its own header documents that
// tradeoff, and `features/registry.ts`'s `matchFeatureRoute` is a straight `path === pathname`. So
// SPEC §6's `/people/:userId` is expressed the way every other detail view in this product already
// is (`/work?card=…`, `/department?id=…`, `/events?event=…`): the directory route carries the person
// as a search param, and the shell's own router change (a real param-bearing router is
// `@tanstack/react-router`, pinned in TECH-SPEC §1.2 for exactly this) can later redirect the
// canonical path here without touching a single call site -- because every call site is this file.
//
// `/people/me` IS an exact path, so a xodim's own profile gets the real URL SPEC §6 asks for.
export const PERSON_PARAM = 'person'

export const MY_PROFILE_PATH = '/people/me'

export function personPath(userId: string): string {
  return `/people?${PERSON_PARAM}=${encodeURIComponent(userId)}`
}

/** The person id a `/people` URL is pointing at, or `null` for the plain directory. */
export function personIdFromSearch(search: URLSearchParams): string | null {
  const raw = search.get(PERSON_PARAM)
  return raw && raw.length > 0 ? raw : null
}

/**
 * "Open board column" (SPEC §4.3 row action, §6 person-page action).
 *
 * The board is one column per person and reads exactly one search param, `q`, through the shared
 * filter grammar (`features/work/components/board-screen.tsx`'s `findMemberMatches` resolves an
 * `assignee:` token by matching it against each member's given *or* family name). So the honest deep
 * link is that grammar with the surname in it -- not an invented `?person=<uuid>` the board has never
 * read, which is what this used to send and which silently did nothing.
 */
export function boardColumnPath(person: { familyName: string; givenName: string }): string {
  const needle = person.familyName.trim() || person.givenName.trim()
  return `/work?q=${encodeURIComponent(`assignee:"${needle}"`)}`
}
