import { fetchCards, type Card } from './api.js'

/** The picker filters literal titles locally. Publish only a complete department list so a
 * refused later page never looks like a successful empty search. */
export async function fetchDependencyCandidates(): Promise<Card[]> {
  const cards = new Map<string, Card>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    // nosemgrep: query-in-loop -- This page supplies the next cursor; a refusal must stop traversal before publishing any partial list.
    const page = await fetchCards({ limit: 100, cursor })
    for (const card of page.items) cards.set(card.id, card)
    if (page.nextCursor === null) return [...cards.values()]
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('Card pagination did not advance')
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
}
