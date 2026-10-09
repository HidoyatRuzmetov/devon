// Table view (TECH-SPEC §5): every card the current `?q=` filter matches, one row each, row-
// virtualised (TanStack Virtual -- exact pinned version, `apps/web/package.json`) behind a sticky
// header, with column sort, row checkboxes and a bulk action bar (assign/label/archive, archive
// undoable), a density toggle, and inline edit on title/assignee/due -- the same `usePatchCardMutation`
// the card peek uses, so an edit here and an edit there are optimistic the same way. Built on CSS grid
// plain `div`s rather than a real HTML table: a virtualised row needs `position: absolute` for its
// transform-based offset, which browsers do not reliably honour on a genuine table-row element.
import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Clock3 } from 'lucide-react'
import { useT, useLocale } from '@devon/i18n'
import { Badge, Checkbox, DatePicker, Input, Select, Skeleton, StateView, cn } from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { useMediaQuery } from '../../../lib/use-media-query.js'
import { useViewportBoundedHeight } from '../../../lib/use-viewport-bounded-height.js'
import { useCardsQuery, useLabelsQuery, useMembers, usePatchCardMutation } from '../hooks.js'
import {
  PRIORITY_LABEL_KEY,
  RISK_BADGE_CLASSNAME,
  RISK_ICON_NAME,
  RISK_LABEL_KEY,
  fullName,
} from '../lib/format.js'

const RISK_ICON = { AlertCircle, Clock3 } as const
import { MemberPicker } from './member-picker.js'
import { CardPeekDialog, openCardPeek } from './card-peek-dialog.js'
import { MultitaskToolbar, MultitaskToolbarSlot, useCardSelection } from './multitask-toolbar.js'
import { WorkShell } from './work-shell.js'
import type { Card, CardPriority, MemberSummary } from '../api.js'

const PRIORITIES: readonly CardPriority[] = ['none', 'low', 'medium', 'high', 'urgent']
const PRIORITY_ORDER: Record<CardPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}
type SortField = 'title' | 'assignee' | 'priority' | 'due' | 'status'
type SortState = { field: SortField; dir: 'asc' | 'desc' }
type Density = 'compact' | 'comfortable'

// The 5th (due date) column has to hold the `DatePicker` trigger *and*, when a card is at risk, a
// `Badge` reading e.g. "Muddati oʻtgan" (RISK_LABEL_KEY) side by side -- at the old 170px both never
// fit together (the date alone runs ~110px, the risk badge another ~130px), so the badge silently
// overflowed its grid cell and painted underneath the next column's status Badge, which read as one
// mangled chip ("Mud" + "Faol" + "gan" overlapping, found reviewing `worktable` screenshots at 1440).
// Grid items don't clip their own overflow, so no column boundary is a text-overflow guard on its
// own -- the fix is giving this column enough real width for its two fixed-size (`shrink-0`)
// children, taken from the title column's own flexible `1fr` slack rather than any other fixed
// column, since the title track already renders with hundreds of spare pixels at 1440/390.
//
// round2 SEV1: every cell used to be a form control at full width regardless of whether it was being
// edited (a bordered `Input`, a bordered `MemberPicker` combobox, a native `<select>`) -- ~90px sat
// unused to the right of HOLAT and four per-row borders' worth of chrome besides, while the title
// column (an `<Input>`, which cannot ellipsize) simply cut long titles mid-word. Cells now render as
// plain text by default and only look like controls on hover/focus (`TableRow` below), so the
// assignee/priority/due/status columns need less width than a permanently-bordered control did --
// that freed width, plus the unused strip, goes to the title column's `minmax` floor.
const GRID_COLUMNS = '40px minmax(300px,1fr) 180px 120px 260px 140px'

function useLocalStorageDensity(): [Density, (d: Density) => void] {
  const key = 'devon.work.table.density'
  const [density, setDensityState] = React.useState<Density>(() => {
    try {
      return window.localStorage.getItem(key) === 'compact' ? 'compact' : 'comfortable'
    } catch {
      return 'comfortable'
    }
  })
  const setDensity = React.useCallback((next: Density) => {
    setDensityState(next)
    try {
      window.localStorage.setItem(key, next)
    } catch {
      // Best-effort only -- the toggle still works for this render.
    }
  }, [])
  return [density, setDensity]
}

