import type { UsageCounts, UsageMetric } from './usage-series.js'

export const usageAreaSamples = 193

// The harmonic mean gives a smooth tangent on a rising/falling run. A flat segment or
// change of direction needs a horizontal tangent to keep the cubic inside its endpoints.
function tangent(before: number, after: number) {
  return before * after > 0 ? (2 * before * after) / (before + after) : 0
}

function slopes(values: number[]) {
  return values.map((value, index) =>
    index > 0 && index + 1 < values.length
      ? tangent(value - values[index - 1]!, values[index + 1]! - value)
      : 0,
  )
}

function interpolate(from: number, to: number, leftSlope: number, rightSlope: number, t: number) {
  const u = 1 - t
  return from + (to - from) * t * t * (3 - 2 * t) + t * u * (u * leftSlope - t * rightSlope)
}

/** Upper boundaries, stacked bottom to top in the supplied department order. Samples sit
 * at x=1000*i/(usageAreaSamples-1); observations sit at the centers of equal-width buckets. */
export function stackUsageAreas(
  buckets: readonly { values: ReadonlyMap<string, UsageCounts> }[],
  departments: readonly { id: string }[],
  metric: UsageMetric,
  ceiling: number,
): { id: string; top: number[] }[] {
  const totals = Array<number>(buckets.length).fill(0)
  const combinedSlopes = Array<number>(buckets.length).fill(0)
  const layers = departments.map(({ id }) => {
    const values = buckets.map((bucket) => bucket.values.get(id)?.[metric] ?? 0)
    const derivatives = slopes(values)
    values.forEach((value, index) => {
      totals[index]! += value
      combinedSlopes[index]! += derivatives[index]!
    })
    return { id, values, derivatives }
  })

  // Opposing changes in different departments can otherwise produce a fictitious peak in
  // the total, even though each individual layer is monotone. Only reduce the tangents.
  const scale = slopes(totals).map((allowed, i) => {
    const combined = combinedSlopes[i]!
    return combined === 0 ? 1 : Math.max(0, Math.min(1, allowed / combined))
  })
  const cumulative = Array<number>(usageAreaSamples).fill(0)
  return layers.map(({ id, values, derivatives }) => {
    const top = cumulative.map((height, i) => {
      if (!values.length || ceiling <= 0) return 100
      const position = Math.max(
        0,
        Math.min(values.length - 1, (i * values.length) / (usageAreaSamples - 1) - 0.5),
      )
      const left = Math.floor(position)
      const right = Math.min(left + 1, values.length - 1)
      const thickness = interpolate(
        values[left]!,
        values[right]!,
        derivatives[left]! * scale[left]!,
        derivatives[right]! * scale[right]!,
        position - left,
      )
      cumulative[i] = height + thickness
      return Math.max(0, 100 - (100 * cumulative[i]!) / ceiling)
    })
    return { id, top }
  })
}
