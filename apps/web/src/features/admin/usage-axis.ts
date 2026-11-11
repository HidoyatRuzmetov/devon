import { formatMonthShort, isLocale } from '@devon/i18n'

type Period = { from: number; to: number; hour?: number }
type Tick = { position: number; label: string }
const dayMs = 86_400_000
const monday = 4 // 5 January 1970, the first Monday after Unix day zero.

/** Every tick is centered on an actual hourly, daily, weekly, monthly, quarterly, or annual
 * observation. A coarser graduation suppresses labels only; it never changes the time series. */
export function usageAxisTicks(buckets: readonly Period[], width: number, locale: string): Tick[] {
  if (!buckets.length || width <= 0) return []
  const language = isLocale(locale) ? locale : 'en'
  const dates = buckets.map((b) => new Date(b.from * dayMs))
  const maxDays = buckets.reduce((max, b) => Math.max(max, b.to - b.from + 1), 0)
  const acrossYears =
    dates[0]!.getUTCFullYear() !== new Date(buckets.at(-1)!.to * dayMs).getUTCFullYear()
  const startMonth = buckets[0]!.from - dates[0]!.getUTCDate() + 1
  const hourly = buckets[0]!.hour !== undefined
  const dayScale = maxDays <= 7
  const yearScale = maxDays > 92
  // Hours divide the clock. Longer day ranges graduate on Mondays. Monthly, quarterly and
  // annual series graduate at calendar boundaries and skip an initial clipped period.
  let steps: number[]
  if (hourly) steps = [1, 2, 3, 4, 6, 12, 24]
  else if (maxDays === 1) steps = [1, 2, 3, 7, 14, 28]
  else if (dayScale) steps = [7, 14, 28, 56, 112]
  else if (!yearScale) steps = maxDays > 31 ? [3, 6, 12, 24, 60, 120] : [1, 2, 3, 6, 12, 24, 60]
  else steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

  function isGraduation(index: number, step: number) {
    const b = buckets[index]!,
      date = dates[index]!
    if (hourly) return b.hour! % step === 0
    if (dayScale) return (b.from - (step >= 7 ? monday : startMonth)) % step === 0
    if (date.getUTCDate() !== 1) return false
    if (yearScale) return date.getUTCMonth() === 0 && date.getUTCFullYear() % step === 0
    return (12 * date.getUTCFullYear() + date.getUTCMonth()) % step === 0
  }
  function label(index: number, step: number) {
    const b = buckets[index]!,
      date = dates[index]!
    if (hourly) return String(b.hour).padStart(2, '0') + ':00'
    const year = date.getUTCFullYear()
    if (yearScale || (!dayScale && step >= 12)) return String(year)
    const month = formatMonthShort(date, language, 'UTC')
    if (!dayScale) return acrossYears ? month + ' ' + year : month
    const day = date.getUTCDate()
    const shortDate = language === 'en' ? month + ' ' + day : day + ' ' + month
    return acrossYears ? shortDate + ' ' + year : shortDate
  }
  const at = (i: number, step: number): Tick => ({
    position: (i + 0.5) / buckets.length,
    label: label(i, step),
  })
  const indices = dates.map((_, i) => i)
  for (const step of steps) {
    const marks = indices.filter((i) => isGraduation(i, step))
    if (marks.length === 0 || marks.length > 8) continue
    const ticks = marks.map((i) => at(i, step))
    let previousRight = -Infinity
    const fits = ticks.every((tick) => {
      // 11px tabular axis type. Allow for the widest labels across all four scripts and
      // for the end labels moving inward at either edge of the plot.
      const labelWidth = tick.label.length * 7
      const left = Math.max(0, Math.min(width - labelWidth, tick.position * width - labelWidth / 2))
      const clear = left >= previousRight + 14
      previousRight = left + labelWidth
      return clear
    })
    if (fits) return ticks
  }
  return [at(0, steps[0]!)]
}