function toDateInputValue(iso: string | null): Date | undefined {
  return iso ? new Date(iso) : undefined
}
function dateToIso(date: Date | undefined): string | null {
  if (!date) return null
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString()
}

function SortHeader({
  field,
  label,
  sort,
  onSort,
}: {
  field: SortField
  label: string
  sort: SortState | null
  onSort: (field: SortField) => void
}) {
  const active = sort?.field === field
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground hover:text-foreground"
      >
        {label}
        {active ? (
          sort!.dir === 'asc' ? (
            <ArrowUp className="size-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}

// ui-blitz round3 #30: below this the grid's five fixed-width columns (300+180+120+260+140px) no
// longer fit any phone -- `TableScreen` swaps `TableRow`'s grid for `MobileTableRow`'s stacked
// title+meta-line card below this width, matching the shell's own `md:` cutover everywhere else
// (`work-shell.tsx`'s `useMediaQuery('(min-width: 768px)')`) rather than picking a new breakpoint.
const MOBILE_ROW_HEIGHT = 64

export default function TableScreen() {
  // H4.1/H4.2: virtualised, up to 100 sorted/selectable rows re-rendering on every sort, filter,
  // selection and bulk-action tick -- a measured hot spot, opted into the compiler individually
  // (`vite.config.ts`'s note) rather than via a blanket `compiler: true`.
  'use memo'
  const t = useT()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const cardsQuery = useCardsQuery({ q: q || undefined, limit: 100 })
  const members = useMembers()
  const labels = useLabelsQuery().data ?? []
  const [density, setDensity] = useLocalStorageDensity()
  const [sort, setSort] = React.useState<SortState | null>(null)
  const [heightRef, scrollerHeight] = useViewportBoundedHeight<HTMLDivElement>(280)
  // Motion verdict F6: the scroll element is *state*, not a ref, so `VirtualRows` below re-renders
  // once it exists and TanStack Virtual can attach to it -- a child's layout effect runs before its
  // parent's ref is attached, so a ref shared downwards would still be null on that first pass.
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const cards = React.useMemo(() => cardsQuery.data ?? [], [cardsQuery.data])
  const rowHeight = isDesktop ? (density === 'compact' ? 40 : 56) : MOBILE_ROW_HEIGHT
  const setScrollerEl = React.useCallback(
    (el: HTMLDivElement | null) => {
      setScrollEl(el)
      heightRef(el)
    },
    [heightRef],
  )

  const sorted = React.useMemo(() => {
    if (!sort) return cards
    const dir = sort.dir === 'asc' ? 1 : -1
    const memberName = (id: string | null) => {
      const m = members.find((mm) => mm.userId === id)
      return m ? fullName(m) : ''
    }
    return [...cards].sort((a, b) => {
      switch (sort.field) {
        case 'title':
          return dir * a.title.localeCompare(b.title)
        case 'assignee':
          return dir * memberName(a.assigneeUserId).localeCompare(memberName(b.assigneeUserId))
        case 'priority':
          return dir * (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
        case 'due':
          return dir * (a.dueAt ?? '').localeCompare(b.dueAt ?? '')
        case 'status':
          return dir * a.status.localeCompare(b.status)
        default:
          return 0
      }
    })
  }, [cards, sort, members])

  function toggleSort(field: SortField) {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return null
    })
  }

  // v1.1 SPEC §7 (A8): selection lives in the shared `useCardSelection` hook, which prunes itself
  // whenever the underlying list changes shape (a filter narrows it, a poll removes an archived
  // card) so the toolbar never acts on a row that is no longer on screen.
  const sortedIds = React.useMemo(() => sorted.map((c) => c.id), [sorted])
  const { selected, toggle: toggleRow, selectRange, selectAll, clear } = useCardSelection(sortedIds)
  // Shift-click range select needs to know which row the last plain click landed on.
  const lastClickedRef = React.useRef<string | null>(null)

  // Stable, so the memoised rows below are not re-rendered by a fresh closure on every scroll tick.
  const onRowToggle = React.useCallback(
    (id: string, checked: boolean, shiftKey: boolean): void => {
      if (shiftKey && lastClickedRef.current) {
        selectRange(lastClickedRef.current, id, sortedIds)
        return
      }
      lastClickedRef.current = id
      toggleRow(id, checked)
    },
    [selectRange, toggleRow, sortedIds],
  )

  function toggleAll(checked: boolean): void {
    selectAll(checked, sortedIds)
  }

  let body: React.ReactNode
  if (cardsQuery.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  } else if (cardsQuery.isError) {
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void cardsQuery.refetch() }}
      />
    )
  } else if (sorted.length === 0) {
    body = (
      <StateView kind="empty" titleKey="work.table.emptyTitle" bodyKey="work.table.emptyBody" />
    )
  } else {
    const allSelected = selected.size > 0 && selected.size === sorted.length
    const someSelected = selected.size > 0 && !allSelected
    body = (
      <div
        ref={setScrollerEl}
        className="overflow-auto rounded-md border border-border"
        style={{ height: scrollerHeight }}
      >
        {/* `minWidth: 1020` is exactly the desktop grid's own column widths -- forcing that on a
            390px viewport is what made the mobile table "a horizontally-scrolled data grid" (round3
            #30); `MobileTableRow`'s stacked layout needs no fixed width at all, so it is simply
            omitted below `md`. */}
        <div
          role="table"
          aria-label={t('work.view.table')}
          style={isDesktop ? { minWidth: 1020 } : undefined}
        >
          {isDesktop ? (
            <div
              role="row"
              className="sticky top-0 z-10 grid items-center gap-2 border-b border-border bg-card px-2"
              style={{ gridTemplateColumns: GRID_COLUMNS, height: 40 }}
            >
              <div role="columnheader">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label={t('work.table.selectAll')}
                />
              </div>
              <SortHeader
                field="title"
                label={t('work.field.title')}
                sort={sort}
                onSort={toggleSort}
              />
              <SortHeader
                field="assignee"
                label={t('work.field.assignee')}
                sort={sort}
                onSort={toggleSort}
              />
              <SortHeader
                field="priority"
                label={t('work.field.priority')}
                sort={sort}
                onSort={toggleSort}
              />
              <SortHeader field="due" label={t('work.field.due')} sort={sort} onSort={toggleSort} />
              <SortHeader
                field="status"
                label={t('work.field.status')}
                sort={sort}
                onSort={toggleSort}
              />
            </div>
          ) : (
            // Mobile has no room for five sort headers side by side -- one compact control picking
            // the same `sort` state the desktop headers drive, so sorting still works, it just costs
            // a tap on a menu instead of a click on a column label.
            <div
              role="row"
              className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2"
            >
              <div role="columnheader">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label={t('work.table.selectAll')}
                />
              </div>
              <div role="columnheader">
                <Select
                  aria-label={t('work.table.sort.label')}
                  value={sort ? `${sort.field}:${sort.dir}` : ''}
                  onChange={(e) => {
                    const [field, dir] = e.target.value.split(':') as [SortField, 'asc' | 'desc']
                    setSort(e.target.value ? { field, dir } : null)
                  }}
                  options={[
                    { value: '', label: t('work.table.sort.none') },
                    { value: 'title:asc', label: t('work.field.title') },
                    { value: 'assignee:asc', label: t('work.field.assignee') },
                    { value: 'priority:asc', label: t('work.field.priority') },
                    { value: 'due:asc', label: t('work.field.due') },
                    { value: 'status:asc', label: t('work.field.status') },
                  ]}
                  className="h-8 max-w-40 text-caption"
                />
              </div>
            </div>
          )}
          <VirtualRows
            sorted={sorted}
            members={members}
            selected={selected}
            onToggle={onRowToggle}
            rowHeight={rowHeight}
            isDesktop={isDesktop}
            scrollEl={scrollEl}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <WorkShell filterLayout="table">
        <div className="flex h-full flex-col gap-2">
          <div className="relative flex min-h-9 items-center gap-2">
            {/* round2 SEV2: the bulk bar used to simply appear the instant a row was checked --
                sliding up from the header's bottom edge (springSettle, the same spring the app's
                sheets settle with) reads as "this appeared because you selected something" instead
                of a layout flicker. */}
            <MultitaskToolbarSlot show={selected.size > 0}>
              <MultitaskToolbar
                ids={[...selected]}
                members={members}
                labels={labels}
                onClear={clear}
              />
            </MultitaskToolbarSlot>
            {selected.size === 0 ? (
              <div
                role="group"
                aria-label={t('work.table.density.label')}
                // round2 critique #30: at 390 the table already collapses every column into one
                // and the toggle "means nothing" there -- hide it below the `md` breakpoint the rest
                // of the shell uses for its own mobile cutover.
                className="ml-auto hidden rounded-md border border-border p-0.5 md:flex"
              >
                {(['comfortable', 'compact'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={density === d}
                    onClick={() => setDensity(d)}
                    className={cn(
                      'rounded-sm px-2.5 py-1 text-caption font-medium transition-colors duration-(--dur-micro)',
                      density === d
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`work.table.density.${d}`)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1">{body}</div>
        </div>
      </WorkShell>
      <CardPeekDialog />
    </>
  )
}

/** Only this component re-renders while the table scrolls.
 *
 * Motion verdict F6. TanStack Virtual sets state on every scroll event, and that state used to live
 * in `TableScreen` -- so a scroll re-rendered the whole screen, `WorkShell` and all of its chrome
 * included (measured: `WorkShell` accounted for 394 ms across 40 scrolled frames, ~10 ms of every
 * frame's budget, for a header and a filter bar that cannot change while a list scrolls). Moving the
 * virtualiser down here means a scroll tick re-renders the row window and nothing above it.
 *
 * `estimateSize` and `getItemKey` are `useCallback`s so the virtualiser is not rebuilt per render,
 * and `getItemKey` keys by card id so React reuses a row's fiber as the window slides rather than
 * remounting it under a positional key. */
function VirtualRows({
  sorted,
  members,
  selected,
  onToggle,
  rowHeight,
  isDesktop,
  scrollEl,
}: {
  sorted: Card[]
  members: MemberSummary[]
  selected: ReadonlySet<string>
  onToggle: (id: string, checked: boolean, shiftKey: boolean) => void
  rowHeight: number
  isDesktop: boolean
  scrollEl: HTMLDivElement | null
}) {
  const estimateSize = React.useCallback(() => rowHeight, [rowHeight])
  const getItemKey = React.useCallback((index: number) => sorted[index]?.id ?? index, [sorted])
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollEl,
    estimateSize,
    getItemKey,
    overscan: 8,
  })
  return (
    <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((vRow) => {
        const card = sorted[vRow.index]!
        return isDesktop ? (
          <TableRow
            key={card.id}
            card={card}
            members={members}
            checked={selected.has(card.id)}
            onToggle={onToggle}
            top={vRow.start}
            height={vRow.size}
          />
        ) : (
          <MobileTableRow
            key={card.id}
            card={card}
            members={members}
            checked={selected.has(card.id)}
            onToggle={onToggle}
            top={vRow.start}
            height={vRow.size}
          />
        )
      })}
    </div>
  )
}

const TableRow = React.memo(function TableRow({
  card,
  members,
  checked,
  onToggle,
  top,
  height,
}: {
  card: Card
  members: MemberSummary[]
  checked: boolean
  /** Takes the row's own id, so the parent can hand down one stable callback for every row instead
   * of a fresh closure per row per render -- which is what makes the `React.memo` around this
   * component actually hold while the list scrolls (motion verdict F6). */
  onToggle: (id: string, checked: boolean, shiftKey: boolean) => void
  top: number
  height: number
}) {
  // H4.1/H4.2: one instance per visible virtualised row (up to ~20 on screen at once), re-rendering
  // on every parent sort/selection tick even when this row's own card is unchanged -- a measured hot
  // spot, opted into the compiler individually (`vite.config.ts`'s note).
  'use memo'
  const t = useT()
  const locale = useLocale()
  const patchCard = usePatchCardMutation()
  // Radix's `onCheckedChange` gives no event, so shift is captured on the pointerdown before it.
  const shiftRef = React.useRef(false)
  const [title, setTitle] = React.useState(card.title)
  React.useEffect(() => setTitle(card.title), [card.title])
  // round2 SEV1: the title cell used to be an `<Input>` at all times, which cannot ellipsize -- a
  // long title was simply cut mid-word with no tooltip. It now renders as plain truncated text (with
  // a `title` attribute) and only becomes the editable `Input` on hover/click/Enter, same as Notion/
  // Linear's own inline-rename affordance.
  const [editingTitle, setEditingTitle] = React.useState(false)

  function commitTitle() {
    setEditingTitle(false)
    const next = title.trim()
    if (next && next !== card.title) patchCard.mutate({ id: card.id, patch: { title: next } })
    else setTitle(card.title)
  }

  // The row itself opens the card (no redundant "Ochish" column) -- but a click that lands on one
  // of the row's own editable controls (the title text/input, a picker trigger, the select, the
  // date-picker button) must edit that field instead. Checking `e.target` against the actual
  // interactive tags, rather than wrapping every cell in its own click-swallowing element, keeps
  // every cell a plain grid child (no non-interactive element carries its own click handler, which
  // is what the `jsx-a11y` "must have a keyboard listener" rule is actually guarding against).
  function onRowClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.closest('input, select, textarea, button, a, [role="menu"]')) return
    openCardPeek(card.id)
  }

  return (
    <div
      role="row"
      tabIndex={0}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height,
        gridTemplateColumns: GRID_COLUMNS,
        transform: `translate3d(0, ${top}px, 0)`,
      }}
      // Motion verdict F6. This used to be a `motion.div` whose `y` was driven by `animate`, one
      // framer-motion instance per visible row, re-created as the window slid -- and the audit's own
      // reverted experiment already showed a plain transform is within 4 % of it, so it costs
      // nothing to drop and it removes ~25 projection nodes from every scroll tick.
      //
      // The re-sort tell survives as pure CSS. `top` (from `vRow.start`) only ever changes for an
      // already-mounted row when the *sort order* (or the density row height) moves that card to a
      // different index -- never on plain scrolling, since the virtualiser keeps each mounted row's
      // start fixed and only mounts and unmounts rows at the scroll edges. So a transform transition
      // fires exactly on a re-sort (the row travels to its new place, Linear's own tell) and never
      // once while scrolling, and the reduced-motion backstop in `tokens.css` collapses it for free.
      onClick={onRowClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          openCardPeek(card.id)
        }
      }}
      className="relative grid cursor-pointer items-center gap-2 border-b border-border/60 px-2 transition-transform duration-(--dur-standard) ease-(--ease-out) hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {/* DESIGN.md §9.2's own overdue signal, on a row -- the rail, not (only) a solid-tinted date
          chip, since the row already carries a per-cell risk badge for the "colour is never the
          only signal" text. */}
      {card.risk === 'overdue' ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 w-0.75 rounded-full bg-destructive"
        />
      ) : null}
      <div role="cell">
        <Checkbox
          checked={checked}
          onPointerDown={(e) => {
            shiftRef.current = e.shiftKey
          }}
          onCheckedChange={(v) => onToggle(card.id, v === true, shiftRef.current)}
          aria-label={card.title}
        />
      </div>
      <div role="cell" className="min-w-0">
        {editingTitle ? (
          <Input
            autoFocus
            aria-label={t('work.field.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setTitle(card.title)
                setEditingTitle(false)
              }
            }}
            className="h-9 border-primary bg-transparent"
          />
        ) : (
          <button
            type="button"
            title={card.title}
            onClick={() => setEditingTitle(true)}
            className="h-9 min-w-0 truncate rounded-sm px-2 text-left text-body text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {card.title}
          </button>
        )}
      </div>
      <div role="cell" className="min-w-0">
        <MemberPicker
          members={members}
          value={card.assigneeUserId}
          onChange={(userId) =>
            patchCard.mutate({ id: card.id, patch: { assigneeUserId: userId } })
          }
          placeholderKey="work.field.unassigned"
          triggerClassName="w-full border-transparent bg-transparent px-2 hover:border-border hover:bg-accent"
        />
      </div>
      <div role="cell">
        <Select
          aria-label={t('work.field.priority')}
          value={card.priority}
          onChange={(e) =>
            patchCard.mutate({ id: card.id, patch: { priority: e.target.value as CardPriority } })
          }
          options={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_LABEL_KEY[p]) }))}
          className="h-9 border-transparent bg-transparent px-2 text-small hover:border-border"
        />
      </div>
      <span role="cell" className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {/* Round-2 verification report #3 regression: the date trigger was `w-full shrink-0`, so on
            an overdue row it refused to give up any width to the risk badge next to it -- the badge
            got laid out past the cell's right edge and printed on top of the HOLAT column's status
            Badge. `min-w-0` (dropping the hard `shrink-0`) lets the trigger give up its icon-only
            width first; the risk badge keeps `shrink-0 whitespace-nowrap` so it is always shown whole,
            never the thing that gives. */}
        <DatePicker
          locale={locale}
          label={t('work.field.due')}
          placeholder={t('work.field.due')}
          selected={toDateInputValue(card.dueAt)}
          onSelect={(date) => patchCard.mutate({ id: card.id, patch: { dueAt: dateToIso(date) } })}
          triggerClassName="h-9 min-w-0 border-transparent bg-transparent hover:border-border px-2"
        />
        {card.risk !== 'none'
          ? (() => {
              const RiskIcon = RISK_ICON[RISK_ICON_NAME[card.risk]!]
              return (
                <Badge
                  tone="neutral"
                  className={cn('shrink-0 whitespace-nowrap', RISK_BADGE_CLASSNAME[card.risk])}
                >
                  <RiskIcon className="size-3" aria-hidden="true" />
                  {t(RISK_LABEL_KEY[card.risk])}
                </Badge>
              )
            })()
          : null}
      </span>
      <span role="cell" className="overflow-hidden">
        <Badge tone="neutral" className="whitespace-nowrap">
          {t(`work.status.${card.status}`)}
        </Badge>
      </span>
    </div>
  )
})

