import type { CheckinCycle } from '@devon/contracts'

/** Keep the reporting horizon visible before results exist. Placeholder periods are presentation
 * only: they never create a cycle, affect totals, or masquerade as a zero result. */
export function progressPeriods(cycles: readonly CheckinCycle[]): Array<{
  id: string
  startsOn: string
  endsOn: string
  cycle: CheckinCycle | null
}> {
  const ordered = [...cycles].sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  if (!ordered.length) return []
  const byDate = new Map(ordered.map((cycle) => [cycle.startsOn, cycle]))
  const first = Date.parse(ordered[0]!.startsOn + 'T00:00:00Z')
  const last = Date.parse(ordered.at(-1)!.startsOn + 'T00:00:00Z')
  const fortnight = 14 * 86400000
  // At least six months; retain every recorded period and three upcoming periods thereafter.
  const count = Math.max(13, Math.round((last - first) / fortnight) + 4)
  return Array.from({ length: count }, (_, index) => {
    const time = first + index * fortnight
    const startsOn = new Date(time).toISOString().slice(0, 10)
    const cycle = byDate.get(startsOn) ?? null
    return {
      id: cycle?.id ?? `future-${startsOn}`,
      startsOn,
      endsOn: cycle?.endsOn ?? new Date(time + 11 * 86400000).toISOString().slice(0, 10),
      cycle,
    }
  })
}
