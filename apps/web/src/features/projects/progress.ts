import type { Card } from '../work/api.js'

/** Same rule as the API rollup: equal task weight, checklist completion for unfinished tasks. */
export function taskProgress(
  cards: readonly Pick<Card, 'status' | 'doneAt' | 'checklistTotal' | 'checklistDone'>[],
): number {
  const included = cards.filter((card) => card.status !== 'archived' || card.doneAt !== null)
  if (included.length === 0) return 0
  return (
    included.reduce(
      (sum, card) =>
        sum +
        (card.status === 'done' || card.doneAt !== null
          ? 1
          : card.checklistTotal > 0
            ? card.checklistDone / card.checklistTotal
            : 0),
      0,
    ) / included.length
  )
}
