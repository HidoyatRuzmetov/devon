// Timeline view (TECH-SPEC §5: "timeline (SVG)") -- a Plane/Jira-quality Gantt: one row per CARD
// (grouped by assignee, or by project via the toggle), a labelled bar per card carrying its own
// title, a risk tint, a today line, a zoom control (day/week/today's window/month) with a sticky
// time header, and drag handles on either bar end to change the card's start/due date -- optimistic
// through the same `usePatchCardMutation` every other screen in this feature uses, reverted by a
// `toastWithUndo` rather than a confirm dialog. Hand-rolled DOM/CSS positioning (not SVG, not a
// charting library): dragging a bar edge with the pointer needs a real element per handle, and this
// is the one shape simple enough that a dependency would cost more than it saves.
import * as React from 'react'
import { motion } from 'motion/react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useT, useLocale, formatDate, formatMonthYear, formatMonthShort } from '@devon/i18n'
import {
  Button,
  Collapsible,
  Skeleton,
  StateView,
  cn,
  tweenStandard,
  toastWithUndo,
  unitHueClass,
  useReducedMotion,
} from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { useViewportBoundedHeight } from '../../../lib/use-viewport-bounded-height.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import type { Project } from '../../projects/api.js'
import { useCardsQuery, useMembers, usePatchCardMutation } from '../hooks.js'
import { openCardPeek, CardPeekDialog } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'
import { fullName } from '../lib/format.js'
import type { Card, CardRisk } from '../api.js'

const DAY_MS = 86_400_000
const ROW_HEIGHT = 40
// Its own band above the month/day scale for the "Bugun" marker (round2 SEV1: it used to sit inside
// the day-number row and print on top of whatever date shared its x).
const TODAY_BAND_HEIGHT = 18
const MONTH_BAND_HEIGHT = 22
const TICK_BAND_HEIGHT = 24
const GROUP_HEADER_HEIGHT = 32
const MIN_BAR_WIDTH = 28

type Zoom = 'day' | 'week' | 'month'
type GroupBy = 'person' | 'project'

const ZOOM_CONFIG: Record<Zoom, { pxPerDay: number; daysBefore: number; daysAfter: number }> = {
  day: { pxPerDay: 40, daysBefore: 10, daysAfter: 45 },
  week: { pxPerDay: 12, daysBefore: 21, daysAfter: 119 },
  month: { pxPerDay: 3.4, daysBefore: 30, daysAfter: 305 },
}

const RISK_FILL: Record<CardRisk, string> = {
  overdue: 'bg-destructive text-destructive-foreground',
  at_risk: 'bg-warning text-warning-foreground',
  none: 'bg-primary text-primary-foreground',
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

function dayIndex(d: Date, base: Date): number {
  return Math.round((startOfDay(d).getTime() - base.getTime()) / DAY_MS)
}

function toIsoDate(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString()
}

function useLocalStorageString(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = React.useState(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback
    } catch {
      return fallback
    }
  })
  const set = React.useCallback(
    (next: string) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, next)
      } catch {
        // Best-effort only -- the toggle still works for this render.
      }
    },
    [key],
  )
  return [value, set]
}

interface GanttGroup {
  key: string
  label: string
  /** Person groups colour their dot via `unitHueClass(userId)` (a Tailwind class); project groups
   * use the project's own stored hex via inline `style` -- so this carries either, and the group
   * header picks whichever one is set. */
  dotClassName?: string
  dotColour?: string
  cards: Card[]
}

/** One bar: renders at `left/width` derived from the card's start/due, shows its title inside, and
 * exposes two small pointer-drag handles that resize the bar (and, on release, PATCH the card's
 * `startAt`/`dueAt`) without ever sending a request mid-drag -- only the local preview moves while
 * the pointer is down; the mutation fires once, on `pointerup`. */
