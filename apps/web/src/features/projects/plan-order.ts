import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/** Reuse the project's occupied ranks when possible. Other cards keep their ranks and relative
 * order; legacy tied ranks get valid fractional keys instead of the old, invalid p0000 format. */
export function projectPlanRanks(
  items: readonly { id: string; orderKey: string }[],
  orderedIds: readonly string[],
): { id: string; orderKey: string }[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const ids = [...new Set(orderedIds)].filter((id) => byId.has(id))
  const slots = ids.map((id) => byId.get(id)!.orderKey).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  let valid = new Set(slots).size === slots.length
  try {
    for (const slot of slots) generateKeyBetween(slot, null)
  } catch {
    valid = false
  }
  const ranks = valid ? slots : generateNKeysBetween(null, null, ids.length)
  return ids.map((id, index) => ({ id, orderKey: ranks[index]! }))
}
