// v1.1 SPEC §7 (A3) -- rendering an estimate / a logged duration, shared by the card sheet, the
// tile chip, the table cell, the workload grid and the bulk bar.
//
// The *parsing* half lives in `@devon/contracts` (`parseEstimateMinutes`), because the server has to
// understand the same four locales' words the field accepts. The *formatting* half is here, because
// "2 soat 30 daqiqa" / "2 ч 30 мин" / "2h 30m" are three sentences, not one template
// (DESIGN.md §2.3) -- so the caller's `t()` supplies the words and this file only decides which
// words are needed.
import { minutesToHours, splitEstimateMinutes } from '@devon/contracts'

type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * `"2 soat 30 daqiqa"`, `"45 daqiqa"`, `"3 soat"` -- the hour part is dropped when it is zero and the
 * minute part when it is, so a round estimate never reads "3 soat 0 daqiqa".
 *
 * Returns `''` for zero/negative, which every caller treats as "no estimate" rather than rendering
 * a chip that says nothing.
 */
export function formatDuration(totalMinutes: number, t: Translate): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return ''
  const { hours, minutes } = splitEstimateMinutes(totalMinutes)
  const parts: string[] = []
  if (hours > 0) parts.push(t('work.estimate.unitHour', { count: hours }))
  if (minutes > 0) parts.push(t('work.estimate.unitMinute', { count: minutes }))
  return parts.join(' ')
}

/** The compact form a chip on a board tile has room for: `"2s 30d"` in uz-Latn, `"2ч 30м"` in ru,
 * `"2h 30m"` in en. Same drop-the-zero rule as `formatDuration`. */
export function formatDurationShort(totalMinutes: number, t: Translate): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return ''
  const { hours, minutes } = splitEstimateMinutes(totalMinutes)
  const parts: string[] = []
  if (hours > 0) parts.push(t('work.estimate.shortHour', { count: hours }))
  if (minutes > 0) parts.push(t('work.estimate.shortMinute', { count: minutes }))
  return parts.join(' ')
}

/** Hours to one decimal, the unit the workload grid and the people table's "Yuklama" column count
 * in. `12` rather than `12.0`, because a trailing `.0` in a dense grid is noise. */
export function formatHours(minutes: number, t: Translate): string {
  const hours = minutesToHours(minutes)
  return t('work.estimate.unitHourShort', { count: formatHoursNumber(hours) })
}

/** `12`, `12.5` -- never `12.0`. Exported because the workload grid renders a bare number in a cell
 * (with the unit in the column header) and needs the same rounding the chip uses. */
export function formatHoursNumber(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
