// Quick-add bar parsing (TECH-SPEC §5, EPIC-004): `"Nodira: EGDI paketi, juma"` -> a card titled
// "EGDI paketi" assigned to whichever member's name matches "Nodira", due the next Friday. Pure,
// synchronous, dependency-free beyond `@devon/contracts`' `resolveDateWord` (already shared with the
// server's filter grammar for the exact same "uz/ru/en weekday and today/tomorrow words" rules --
// TECH-SPEC §4) -- unit-testable without a member list, a clock mock, or any I/O.
//
// Grammar (deliberately small, Linear-quick-add-style): `[Name: ]title[, date-word]`. Either the
// leading `Name:` or the trailing `, date-word` may be omitted; a title alone ("Hisobotni tugatish")
// still creates a card, just unassigned and with no due date.
import { resolveDateWord } from '@devon/contracts'
import type { MemberSummary } from '../api.js'

export type QuickAddParsed = {
  /** Raw text before the first `:` (trimmed), or `null` if the input has no leading `Name:` prefix. */
  assigneeToken: string | null
  /** Everything after the assignee prefix and before a trailing recognised date word. */
  title: string
  /** Resolved from the trailing `, <date word>` segment, or `null` if there was none / it didn't
   * resolve to a known word. Midnight local time on the resolved calendar date. */
  dueAt: Date | null
}

/** A `Name:` prefix is only ever a short label a person just typed, never a URL's scheme separator or
 * a title that happens to contain a colon further in -- capped so `"https://example.com: notes"`
 * doesn't get its scheme mistaken for a name. */
const MAX_ASSIGNEE_PREFIX_LENGTH = 40

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddParsed {
  const trimmed = input.trim()

  let assigneeToken: string | null = null
  let body = trimmed
  const colonIndex = trimmed.indexOf(':')
  if (colonIndex > 0 && colonIndex <= MAX_ASSIGNEE_PREFIX_LENGTH) {
    const candidate = trimmed.slice(0, colonIndex).trim()
    // A bare "http" / "https" before the colon is a URL scheme, not a name -- never split there.
    if (candidate.length > 0 && !/^https?$/i.test(candidate)) {
      assigneeToken = candidate
      body = trimmed.slice(colonIndex + 1).trim()
    }
  }

  let title = body
  let dueAt: Date | null = null
  const lastComma = body.lastIndexOf(',')
  if (lastComma !== -1) {
    const tail = body.slice(lastComma + 1).trim()
    const resolved = tail.length > 0 ? resolveDateWord(tail, now) : null
    if (resolved) {
      dueAt = resolved
      title = body.slice(0, lastComma).trim()
    }
  }

  return { assigneeToken, title, dueAt }
}

/** Every member whose given or family name contains `token` (case-insensitive, diacritics-as-typed --
 * matches the same convention `apps/api/src/modules/work/index.ts`'s `resolveUserIds` already uses
 * for the filter grammar's `assignee:`/`giver:` tokens, so a quick-add name and a filter-bar name
 * resolve the same set of people). `token` may carry a leading `@` (from someone used to the filter
 * bar's `assignee:@nodira` form); it is stripped before matching. */
export function resolveQuickAddAssignee(
  token: string,
  members: readonly MemberSummary[],
): MemberSummary | null {
  const needle = token.replace(/^@/, '').trim().toLowerCase()
  if (needle.length === 0) return null
  const matches = members.filter(
    (m) =>
      m.givenName.toLowerCase().includes(needle) || m.familyName.toLowerCase().includes(needle),
  )
  // An exact given-name match wins over a mere substring match (e.g. "Nodira" over "Nodirabegim").
  const exact = matches.find((m) => m.givenName.toLowerCase() === needle)
  return exact ?? matches[0] ?? null
}
