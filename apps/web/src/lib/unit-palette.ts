import { unitHueClass } from '@devon/ui'
import { createUnitColourIndices } from '@devon/contracts'

/** Resolve collisions against the complete department roster of units (including empty units).
 * Sorting IDs makes the result independent of API/list order and consistent across screens. The
 * first eight units get distinct existing design tokens; larger rosters repeat the palette and
 * retain names, boundaries and tooltips so colour is never their only identity. */
export function createUnitPalette(units: readonly { id: string }[]): ReadonlyMap<string, string> {
  return new Map([...createUnitColourIndices(units)].map(([id, index]) => [id, `bg-unit-${index}`]))
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
