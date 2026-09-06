// Timeline view (TECH-SPEC §5: "timeline (SVG)") -- a Jira/Linear-style Gantt: one row per member,
// a horizontal bar per card from its start date (falling back to created date) to its due date, over
// a fixed 8-week window centred on today. Hand-drawn SVG rather than a charting library -- this is
// the one shape (`artifact-diagramming`'s own advice, applied here even though this is product code,
// not an artifact) simple enough that a dependency would cost more than it saves.
import * as React from 'react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Skeleton, StateView } from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { useCardsQuery, useMembers } from '../hooks.js'
import { openCardPeek, CardPeekDialog } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'

const DAY_MS = 86_400_000
const WINDOW_DAYS_BEFORE = 14
const WINDOW_DAYS_AFTER = 42
const ROW_HEIGHT = 36
const LABEL_WIDTH = 160
const CHART_WIDTH = 960

const PRIORITY_FILL: Record<string, string> = {
  urgent: 'var(--color-destructive)',
  high: 'var(--color-attention)',
  medium: 'var(--color-warning)',
  low: 'var(--color-muted-foreground)',
  none: 'var(--color-muted-foreground)',
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export default function TimelineScreen() {
  const t = useT()
  const locale = useLocale()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const cardsQuery = useCardsQuery({ q: q || undefined, limit: 200 })
  const members = useMembers()

  const today = startOfDay(new Date())
  const rangeStart = new Date(today.getTime() - WINDOW_DAYS_BEFORE * DAY_MS)
  const rangeEnd = new Date(today.getTime() + WINDOW_DAYS_AFTER * DAY_MS)
  const totalDays = WINDOW_DAYS_BEFORE + WINDOW_DAYS_AFTER

  function xFor(date: Date): number {
    const clamped = Math.min(Math.max(date.getTime(), rangeStart.getTime()), rangeEnd.getTime())
    const ratio = (clamped - rangeStart.getTime()) / (rangeEnd.getTime() - rangeStart.getTime())
    return LABEL_WIDTH + ratio * (CHART_WIDTH - LABEL_WIDTH)
  }

  const cards = (cardsQuery.data ?? []).filter((c) => c.dueAt && c.status === 'active')
  const rows = members
    .map((m) => ({ member: m, cards: cards.filter((c) => c.assigneeUserId === m.userId) }))
    .filter((r) => r.cards.length > 0)

  const height = Math.max(rows.length, 1) * ROW_HEIGHT + 40

  let chart: React.ReactNode
  if (cardsQuery.isPending) {
    chart = <Skeleton className="h-96 w-full" />
  } else if (cardsQuery.isError) {
    chart = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void cardsQuery.refetch() }}
      />
    )
  } else if (rows.length === 0) {
    chart = (
      <StateView
        kind="empty"
        titleKey="work.timeline.emptyTitle"
        bodyKey="work.timeline.emptyBody"
      />
    )
  } else {
    chart = (
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${height}`}
          width={CHART_WIDTH}
          height={height}
          role="img"
          aria-label={t('work.view.timeline')}
        >
          <line
            x1={xFor(today)}
            y1={20}
            x2={xFor(today)}
            y2={height}
            stroke="var(--color-primary)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text x={xFor(today) + 4} y={14} className="fill-muted-foreground text-caption">
            {t('work.timeline.today')}
          </text>
          {Array.from({ length: Math.ceil(totalDays / 7) + 1 }, (_, i) => {
            const d = new Date(rangeStart.getTime() + i * 7 * DAY_MS)
            return (
              <g key={i}>
                <line
                  x1={xFor(d)}
                  y1={20}
                  x2={xFor(d)}
                  y2={height}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                />
                <text x={xFor(d) + 2} y={height - 4} className="fill-muted-foreground text-caption">
                  {formatDate(d, locale)}
                </text>
              </g>
            )
          })}
          {rows.map((row, i) => {
            const y = 24 + i * ROW_HEIGHT
            return (
              <g key={row.member.userId}>
                <text x={0} y={y + 14} className="fill-foreground text-small">
                  {row.member.givenName} {row.member.familyName.charAt(0)}.
                </text>
                {row.cards.map((card) => {
                  const start = card.startAt ? new Date(card.startAt) : new Date(card.createdAt)
                  const due = new Date(card.dueAt!)
                  const x1 = xFor(start)
                  const x2 = Math.max(xFor(due), x1 + 6)
                  return (
                    <rect
                      key={card.id}
                      x={x1}
                      y={y}
                      width={x2 - x1}
                      height={20}
                      rx={4}
                      fill={PRIORITY_FILL[card.priority]}
                      className="cursor-pointer opacity-80 hover:opacity-100"
                      onClick={() => openCardPeek(card.id)}
                    >
                      <title>{card.title}</title>
                    </rect>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="timeline">{chart}</WorkShell>
      <CardPeekDialog />
    </>
  )
}
