import { unitHueClass } from '@devon/ui'

/** Resolve collisions against the complete department roster of units (including empty units).
 * Sorting IDs makes the result independent of API/list order and consistent across screens. The
 * first eight units get distinct existing design tokens; larger rosters repeat the palette and
 * retain names, boundaries and tooltips so colour is never their only identity. */
export function createUnitPalette(units: readonly { id: string }[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  const occupied = new Set<number>()
  for (const id of [...new Set(units.map((unit) => unit.id))].sort()) {
    const base = Number(unitHueClass(id).slice(-1)) - 1
    let index = base
    if (occupied.size < 8) {
      while (occupied.has(index)) index = (index + 1) % 8
      occupied.add(index)
    }
    result.set(id, `bg-unit-${index + 1}`)
  }
  return result
}

export function unitColorClass(
  palette: ReadonlyMap<string, string>,
  unitId: string | null | undefined,
  isHead = false,
): string {
  return unitId
    ? (palette.get(unitId) ?? unitHueClass(unitId))
    : isHead
      ? 'bg-primary'
      : 'bg-muted-foreground'
}
