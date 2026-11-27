import type { MemberSummary } from '../api.js'

/** Resolve a typed @mention against department members. */
export function resolveMentionMember(
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
