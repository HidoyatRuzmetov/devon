// Shared between `sprints-view.tsx` and `today-view.tsx` (a sprint's kind/status label and its
// default start/end range) -- kept in one place so the two screens never drift on wording.
import type { Sprint, SprintKind } from '../types.js'

export const SPRINT_KIND_LABEL_KEYS: Record<SprintKind, string> = {
  '3h': 'personal.sprints.kind.threeHour',
  day: 'personal.sprints.kind.day',
  week: 'personal.sprints.kind.week',
  custom: 'personal.sprints.kind.custom',
}

export function sprintKindHours(kind: SprintKind): number {
  return kind === '3h' ? 3 : kind === 'day' ? 24 : kind === 'week' ? 24 * 7 : 24
}

export function defaultSprintRange(kind: SprintKind): { startsAt: string; endsAt: string } {
  const start = new Date()
  const end = new Date(start.getTime() + sprintKindHours(kind) * 3_600_000)
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

/** A custom period keeps its chosen time box when unfinished work moves into the next period. */
export function rolloverSprintRange(
  sprint: Pick<Sprint, 'kind' | 'startsAt' | 'endsAt'>,
  now = Date.now(),
): { startsAt: string; endsAt: string } {
  const duration =
    sprint.kind === 'custom'
      ? Date.parse(sprint.endsAt) - Date.parse(sprint.startsAt)
      : sprintKindHours(sprint.kind) * 3_600_000
  return { startsAt: new Date(now).toISOString(), endsAt: new Date(now + duration).toISOString() }
}

/** 0-100, clamped -- how far a sprint has travelled from `startsAt` to `endsAt` at `now`. Used for
 * the sprint header's progress ring; a sprint whose time is up (>= 100) is what triggers the
 * rollover banner instead of the ring. */
export function sprintElapsedPct(
  sprint: Pick<Sprint, 'startsAt' | 'endsAt'>,
  now = Date.now(),
): number {
  const start = new Date(sprint.startsAt).getTime()
  const end = new Date(sprint.endsAt).getTime()
  if (end <= start) return 100
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
}

export function sprintHasEnded(sprint: Pick<Sprint, 'endsAt'>, now = Date.now()): boolean {
  return new Date(sprint.endsAt).getTime() <= now
}

/** A compact "2h 30m" / "3d 4h" countdown -- numerals plus a locale unit abbreviation, never a full
 * pluralised sentence (this codebase's `t()` is plain `{name}` interpolation, not CLDR plurals, same
 * convention `pomodoro.stats.minutesShort` already uses). */
export function formatTimeLeft(
  t: (key: string, params?: Record<string, string | number>) => string,
  ms: number,
): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  // ui-blitz round3 #21: a number glued straight to its unit ("34daq") reads as one broken token,
  // not two related ones -- every other number-plus-unit in the app (`formatNumber`,
  // `numberFlowLocale`) separates with U+00A0 (a non-breaking space, so the pair still can't wrap
  // apart mid-line) rather than a plain space or none at all; this is that same convention, just
  // never applied here when this file was written.
  const NBSP = ' '
  if (days > 0) {
    return `${days}${NBSP}${t('personal.duration.daysShort')} ${hours}${NBSP}${t('personal.duration.hoursShort')}`
  }
  if (hours > 0) {
    return `${hours}${NBSP}${t('personal.duration.hoursShort')} ${minutes}${NBSP}${t('personal.duration.minutesShort')}`
  }
  return `${minutes}${NBSP}${t('personal.duration.minutesShort')}`
}
