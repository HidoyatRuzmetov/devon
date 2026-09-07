// CSV export (TECH-SPEC §9: "exports CSV/PNG") -- PNG is a client-side snapshot of the rendered chart
// (`apps/web/src/features/analytics/export.ts`), but CSV is the underlying series, which only the
// server actually has computed; this file turns one chart's slice of `SummaryResult` into a CSV text
// body. No dependency: RFC 4180 quoting for the handful of string fields these rows ever carry.
import type { AnalyticsChartKey } from './schemas.js'
import type { SummaryResult } from './repo.js'

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRows(
  header: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return lines.join('\r\n') + '\r\n'
}

export function summaryChartToCsv(chartKey: AnalyticsChartKey, summary: SummaryResult): string {
  switch (chartKey) {
    case 'throughput':
      return csvRows(
        ['week_start', 'cards_done'],
        summary.throughput.map((p) => [p.weekStart, p.count]),
      )
    case 'onTimeRate':
      return csvRows(
        ['week_start', 'due_count', 'on_time_count'],
        summary.onTimeRate.series.map((p) => [p.weekStart, p.dueCount, p.onTimeCount]),
      )
    case 'openVsOverdue':
      return csvRows(
        ['week_start', 'open_count', 'overdue_count'],
        summary.openVsOverdue.map((p) => [p.weekStart, p.openCount, p.overdueCount]),
      )
    case 'loadPerPerson':
      return csvRows(
        ['name', 'open_count', 'overdue_count'],
        summary.loadPerPerson.map((p) => [p.name, p.openCount, p.overdueCount]),
      )
    case 'loadPerUnit':
      return csvRows(
        ['unit_name', 'open_count', 'overdue_count'],
        summary.loadPerUnit.map((p) => [p.unitName ?? '(unassigned)', p.openCount, p.overdueCount]),
      )
    case 'projectProgress':
      return csvRows(
        ['title', 'status', 'total_tasks', 'done_tasks', 'progress_pct'],
        summary.projectProgress.map((p) => [
          p.title,
          p.status,
          p.totalTasks,
          p.doneTasks,
          Math.round(p.progress * 100),
        ]),
      )
    case 'eventsParticipation':
      return csvRows(
        ['title', 'starts_at', 'yes', 'no', 'maybe', 'waitlist', 'rsvp_rate_pct'],
        summary.eventsParticipation.map((p) => [
          p.title,
          p.startsAt.toISOString(),
          p.yes,
          p.no,
          p.maybe,
          p.waitlist,
          Math.round(p.rsvpRate * 100),
        ]),
      )
    case 'pollTurnout':
      return csvRows(
        ['question', 'status', 'voters', 'turnout_rate_pct'],
        summary.pollTurnout.map((p) => [
          p.question,
          p.status,
          p.voters,
          Math.round(p.turnoutRate * 100),
        ]),
      )
    case 'personal':
      return csvRows(
        ['metric', 'value'],
        [
          ['open_count', summary.personal.openCount],
          ['overdue_count', summary.personal.overdueCount],
          ['done_this_week', summary.personal.doneThisWeek],
          [
            'on_time_rate_pct',
            summary.personal.onTimeRate === null
              ? ''
              : Math.round(summary.personal.onTimeRate * 100),
          ],
          ['focus_minutes_this_week', summary.personal.focusMinutesThisWeek],
          ['upcoming_event_count', summary.personal.upcomingEventCount],
        ],
      )
  }
}