function GanttBar({
  card,
  rangeStart,
  rangeEnd,
  pxPerDay,
  rowIndex,
}: {
  card: Card
  rangeStart: Date
  rangeEnd: Date
  pxPerDay: number
  /** Staggers this bar's draw-in against its siblings (round2 SEV2: "per-row stagger"). */
  rowIndex: number
}) {
  // H4.1/H4.2: one per card on the Gantt (up to 100), each with its own drag state -- a measured hot
  // spot, opted into the compiler individually (`vite.config.ts`'s note).
  'use memo'
  const t = useT()
  const reduced = useReducedMotion()
  const patchCard = usePatchCardMutation()
  const [dragPreview, setDragPreview] = React.useState<{ start: Date; due: Date } | null>(null)
  const dragRef = React.useRef<{
    edge: 'start' | 'end'
    pointerId: number
    startClientX: number
    origStart: Date
    origDue: Date
  } | null>(null)

  const baseStart = card.startAt ? new Date(card.startAt) : new Date(card.createdAt)
  const baseDue = new Date(card.dueAt!)
  const start = dragPreview?.start ?? baseStart
  const due = dragPreview?.due ?? baseDue

  function clampX(d: Date): number {
    const clamped = new Date(
      Math.min(Math.max(startOfDay(d).getTime(), rangeStart.getTime()), rangeEnd.getTime()),
    )
    return dayIndex(clamped, rangeStart) * pxPerDay
  }
  const x1 = clampX(start)
  const x2 = Math.max(clampX(due) + pxPerDay, x1 + MIN_BAR_WIDTH)
  // round2 SEV1: a bar whose real start is earlier than the visible window ran flush into the grid's
  // left edge with nothing to say it continues off-screen -- a left fade + chevron makes that explicit
  // instead of reading as "this card starts exactly at the window edge".
  const clippedAtStart = startOfDay(start).getTime() < rangeStart.getTime()

  function onHandlePointerDown(edge: 'start' | 'end', e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      edge,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      origStart: baseStart,
      origDue: baseDue,
    }
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const deltaDays = Math.round((e.clientX - drag.startClientX) / pxPerDay)
    if (drag.edge === 'start') {
      const nextStart = addDays(drag.origStart, deltaDays)
      setDragPreview({
        start: nextStart.getTime() < drag.origDue.getTime() ? nextStart : drag.origDue,
        due: drag.origDue,
      })
    } else {
      const nextDue = addDays(drag.origDue, deltaDays)
      setDragPreview({
        start: drag.origStart,
        due: nextDue.getTime() > drag.origStart.getTime() ? nextDue : drag.origStart,
      })
    }
  }

  function onHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    const finalStart = dragPreview?.start ?? drag.origStart
    const finalDue = dragPreview?.due ?? drag.origDue
    const changed =
      startOfDay(finalStart).getTime() !== startOfDay(drag.origStart).getTime() ||
      startOfDay(finalDue).getTime() !== startOfDay(drag.origDue).getTime()
    if (changed) {
      const patch = { startAt: toIsoDate(finalStart), dueAt: toIsoDate(finalDue) }
      const revert = { startAt: toIsoDate(drag.origStart), dueAt: toIsoDate(drag.origDue) }
      patchCard.mutate({ id: card.id, patch })
      toastWithUndo({
        message: t('work.timeline.dateChanged', { title: card.title }),
        undoLabel: t('action.undo'),
        onUndo: () => patchCard.mutate({ id: card.id, patch: revert }),
      })
    }
    setDragPreview(null)
  }

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => openCardPeek(card.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openCardPeek(card.id)
        }
      }}
      title={card.title}
      className={cn(
        'group absolute top-1.5 bottom-1.5 flex cursor-pointer items-center rounded-md px-2 shadow-1 transition-opacity duration-(--dur-micro) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        RISK_FILL[card.risk],
        dragPreview && 'opacity-90',
      )}
      style={{ left: x1, width: x2 - x1, transformOrigin: 'left' }}
      // round2 SEV2: the bar draws in from its own start edge on mount instead of simply appearing --
      // `scaleX` (a transform), never `width`, so a 200-card chart stays cheap (no layout per frame).
      initial={reduced ? { opacity: 0 } : { scaleX: 0, opacity: 0.6 }}
      animate={{ scaleX: 1, opacity: 1 }}
      transition={{
        duration: reduced ? 0.15 : 0.28,
        ease: 'easeOut',
        delay: reduced ? 0 : Math.min(rowIndex, 40) * 0.012,
      }}
      {...(reduced ? {} : { whileHover: { y: -1 } })}
    >
      {clippedAtStart ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-5 items-center justify-start rounded-l-md bg-gradient-to-r from-black/25 to-transparent pl-0.5 text-current"
        >
          <ChevronLeft className="size-3" aria-hidden="true" />
        </span>
      ) : null}
      <span className="truncate text-caption font-medium">{card.title}</span>
      <div
        role="separator"
        aria-label={t('work.timeline.resizeStart')}
        onPointerDown={(e) => onHandlePointerDown('start', e)}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
      />
      <div
        role="separator"
        aria-label={t('work.timeline.resizeEnd')}
        onPointerDown={(e) => onHandlePointerDown('end', e)}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
      />
    </motion.div>
  )
}