/** ui-blitz round3 #30's fix: below `md`, one stacked row (title, then a truncated meta line)
 * instead of the five-column grid `TableRow` renders. Read-only by design -- a phone list item that
 * opens the full editable card peek on tap is the established mobile pattern (Files, Mail, every
 * native list), and it sidesteps the five separate hover-to-edit affordances `TableRow` has room for
 * but a 390px row does not. Selection (the checkbox, bulk bar) still works exactly like the desktop
 * row -- mobile bulk-archiving/assigning a filtered set is a real, common use of this screen. */
const MobileTableRow = React.memo(function MobileTableRow({
  card,
  members,
  checked,
  onToggle,
  top,
  height,
}: {
  card: Card
  members: MemberSummary[]
  checked: boolean
  /** See `TableRow`'s own note: one stable callback for every row. */
  onToggle: (id: string, checked: boolean, shiftKey: boolean) => void
  top: number
  height: number
}) {
  // H4.1/H4.2: same virtualised-row hot spot as `TableRow`, for the mobile layout.
  'use memo'
  const t = useT()
  // Radix's `onCheckedChange` gives no event, so shift is captured on the pointerdown before it.
  const shiftRef = React.useRef(false)
  const assignee = members.find((m) => m.userId === card.assigneeUserId)
  const metaParts = [
    assignee ? fullName(assignee) : t('work.field.unassigned'),
    t(PRIORITY_LABEL_KEY[card.priority]),
    t(`work.status.${card.status}`),
  ]
  if (card.risk !== 'none') metaParts.push(t(RISK_LABEL_KEY[card.risk]))

  function onRowClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.closest('input, button, [role="checkbox"]')) return
    openCardPeek(card.id)
  }

  return (
    <div
      role="row"
      tabIndex={0}
      // Plain transform, same reasoning as `TableRow` above (motion verdict F6).
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height,
        transform: `translate3d(0, ${top}px, 0)`,
      }}
      onClick={onRowClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          openCardPeek(card.id)
        }
      }}
      className="relative flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 transition-transform duration-(--dur-standard) ease-(--ease-out) active:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {card.risk === 'overdue' ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 w-0.75 rounded-full bg-destructive"
        />
      ) : null}
      <div role="cell">
        <Checkbox
          checked={checked}
          onPointerDown={(e) => {
            shiftRef.current = e.shiftKey
          }}
          onCheckedChange={(v) => onToggle(card.id, v === true, shiftRef.current)}
          aria-label={card.title}
        />
      </div>
      <div role="cell" className="min-w-0 flex-1">
        <p className="truncate text-body text-foreground">{card.title}</p>
        <p className="truncate text-caption text-muted-foreground">{metaParts.join(' · ')}</p>
      </div>
    </div>
  )
})
