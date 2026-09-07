// Groups the Pomodoro session log by calendar day (`pomodoro-panel.tsx`'s log section, package
// report item 40): "13 rows of `09:00 - 09:30`" with no day separator read as the same times
// repeating when a user has run the timer on more than one day. Uses the browser's local calendar
// day, the same convention `formatClock` in `pomodoro-panel.tsx` already uses for the per-row clock
// (`d.getHours()`/`d.getMinutes()`, not a Tashkent-specific read) -- a session a civil servant ran
// "this morning" should group under "Bugun" on their own clock, not the department's timezone.
import type { PomodoroSession } from '../types.js'

export type PomodoroLogGroup = {
  /** A stable per-day key (`toDateString()`), not shown -- only used for grouping/dedup. */
  key: string
  /** Any moment inside the group's day, for the caller to format into a heading. */
  date: Date
  sessions: readonly PomodoroSession[]
}

function dayKey(d: Date): string {
  return d.toDateString()
}

/** Sessions in, most-recent-first day groups out (each group's own sessions keep the order they
 *  arrived in, which is already newest-first from the API). */
export function groupSessionsByDay(sessions: readonly PomodoroSession[]): PomodoroLogGroup[] {
  const groups: PomodoroLogGroup[] = []
  const byKey = new Map<string, PomodoroLogGroup>()
  for (const session of sessions) {
    const date = new Date(session.startedAt)
    const key = dayKey(date)
    let group = byKey.get(key)
    if (!group) {
      group = { key, date, sessions: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    ;(group.sessions as PomodoroSession[]).push(session)
  }
  return groups
}

/** "Bugun" / "Kecha" / `null` (caller falls back to `formatDate`) -- relative only for the two days
 *  a person actually thinks of relatively; anything older reads better as a real date than a vague
 *  "3 kun oldin". */
export function relativeDayLabelKey(
  date: Date,
  now: Date = new Date(),
): 'today' | 'yesterday' | null {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  return null
}

/** Whole minutes between `startedAt` and `endedAt`; `null` while a session has no end yet (still
 *  running, or abandoned without ever being closed out) so the caller can render a dash instead of a
 *  misleading "0 daq". */
export function sessionDurationMin(
  session: Pick<PomodoroSession, 'startedAt' | 'endedAt'>,
): number | null {
  if (!session.endedAt) return null
  const ms = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
  if (ms <= 0) return null
  return Math.round(ms / 60_000)
}
