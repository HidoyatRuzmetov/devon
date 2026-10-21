// Calendar view (TECH-SPEC §5: "FullCalendar 7 or a clean month grid" -- this build takes the grid,
// keeping the feature dependency-free): a plain month grid, one cell per day, cards shown on their
// due date. Month navigation via `?month=YYYY-MM` so a linked month is shareable like every other view.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, CalendarDays, Flag } from 'lucide-react'
import { useT, useLocale, formatMonthYear } from '@devon/i18n'
import {
  Button,
  IconButton,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  useReducedMotion,
} from '@devon/ui'
import { navigate, replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { useCardsQuery } from '../hooks.js'
import { openCardPeek, CardPeekDialog } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'
import type { Card } from '../api.js'
import { ArchivedCardBadge } from './archived-card-badge.js'
import { isCardCompleted } from '../lib/format.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import { useEventsQuery } from '../../events/hooks.js'
import type { EventDto } from '../../events/schemas.js'

type Deadline = { id: string; title: string; date: string; projectId: string }

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

/** One grid cell: the day number, up to three event chips, an animated "yana N ta" disclosure for
 * the rest, and (round2 SEV2) a ring that pulses once on arrival if this is today's cell -- motion as
 * the "you are here" signal, on top of the existing bold/primary text treatment. */
function DayCell({
  day,
  inMonth,
  isToday,
  cards,
  events,
  deadlines,
  onOpen,
}: {
  day: Date
  inMonth: boolean
  isToday: boolean
  deadlines: readonly Deadline[]
  events: readonly EventDto[]
  cards: readonly Card[]
  onOpen: (id: string) => void
}) {
  const t = useT()
  const reduced = useReducedMotion()
  const [expanded, setExpanded] = React.useState(false)
  const entries = [
    ...events.map((e) => ({ kind: 'event' as const, value: e })),
    ...cards.map((c) => ({ kind: 'card' as const, value: c })),
    ...deadlines.map((d) => ({ kind: 'deadline' as const, value: d })),
  ]
  const shown = expanded ? entries : entries.slice(0, 3)
  const overflow = entries.slice(3)

  function chip(c: Card) {
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => onOpen(c.id)}
        className={cn(
          'flex w-full shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left text-caption',
          c.priority === 'urgent' || c.priority === 'high'
            ? 'bg-destructive/12 text-destructive'
            : 'bg-primary/12 text-primary',
        )}
        title={c.title}
      >
        <span className={cn('min-w-0 flex-1 truncate', isCardCompleted(c) && 'line-through')}>
          {c.title}
        </span>
        <ArchivedCardBadge card={c} className="py-0" />
      </button>
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-40 min-w-0 flex-col gap-1 overflow-hidden bg-card p-1.5',
        !inMonth && 'bg-muted/40',
      )}
    >
      {isToday ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0.5 rounded-sm ring-2 ring-primary"
          initial={reduced ? { opacity: 0.6 } : { opacity: 0.9, scale: 1.04 }}
          animate={{ opacity: 0, scale: 1 }}
          transition={{ duration: reduced ? 0.4 : 0.9, ease: 'easeOut' }}
        />
      ) : null}
      <span
        className={cn('text-caption', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}
      >
        {day.getDate()}
      </span>
      <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-1">
        {shown.map((entry) =>
          entry.kind === 'card' ? (
            chip(entry.value)
          ) : entry.kind === 'deadline' ? (
            <button
              key={entry.value.id}
              type="button"
              title={entry.value.title}
              onClick={() =>
                navigate(
                  '/projects/view?id=' +
                    entry.value.projectId +
                    (new URLSearchParams(window.location.search).get('from') === 'overview'
                      ? '&from=overview'
                      : ''),
                )
              }
              className="flex w-full shrink-0 items-center gap-1 rounded-sm border border-warning/30 bg-warning/10 px-1 py-0.5 text-left text-caption text-warning"
            >
              <Flag className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{entry.value.title}</span>
            </button>
          ) : (
            <button
              key={entry.value.id}
              type="button"
              title={entry.value.title}
              onClick={() =>
                navigate(
                  `/events?event=${entry.value.id}${new URLSearchParams(window.location.search).get('from') === 'overview' ? '&from=overview' : ''}`,
                )
              }
              className="flex w-full shrink-0 items-center gap-1 rounded-sm border border-info/30 bg-info/10 px-1 py-0.5 text-left text-caption text-info"
            >
              <CalendarDays className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{entry.value.title}</span>
            </button>
          ),
        )}
      </div>
      {overflow.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="text-left text-caption text-muted-foreground hover:text-foreground"
          >
            {expanded
              ? t('work.calendar.showLess')
              : t('work.calendar.more', { count: overflow.length })}
          </button>
        </>
      ) : null}
    </div>
  )
}

