export type UsageMetric = 'tokens' | 'costUzs' | 'runs'
export type UsageCounts = Record<UsageMetric, number>
export type DailyUsage = UsageCounts & { day: string; departmentId: string }
export type HourlyUsage = UsageCounts & { hour: number; departmentId: string }
export type DayRange = { from: number; to: number }
type Bucket = DayRange & { hour?: number; values: Map<string, UsageCounts> }
const dayMs = 86_400_000
export const dayNumber = (value: string) => Math.floor(Date.parse(value + 'T00:00:00Z') / dayMs)
export const isoDay = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10)
export const clampDay = (day: number, min: number, max: number) => Math.max(min, Math.min(max, day))
export const zeroUsage = (): UsageCounts => ({ tokens: 0, costUzs: 0, runs: 0 })
export function addUsage(total: UsageCounts, point: UsageCounts) {
  total.tokens += point.tokens
  total.costUzs += point.costUzs
  total.runs += point.runs
}
export function monthRange(month: string, today: number): DayRange {
  const from = dayNumber(month + '-01')
  const date = new Date(from * dayMs)
  return {
    from,
    to: Math.min(today, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0) / dayMs),
  }
}
export function summarizeUsage(days: DailyUsage[], range: DayRange) {
  const totals = new Map<string, UsageCounts>()
  const from = isoDay(range.from),
    to = isoDay(range.to)
  for (const row of days) {
    if (row.day < from || row.day > to) continue
    const counts = totals.get(row.departmentId) ?? zeroUsage()
    addUsage(counts, row)
    totals.set(row.departmentId, counts)
  }
  return totals
}
export function usageBuckets(days: DailyUsage[], range: DayRange, hours?: HourlyUsage[]) {
  const span = range.to - range.from + 1
  const buckets: Bucket[] = []
  if (hours) {
    for (let hour = 0; hour < 24; hour++) buckets.push({ ...range, hour, values: new Map() })
    for (const point of hours) buckets[point.hour]?.values.set(point.departmentId, point)
    return buckets
  }
  // Calendar-aligned buckets make adjacent months and partial weeks auditable when brushing.
  const monthsPerBucket = span <= 1_100 ? 1 : span <= 3_285 ? 3 : 12
  for (let from = range.from; from <= range.to; ) {
    const date = new Date(from * dayMs)
    let next = from + 1
    if (span > 140) {
      const month = Math.floor(date.getUTCMonth() / monthsPerBucket) * monthsPerBucket
      next = Date.UTC(date.getUTCFullYear(), month + monthsPerBucket, 1) / dayMs
    } else if (span > 42) {
      next = from + 7 - ((date.getUTCDay() + 6) % 7)
    }
    buckets.push({ from, to: Math.min(next - 1, range.to), values: new Map() })
    from = next
  }
  for (const point of days) {
    const day = dayNumber(point.day)
    if (day < range.from || day > range.to) continue
    let lo = 0,
      hi = buckets.length - 1
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (buckets[mid]!.to < day) lo = mid + 1
      else hi = mid
    }
    const values = buckets[lo]!.values
    const counts = values.get(point.departmentId) ?? zeroUsage()
    addUsage(counts, point)
    values.set(point.departmentId, counts)
  }
  return buckets
}
export function overviewPath(
  days: DailyUsage[],
  domain: DayRange,
  metric: UsageMetric,
  selected: string | null,
) {
  const size = Math.min(196, domain.to - domain.from + 1)
  const values = Array<number>(size).fill(0)
  for (const day of days) {
    if (selected && day.departmentId !== selected) continue
    const index = Math.floor(
      ((dayNumber(day.day) - domain.from) * size) / (domain.to - domain.from + 1),
    )
    if (index >= 0 && index < size) values[index]! += day[metric]
  }
  const max = Math.max(1, ...values)
  const heights = values.map((value) => 38 - (value / max) * 32)
  const width = 1000 / size
  let path = `M0,40 V${heights[0]} H${width / 2}`
  for (let i = 1; i < size; i++) {
    const middle = i * width
    path += ` C${middle},${heights[i - 1]} ${middle},${heights[i]} ${middle + width / 2},${heights[i]}`
  }
  return path + ' H1000 V40 Z'
}
