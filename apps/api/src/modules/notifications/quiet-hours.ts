// Pure quiet-hours math (TECH-SPEC §7: "department default 20:00-08:00 + weekends, personal override
// to quieter"). Kept dependency-free (no Date-with-timezone library, no DB) so it is unit-testable
// without a clock or a database -- the caller resolves "now" in the department's own timezone
// (`app.departments.timezone`, Asia/Tashkent for every demo department) into the two primitives this
// module actually needs: a minute-of-day and a weekend flag.
export type QuietWindow = {
  startMinute: number // 0-1439, minutes since local midnight
  endMinute: number // 0-1439; endMinute < startMinute means the window wraps past midnight
  includeWeekends: boolean
}

export type PersonalQuietOverride = {
  startMinute: number | null
  endMinute: number | null
  includeWeekends: boolean | null
}

/** Total minutes/day the window covers -- a wrap-past-midnight window (e.g. 20:00-08:00 = 720min) is
 * `1440 - start + end`; a same-day window (e.g. 13:00-14:00) is `end - start`. */
export function quietMinutesPerDay(w: Pick<QuietWindow, 'startMinute' | 'endMinute'>): number {
  return w.endMinute > w.startMinute
    ? w.endMinute - w.startMinute
    : 1440 - w.startMinute + w.endMinute
}

/**
 * "Personal override to quieter" (TECH-SPEC §7), made concrete: a personal window is accepted only
 * when it suppresses at least as much as the department default -- at least as many quiet minutes per
 * day, and weekend quiet turned on whenever the department already turns it on (a person may add
 * weekend quiet the department does not have; they may never remove quiet the department guarantees).
 * This is a coarser rule than "the department's window is a sub-interval of the personal one" -- kept
 * coarse deliberately: two numbers a person can reason about ("at least as many quiet hours, and never
 * less coverage on weekends") beats an interval-containment rule nobody screenshots correctly.
 */
export function isQuieterOrEqual(candidate: QuietWindow, departmentDefault: QuietWindow): boolean {
  if (quietMinutesPerDay(candidate) < quietMinutesPerDay(departmentDefault)) return false
  if (departmentDefault.includeWeekends && !candidate.includeWeekends) return false
  return true
}

/** `null` fields inherit the department default field-by-field (TECH-SPEC §7); a fully-`null`
 * override is exactly "use the department default". */
export function resolveEffectiveQuietWindow(
  personal: PersonalQuietOverride | null,
  departmentDefault: QuietWindow,
): QuietWindow & { source: 'personal' | 'department_default' } {
  if (
    !personal ||
    (personal.startMinute === null &&
      personal.endMinute === null &&
      personal.includeWeekends === null)
  ) {
    return { ...departmentDefault, source: 'department_default' }
  }
  return {
    startMinute: personal.startMinute ?? departmentDefault.startMinute,
    endMinute: personal.endMinute ?? departmentDefault.endMinute,
    includeWeekends: personal.includeWeekends ?? departmentDefault.includeWeekends,
    source: 'personal',
  }
}

/** `minuteOfDay`: 0-1439, local time in the department's timezone. `isWeekend`: Friday evening onward
 * counts as the weekend's start only via `includeWeekends` gating the whole day -- callers pass
 * Saturday/Sunday's `isWeekend = true` (Uzbekistan's week: Saturday-Sunday), not Friday. */
export function isWithinQuietHours(
  minuteOfDay: number,
  isWeekend: boolean,
  window: QuietWindow,
): boolean {
  if (isWeekend && window.includeWeekends) return true
  const wraps = window.endMinute <= window.startMinute
  return wraps
    ? minuteOfDay >= window.startMinute || minuteOfDay < window.endMinute
    : minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute
}

export const DEPARTMENT_QUIET_DEFAULT: QuietWindow = {
  startMinute: 20 * 60,
  endMinute: 8 * 60,
  includeWeekends: true,
}
