/** The same categorical colour indices for portal boards and public projections. */
export function unitHueIndex(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return (hash % 8) + 1
}

export function createUnitColourIndices(
  units: readonly { id: string }[],
): ReadonlyMap<string, number> {
  const result = new Map<string, number>()
  const occupied = new Set<number>()
  for (const id of [...new Set(units.map((unit) => unit.id))].sort()) {
    let index = unitHueIndex(id)
    if (occupied.size < 8) {
      while (occupied.has(index)) index = (index % 8) + 1
      occupied.add(index)
    }
    result.set(id, index)
  }
  return result
}
