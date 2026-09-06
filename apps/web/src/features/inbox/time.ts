// Pure helpers for the quiet-hours time inputs (TECH-SPEC §7): the API speaks minutes-since-midnight
// (0-1439), `<input type="time">` speaks `"HH:MM"` strings -- converting between the two has no
// dependency on React or the API client, so it is its own file and its own test
// (`apps/web/test/unit/inbox-time.test.ts`), same reasoning `src/lib/greeting.ts` gives for keeping
// pure date logic out of the component that renders it.
const MINUTES_PER_DAY = 24 * 60

/** `"HH:MM"` (24-hour, zero-padded) for a minutes-since-midnight value, for `<input type="time">`'s
 * `value` prop. `null` (no override set) renders the input empty. */
export function minutesToTimeInput(minutes: number | null): string {
  if (minutes === null) return ''
  const clamped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hh = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0')
  const mm = (clamped % 60).toString().padStart(2, '0')
  return `${hh}:${mm}`
}

/** The inverse of `minutesToTimeInput` -- `<input type="time">`'s `onChange` value back to
 * minutes-since-midnight. `""` (cleared input) and anything that does not parse as `HH:MM` become
 * `null` (the caller then falls back to the department default, exactly like an explicit clear). */
export function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (hh > 23 || mm > 59) return null
  return hh * 60 + mm
}

/** `"08:00–" + "20:00"` style range for display (department-default hint, quiet-hours summary).
 * `wrapsMidnight` (department default is 20:00 -> 08:00, i.e. `end < start`) still renders as a plain
 * start–end pair -- that is the correct reading for a quiet window that crosses midnight. */
export function formatMinuteRange(startMinute: number, endMinute: number): string {
  return `${minutesToTimeInput(startMinute)}–${minutesToTimeInput(endMinute)}`
}
