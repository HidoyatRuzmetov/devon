// Calendar view (TECH-SPEC §5: "FullCalendar 7 or a clean month grid" -- this build takes the grid,
// keeping the feature dependency-free): a plain month grid, one cell per day, cards shown on their
// due date. Month navigation via `?month=YYYY-MM` so a linked month is shareable like every other view.
import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useT, useLocale } from '@devon/i18n'
import { Button, IconButton, Skeleton, StateView, cn } from '@devon/ui'
import { navigate, replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { useCardsQuery } from '../hooks.js'
import { openCardPeek, CardPeekDialog } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseMonthKey(key: string | null): Date {
  if (key && /^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number)
    return new Date(y!, m! - 1, 1)
  }
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function buildGrid(monthStart: Date): Date[] {
  const firstWeekday = (monthStart.getDay() + 6) % 7 // Monday = 0
  const gridStart = new Date(monthStart)
  gridStart.setDate(gridStart.getDate() - firstWeekday)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export default function CalendarScreen() {
  const t = useT()
  const locale = useLocale()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const month = parseMonthKey(search.get('month'))
  // 100 is `GET /api/v1/cards`'s own hard cap (`work/schemas.ts`'s `limit: z.coerce.number()...
  // max(100)`) -- 300 always got a flat 422 (H1: confirmed live, the calendar view's own error
  // state, not an empty month).
  const cardsQuery = useCardsQuery({ q: q || undefined, limit: 100 })

  const days = buildGrid(month)
  const today = new Date()
  const cards = (cardsQuery.data ?? []).filter((c) => c.dueAt)

  function goMonth(delta: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    replaceSearchParam('month', monthKey(next))
  }

  let grid: React.ReactNode
  if (cardsQuery.isPending) {
    grid = <Skeleton className="h-140 w-full" />
  } else if (cardsQuery.isError) {
    grid = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void cardsQuery.refetch() }}
      />
    )
  } else {
    grid = (
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
        {WEEKDAY_KEYS.map((wd) => (
          <div
            key={wd}
            className="bg-card p-2 text-center text-caption font-medium uppercase text-muted-foreground"
          >
            {t(`work.calendar.weekday.${wd}`)}
          </div>
        ))}
        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth()
          const dayCards = cards.filter((c) => sameDay(new Date(c.dueAt!), day))
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'flex min-h-24 flex-col gap-1 bg-card p-1.5',
                !inMonth && 'bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'text-caption',
                  sameDay(day, today) ? 'font-bold text-primary' : 'text-muted-foreground',
                )}
              >
                {day.getDate()}
              </span>
              {dayCards.slice(0, 3).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openCardPeek(c.id)}
                  className="truncate rounded-sm px-1 py-0.5 text-left text-caption text-white"
                  style={{
                    backgroundColor:
                      c.priority === 'urgent' || c.priority === 'high'
                        ? 'var(--color-destructive)'
                        : 'var(--color-primary)',
                  }}
                  title={c.title}
                >
                  {c.title}
                </button>
              ))}
              {dayCards.length > 3 ? (
                <span className="text-caption text-muted-foreground">
                  {t('work.calendar.more', { count: dayCards.length - 3 })}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="calendar">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lead font-semibold text-foreground">
              {month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-1">
              <IconButton aria-label={t('work.calendar.prev')} onClick={() => goMonth(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`/work/calendar${q ? `?q=${encodeURIComponent(q)}` : ''}`)}
              >
                {t('work.calendar.today')}
              </Button>
              <IconButton aria-label={t('work.calendar.next')} onClick={() => goMonth(1)}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
          </div>

          {grid}
        </div>
      </WorkShell>
      <CardPeekDialog />
    </>
  )
}