// round2 SEV2: month change was a hard swap where a slide belongs (direction from the nav button
// actually pressed, not guessed from the date diff, so "today" jumping several months still reads as
// a plain crossfade rather than a wrong-direction slide).
const SLIDE_PX = 24

function MonthGrid({
  month,
  days,
  today,
  cards,
  events,
  deadlines,
}: {
  deadlines: readonly Deadline[]
  events: readonly EventDto[]
  month: Date
  days: readonly Date[]
  today: Date
  cards: readonly (Card & { dueAt: string })[]
}) {
  const t = useT()
  return (
    <Stagger
      as="div"
      animateKey={monthKey(month)}
      className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border"
    >
      {WEEKDAY_KEYS.map((wd) => (
        <div
          key={wd}
          className="bg-card p-2 text-center text-caption font-medium uppercase text-muted-foreground"
        >
          {t(`work.calendar.weekday.${wd}`)}
        </div>
      ))}
      {days.map((day) => {
        const dayCards = cards.filter((c) => sameDay(new Date(c.dueAt), day))
        return (
          <StaggerItem key={day.toISOString()} as="div">
            <DayCell
              day={day}
              inMonth={day.getMonth() === month.getMonth()}
              isToday={sameDay(day, today)}
              cards={dayCards}
              deadlines={deadlines.filter((d) => sameDay(new Date(d.date + 'T12:00:00'), day))}
              events={events.filter((e) => {
                const start = new Date(e.startsAt),
                  end = new Date(e.endsAt)
                const next = new Date(day)
                next.setDate(next.getDate() + 1)
                return start < next && end > day && e.status !== 'cancelled'
              })}
              onOpen={openCardPeek}
            />
          </StaggerItem>
        )
      })}
    </Stagger>
  )
}

export default function CalendarScreen() {
  const t = useT()
  const locale = useLocale()
  const reduced = useReducedMotion()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const month = parseMonthKey(search.get('month'))
  const [direction, setDirection] = React.useState(0)
  // 100 is `GET /api/v1/cards`'s own hard cap (`work/schemas.ts`'s `limit: z.coerce.number()...
  // max(100)`) -- 300 always got a flat 422 (H1: confirmed live, the calendar view's own error
  // state, not an empty month).
  const projectsQuery = useProjectsQuery()
  const cardsQuery = useCardsQuery({ q: q || undefined, limit: 100 })

  const days = buildGrid(month)
  const eventsQuery = useEventsQuery({
    from: days[0]!,
    to: new Date(days[41]!.getFullYear(), days[41]!.getMonth(), days[41]!.getDate() + 1),
  })
  const deadlines: Deadline[] = (projectsQuery.data ?? [])
    .filter((p) => p.status !== 'archived')
    .flatMap((p) => [
      ...p.milestones
        .filter((m) => m.dueOn)
        .map((m) => ({
          id: m.id,
          title: p.title + ' · ' + m.title,
          date: m.dueOn!,
          projectId: p.id,
        })),
      ...(p.targetOn ? [{ id: p.id, title: p.title, date: p.targetOn, projectId: p.id }] : []),
    ])
  const today = new Date()
  const cards = (cardsQuery.data ?? []).filter(
    (c): c is typeof c & { dueAt: string } => c.dueAt !== null,
  )

  function goMonth(delta: number) {
    setDirection(delta)
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    replaceSearchParam('month', monthKey(next))
  }

  let grid: React.ReactNode
  if (cardsQuery.isPending || eventsQuery.isPending || projectsQuery.isPending) {
    grid = <Skeleton className="h-140 w-full" />
  } else if (cardsQuery.isError || eventsQuery.isError || projectsQuery.isError) {
    grid = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => {
            void cardsQuery.refetch()
            void eventsQuery.refetch()
            void projectsQuery.refetch()
          },
        }}
      />
    )
  } else {
    grid = (
      <div className="relative overflow-hidden">
        <AnimatePresence mode="popLayout" custom={direction} initial={false}>
          <motion.div
            key={monthKey(month)}
            custom={direction}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: direction * SLIDE_PX }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: direction * -SLIDE_PX }}
            transition={{ duration: reduced ? 0.15 : 0.22, ease: 'easeOut' }}
          >
            <MonthGrid
              month={month}
              days={days}
              today={today}
              cards={cards}
              deadlines={deadlines}
              events={eventsQuery.data?.items ?? []}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="calendar">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lead font-semibold text-foreground">
              {formatMonthYear(month, locale)}
            </h2>
            <div className="flex items-center gap-1">
              <IconButton aria-label={t('work.calendar.prev')} onClick={() => goMonth(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDirection(0)
                  replaceSearchParam('month', monthKey(new Date()))
                }}
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