export default function TimelineScreen() {
  // H4.1/H4.2: up to 100 Gantt bars re-rendering on every zoom, filter and drag tick -- a measured
  // hot spot, opted into the compiler individually (`vite.config.ts`'s note).
  'use memo'
  const t = useT()
  const locale = useLocale()
  const reducedTimeline = useReducedMotion()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  // 100 is `GET /api/v1/cards`'s own hard cap (`work/schemas.ts`'s `limit: z.coerce.number()...
  // max(100)`) -- 200 always got a flat 422 (H1: confirmed live, the timeline view's own error
  // state, not an empty board).
  const cardsQuery = useCardsQuery({ q: q || undefined, limit: 100 })
  const members = useMembers()
  const projectsQuery = useProjectsQuery()
  const projects = React.useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const [heightRef, scrollerHeight] = useViewportBoundedHeight<HTMLDivElement>(320)

  const [zoom, setZoom] = useLocalStorageString('devon.work.timeline.zoom', 'day')
  const [groupBy, setGroupBy] = useLocalStorageString('devon.work.timeline.groupBy', 'person')
  const zoomKey: Zoom = zoom === 'week' || zoom === 'month' ? zoom : 'day'
  const groupByKey: GroupBy = groupBy === 'project' ? 'project' : 'person'
  // round2's deferred item: Kun/Hafta/Oy used to be a hard re-layout -- every bar's `left`/`width`
  // simply jumped to its new pixels-per-day the instant the button was clicked. `pxPerDay` still
  // drives the real (instant, correct) layout every render, but the *outer* content div is wrapped
  // in a `scaleX` that starts at the ratio between the previous zoom's pixel density and the new one
  // and eases to `1` -- a transform, so 200+ bars cost nothing extra to lay out, and it reads as a
  // camera zoom (Figma/Linear's own timeline convention) rather than a jump cut. The ref updates in
  // an effect (after paint), so the render that just changed `zoomKey` still sees the *previous*
  // density when computing `scaleFrom`.
  const [collapsedGroups, setCollapsedGroups] = React.useState<ReadonlySet<string>>(new Set())

  const today = startOfDay(new Date())
  const { pxPerDay, daysBefore, daysAfter } = ZOOM_CONFIG[zoomKey]
  const rangeStart = addDays(today, -daysBefore)
  const rangeEnd = addDays(today, daysAfter)
  const totalDays = daysBefore + daysAfter
  const totalWidth = totalDays * pxPerDay

  const prevPxPerDayRef = React.useRef(pxPerDay)
  const zoomScaleFrom = prevPxPerDayRef.current / pxPerDay
  React.useEffect(() => {
    prevPxPerDayRef.current = pxPerDay
  }, [pxPerDay])

  function toggleGroupCollapsed(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const cards = (cardsQuery.data ?? []).filter((c) => c.dueAt && c.status === 'active')

  const groups: GanttGroup[] = React.useMemo(() => {
    if (groupByKey === 'project') {
      const byProject = new Map<string, Card[]>()
      const noProject: Card[] = []
      for (const c of cards) {
        if (c.projectId) {
          const list = byProject.get(c.projectId) ?? []
          list.push(c)
          byProject.set(c.projectId, list)
        } else {
          noProject.push(c)
        }
      }
      const projectGroups: GanttGroup[] = projects
        .filter((p) => byProject.has(p.id))
        .map((p: Project) => ({
          key: p.id,
          label: p.title,
          dotColour: p.colour,
          cards: byProject.get(p.id) ?? [],
        }))
      if (noProject.length > 0) {
        projectGroups.push({
          key: 'none',
          label: t('work.timeline.noProject'),
          cards: noProject,
        })
      }
      return projectGroups
    }
    return members
      .map((m) => ({
        key: m.userId,
        label: fullName(m),
        dotClassName: unitHueClass(m.userId),
        cards: cards.filter((c) => c.assigneeUserId === m.userId),
      }))
      .filter((g) => g.cards.length > 0)
  }, [groupByKey, cards, members, projects, t])

  const monthBands = React.useMemo(() => {
    const bands: { x: number; width: number; label: string }[] = []
    let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    while (cursor <= rangeEnd) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      const visibleStart = cursor < rangeStart ? rangeStart : cursor
      const visibleEnd = next < rangeEnd ? next : rangeEnd
      const x = dayIndex(visibleStart, rangeStart) * pxPerDay
      const width = Math.max(dayIndex(visibleEnd, rangeStart) * pxPerDay - x, 1)
      bands.push({ x, width, label: formatMonthYear(cursor, locale) })
      cursor = next
    }
    return bands
  }, [rangeStart, rangeEnd, pxPerDay, locale])

  const ticks = React.useMemo(() => {
    const list: { x: number; label: string; strong: boolean }[] = []
    if (zoomKey === 'day') {
      for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) {
        list.push({
          x: dayIndex(d, rangeStart) * pxPerDay,
          label: String(d.getDate()),
          strong: d.getDay() === 1,
        })
      }
    } else if (zoomKey === 'week') {
      let d = new Date(rangeStart)
      while (d.getDay() !== 1) d = addDays(d, 1)
      for (; d <= rangeEnd; d = addDays(d, 7)) {
        list.push({
          x: dayIndex(d, rangeStart) * pxPerDay,
          label: formatDate(d, locale),
          strong: false,
        })
      }
    } else {
      let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
      if (d < rangeStart) d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      for (; d <= rangeEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        list.push({
          x: dayIndex(d, rangeStart) * pxPerDay,
          label: formatMonthShort(d, locale),
          strong: false,
        })
      }
    }
    return list
  }, [zoomKey, rangeStart, rangeEnd, pxPerDay, locale])

  const todayX = dayIndex(today, rangeStart) * pxPerDay
  const rowsHeight = groups.reduce(
    (sum, g) =>
      sum + GROUP_HEADER_HEIGHT + (collapsedGroups.has(g.key) ? 0 : g.cards.length * ROW_HEIGHT),
    0,
  )

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  function scrollToToday() {
    scrollRef.current?.scrollTo({ left: Math.max(todayX - 120, 0), behavior: 'smooth' })
  }

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
  } else if (groups.length === 0) {
    chart = (
      <StateView
        kind="empty"
        titleKey="work.timeline.emptyTitle"
        bodyKey="work.timeline.emptyBody"
      />
    )
  } else {
    chart = (
      <div
        ref={(el) => {
          scrollRef.current = el
          heightRef(el)
        }}
        className="overflow-auto rounded-md border border-border"
        style={{ height: scrollerHeight }}
      >
        <motion.div
          key={zoomKey}
          className="relative"
          style={{ width: Math.max(totalWidth, 1), transformOrigin: 'top left' }}
          initial={reducedTimeline ? { opacity: 1 } : { scaleX: zoomScaleFrom || 1, opacity: 0.85 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={reducedTimeline ? { duration: 0 } : tweenStandard}
        >
          <div className="sticky top-0 z-20 bg-card">
            {/* round2 SEV1: "Bugun" used to sit inside the day-number row and print on top of
                whatever date shared its x ("Bugun8") -- its own band above the day scale (Linear/
                Plane's own convention) means it can never collide with a number again. */}
            <div className="relative" style={{ height: TODAY_BAND_HEIGHT }}>
              <div
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-primary px-1.5 py-0.5 text-caption font-semibold text-primary-foreground shadow-1"
                style={{ left: todayX }}
              >
                {t('work.timeline.today')}
              </div>
            </div>
            <div
              className="relative border-b border-border/70"
              style={{ height: MONTH_BAND_HEIGHT }}
            >
              {monthBands.map((band) => (
                <div
                  key={band.label + band.x}
                  className="absolute top-0 flex h-full items-center truncate px-2 text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground"
                  style={{ left: band.x, width: band.width }}
                >
                  {band.label}
                </div>
              ))}
            </div>
            <div className="relative border-b border-border" style={{ height: TICK_BAND_HEIGHT }}>
              {ticks.map((tick) => (
                <div
                  key={tick.x}
                  className={cn(
                    'absolute top-0 flex h-full items-center px-1 text-caption',
                    tick.strong ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                  style={{ left: tick.x }}
                >
                  {tick.label}
                </div>
              ))}
            </div>
          </div>

          <div className="relative" style={{ minHeight: rowsHeight }}>
            <div className="pointer-events-none absolute inset-0">
              {ticks.map((tick) => (
                <div
                  key={tick.x}
                  className="absolute top-0 bottom-0 w-px bg-border/50"
                  style={{ left: tick.x }}
                />
              ))}
              {/* round2 SEV2: the today line now sweeps down from the top on arrival instead of
                  simply being present -- `scaleY` (a transform), not `height`. */}
              <motion.div
                className="absolute top-0 bottom-0 w-px bg-primary"
                style={{ left: todayX, transformOrigin: 'top' }}
                initial={reducedTimeline ? { opacity: 0 } : { scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ duration: reducedTimeline ? 0.15 : 0.4, ease: 'easeOut' }}
                aria-hidden="true"
              />
            </div>
            {groups.map((group) => {
              const collapsed = collapsedGroups.has(group.key)
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() => toggleGroupCollapsed(group.key)}
                    className="flex w-full items-center gap-2 border-b border-border bg-surface-2 px-2 text-caption font-medium text-foreground hover:bg-accent/40"
                    style={{ height: GROUP_HEADER_HEIGHT }}
                  >
                    <ChevronDown
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--dur-micro)',
                        collapsed && '-rotate-90',
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn('size-2 shrink-0 rounded-full', group.dotClassName)}
                      style={group.dotColour ? { backgroundColor: group.dotColour } : undefined}
                      aria-hidden="true"
                    />
                    {group.label}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-caption tabular-nums text-muted-foreground">
                      {group.cards.length}
                    </span>
                  </button>
                  {/* round2 SEV2: group heads did not collapse -- `Collapsible` gives "Yopish" a real
                      height animation instead of the rows simply vanishing. */}
                  <Collapsible open={!collapsed}>
                    {group.cards.map((card, rowIndex) => (
                      <div
                        key={card.id}
                        className="relative border-b border-border/40"
                        style={{ height: ROW_HEIGHT }}
                      >
                        <GanttBar
                          card={card}
                          rangeStart={rangeStart}
                          rangeEnd={rangeEnd}
                          pxPerDay={pxPerDay}
                          rowIndex={rowIndex}
                        />
                      </div>
                    ))}
                  </Collapsible>
                </div>
              )
            })}
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="timeline">
        <div className="flex h-full flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label={t('work.timeline.groupByLabel')}
              className="flex rounded-md border border-border p-0.5"
            >
              {(['person', 'project'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={groupByKey === g}
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    'rounded-sm px-2.5 py-1 text-caption font-medium transition-colors duration-(--dur-micro)',
                    groupByKey === g
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`work.timeline.groupBy.${g}`)}
                </button>
              ))}
            </div>
            <div
              role="group"
              aria-label={t('work.timeline.zoomLabel')}
              className="flex rounded-md border border-border p-0.5"
            >
              {(['day', 'week', 'month'] as const).map((z) => (
                <button
                  key={z}
                  type="button"
                  aria-pressed={zoomKey === z}
                  onClick={() => setZoom(z)}
                  className={cn(
                    'rounded-sm px-2.5 py-1 text-caption font-medium transition-colors duration-(--dur-micro)',
                    zoomKey === z
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`work.timeline.zoom.${z}`)}
                </button>
              ))}
            </div>
            {groups.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={scrollToToday}>
                <ChevronLeft className="size-3.5" aria-hidden="true" />
                {t('work.timeline.today')}
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
              <LegendSwatch className="bg-primary" label={t('work.timeline.legend.onTrack')} />
              <LegendSwatch className="bg-warning" label={t('work.risk.atRisk')} />
              <LegendSwatch className="bg-destructive" label={t('work.risk.overdue')} />
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-px bg-primary" aria-hidden="true" />
                {t('work.timeline.today')}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1">{chart}</div>
        </div>
      </WorkShell>
      <CardPeekDialog />
    </>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2.5 shrink-0 rounded-sm', className)} aria-hidden="true" />
      {label}
    </span>
  )
}
