// Table view (TECH-SPEC §5): every card the current `?q=` filter matches, one row each, row-
// virtualised (TanStack Virtual -- exact pinned version, `apps/web/package.json`) behind a sticky
// header, with column sort, row checkboxes and a bulk action bar (assign/label/archive, archive
// undoable), a density toggle, and inline edit on title/assignee/due -- the same `usePatchCardMutation`
// the card peek uses, so an edit here and an edit there are optimistic the same way. Built on CSS grid
// plain `div`s rather than a real HTML table: a virtualised row needs `position: absolute` for its
// transform-based offset, which browsers do not reliably honour on a genuine table-row element.
import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock3,
  Tag,
  UserRound,
  X,
} from 'lucide-react'
import { useT, useLocale } from '@devon/i18n'
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  Skeleton,
  springSettle,
  StateView,
  cn,
  toastWithUndo,
  useReducedMotion,
} from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { useMediaQuery } from '../../../lib/use-media-query.js'
import { useViewportBoundedHeight } from '../../../lib/use-viewport-bounded-height.js'
import {
  useCardsQuery,
  useLabelsQuery,
  useMembers,
  usePatchCardMutation,
  useRestoreCardMutation,
} from '../hooks.js'
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
import { WorkShell } from './work-shell.js'
import type { Card, CardPriority, Label, MemberSummary } from '../api.js'

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
  )
}

// ui-blitz round3 #30: below this the grid's five fixed-width columns (300+180+120+260+140px) no
// longer fit any phone -- `TableScreen` swaps `TableRow`'s grid for `MobileTableRow`'s stacked
// title+meta-line card below this width, matching the shell's own `md:` cutover everywhere else
// (`work-shell.tsx`'s `useMediaQuery('(min-width: 768px)')`) rather than picking a new breakpoint.
const MOBILE_ROW_HEIGHT = 64

export default function TableScreen() {
  const t = useT()
  const reducedMotion = useReducedMotion()
  const search = useSearchParams()
  const q = search.get('q') ?? ''
  const cardsQuery = useCardsQuery({ q: q || undefined, limit: 100 })
  const members = useMembers()
  const labels = useLabelsQuery().data ?? []
  const patchCard = usePatchCardMutation()
  const restoreCard = useRestoreCardMutation()
  const [density, setDensity] = useLocalStorageDensity()
  const [sort, setSort] = React.useState<SortState | null>(null)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [heightRef, scrollerHeight] = useViewportBoundedHeight<HTMLDivElement>(280)
  const scrollElRef = React.useRef<HTMLDivElement | null>(null)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const cards = React.useMemo(() => cardsQuery.data ?? [], [cardsQuery.data])
  const rowHeight = isDesktop ? (density === 'compact' ? 40 : 56) : MOBILE_ROW_HEIGHT

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

  // Selection is cleared whenever the underlying id set changes shape (a filter narrows the list, a
  // poll removes an archived card) so the bulk bar never quietly acts on rows no longer shown.
  const cardIds = React.useMemo(() => cards.map((c) => c.id).join(','), [cards])
  React.useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(cardIds ? cardIds.split(',') : [])
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [cardIds])

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(sorted.map((c) => c.id)) : new Set())
  }

  const selectedCards = sorted.filter((c) => selected.has(c.id))

  async function bulkAssign(userId: string | null) {
    const ids = [...selected]
    // TECH-SPEC §16 "no query in a loop": each card's PATCH is independent, so one `Promise.all`
    // (not an awaited loop) is both correct and as fast as the slowest single request.
    await Promise.all(
      ids.map((id) => patchCard.mutateAsync({ id, patch: { assigneeUserId: userId } })),
    )
  }

  async function bulkAddLabel(labelId: string) {
    const targets = selectedCards.filter((c) => !c.labels.includes(labelId))
    await Promise.all(
      targets.map((c) =>
        patchCard.mutateAsync({ id: c.id, patch: { labels: [...c.labels, labelId] } }),
      ),
    )
  }

  async function bulkArchive() {
    const ids = [...selected]
    await Promise.all(ids.map((id) => patchCard.mutateAsync({ id, patch: { status: 'archived' } })))
    setSelected(new Set())
    toastWithUndo({
      message: t('work.table.bulk.archived', { count: ids.length }),
      undoLabel: t('action.undo'),
      onUndo: () => void Promise.all(ids.map((id) => restoreCard.mutateAsync(id))),
    })
  }

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  })

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
        ref={(el) => {
          scrollElRef.current = el
          heightRef(el)
        }}
        className="overflow-auto rounded-md border border-border"
        style={{ height: scrollerHeight }}
      >
        {/* `minWidth: 1020` is exactly the desktop grid's own column widths -- forcing that on a
            390px viewport is what made the mobile table "a horizontally-scrolled data grid" (round3
            #30); `MobileTableRow`'s stacked layout needs no fixed width at all, so it is simply
            omitted below `md`. */}
        <div style={isDesktop ? { minWidth: 1020 } : undefined}>
          {isDesktop ? (
            <div
              className="sticky top-0 z-10 grid items-center gap-2 border-b border-border bg-card px-2"
              style={{ gridTemplateColumns: GRID_COLUMNS, height: 40 }}
            >
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label={t('work.table.selectAll')}
              />
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
            <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label={t('work.table.selectAll')}
              />
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
          )}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const card = sorted[vRow.index]!
              return isDesktop ? (
                <TableRow
                  key={card.id}
                  card={card}
                  members={members}
                  checked={selected.has(card.id)}
                  onCheckedChange={(v) => toggleRow(card.id, v)}
                  top={vRow.start}
                  height={vRow.size}
                />
              ) : (
                <MobileTableRow
                  key={card.id}
                  card={card}
                  members={members}
                  checked={selected.has(card.id)}
                  onCheckedChange={(v) => toggleRow(card.id, v)}
                  top={vRow.start}
                  height={vRow.size}
                />
              )
            })}
          </div>
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
            <AnimatePresence>
              {selected.size > 0 ? (
                <motion.div
                  key="bulk-bar"
                  className="absolute inset-x-0 top-0"
                  initial={reducedMotion ? { opacity: 0 } : { y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { y: 12, opacity: 0 }}
                  transition={reducedMotion ? { duration: 0.15 } : springSettle}
                >
                  <BulkBar
                    count={selected.size}
                    members={members}
                    labels={labels}
                    onAssign={(id) => void bulkAssign(id)}
                    onAddLabel={(id) => void bulkAddLabel(id)}
                    onArchive={() => void bulkArchive()}
                    onClear={() => setSelected(new Set())}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
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

function BulkBar({
  count,
  members,
  labels,
  onAssign,
  onAddLabel,
  onArchive,
  onClear,
}: {
  count: number
  members: MemberSummary[]
  labels: Label[] | undefined
  onAssign: (userId: string | null) => void
  onAddLabel: (labelId: string) => void
  onArchive: () => void
  onClear: () => void
}) {
  const t = useT()
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 shadow-1">
      <span className="text-small font-medium text-foreground">
        {t('work.table.bulk.selectedCount', { count })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary">
            <UserRound className="size-3.5" aria-hidden="true" />
            {t('work.table.bulk.assign')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuItem onSelect={() => onAssign(null)}>
            {t('work.field.unassigned')}
          </DropdownMenuItem>
          {members.map((m) => (
            <DropdownMenuItem key={m.userId} onSelect={() => onAssign(m.userId)}>
              {fullName(m)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" disabled={!labels || labels.length === 0}>
            <Tag className="size-3.5" aria-hidden="true" />
            {t('work.table.bulk.addLabel')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          {(labels ?? []).map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => onAddLabel(l.id)}>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: l.colour }}
                aria-hidden="true"
              />
              {l.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="secondary" onClick={onArchive}>
        {t('work.card.archive')}
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        <X className="size-3.5" aria-hidden="true" />
        {t('work.table.bulk.clear')}
      </Button>
    </div>
  )
}

function TableRow({
  card,
  members,
  checked,
  onCheckedChange,
  top,
  height,
}: {
  card: Card
  members: MemberSummary[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  top: number
  height: number
}) {
  const t = useT()
  const locale = useLocale()
  const reduced = useReducedMotion()
  const patchCard = usePatchCardMutation()
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
    <motion.div
      role="row"
      tabIndex={0}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height,
        gridTemplateColumns: GRID_COLUMNS,
      }}
      // UI-OVERHAUL.md §3 "Lists, grids, tiles" + the round-3 table FLIP: this list is
      // `useVirtualizer`-backed (rows mount and unmount continuously as the 200+-row table
      // scrolls), so a JS `Stagger`/`StaggerItem` pair here would mean mounting a fresh
      // framer-motion instance, with its own per-item stagger delay, on every scroll tick -- still
      // avoided. But `top` (from `vRow.start`) only ever changes for an already-mounted row when
      // the *sort order* (or the density row height) moves that same card to a different index --
      // never on plain scrolling, since the virtualizer keeps each mounted row's own start fixed
      // and only mounts/unmounts rows at the scroll edges. Driving `y` through `animate` (transform
      // only, never `top`/layout) means a re-sort reads as the row *travelling* to its new place
      // (Linear's own re-sort tell) while a first mount still gets the plain fade + 4px rise; both
      // share one `transition` so neither needs its own bookkeeping.
      initial={reduced ? { opacity: 1, y: top } : { opacity: 0, y: top + 4 }}
      animate={{ opacity: 1, y: top }}
      transition={reduced ? { duration: 0.12 } : { duration: 0.22, ease: 'easeOut' }}
      onClick={onRowClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          openCardPeek(card.id)
        }
      }}
      className="relative grid cursor-pointer items-center gap-2 border-b border-border/60 px-2 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-label={card.title}
      />
      {editingTitle ? (
        <Input
          autoFocus
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
      <MemberPicker
        members={members}
        value={card.assigneeUserId}
        onChange={(userId) => patchCard.mutate({ id: card.id, patch: { assigneeUserId: userId } })}
        placeholderKey="work.field.unassigned"
        triggerClassName="w-full border-transparent bg-transparent px-2 hover:border-border hover:bg-accent"
      />
      <Select
        aria-label={t('work.field.priority')}
        value={card.priority}
        onChange={(e) =>
          patchCard.mutate({ id: card.id, patch: { priority: e.target.value as CardPriority } })
        }
        options={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_LABEL_KEY[p]) }))}
        className="h-9 border-transparent bg-transparent px-2 text-small hover:border-border"
      />
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
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
      <span className="overflow-hidden">
        <Badge tone="neutral" className="whitespace-nowrap">
          {t(`work.status.${card.status}`)}
        </Badge>
      </span>
    </motion.div>
  )
}

/** ui-blitz round3 #30's fix: below `md`, one stacked row (title, then a truncated meta line)
 * instead of the five-column grid `TableRow` renders. Read-only by design -- a phone list item that
 * opens the full editable card peek on tap is the established mobile pattern (Files, Mail, every
 * native list), and it sidesteps the five separate hover-to-edit affordances `TableRow` has room for
 * but a 390px row does not. Selection (the checkbox, bulk bar) still works exactly like the desktop
 * row -- mobile bulk-archiving/assigning a filtered set is a real, common use of this screen. */
function MobileTableRow({
  card,
  members,
  checked,
  onCheckedChange,
  top,
  height,
}: {
  card: Card
  members: MemberSummary[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  top: number
  height: number
}) {
  const t = useT()
  const reduced = useReducedMotion()
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
    <motion.div
      role="row"
      tabIndex={0}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height }}
      initial={reduced ? { opacity: 1, y: top } : { opacity: 0, y: top + 4 }}
      animate={{ opacity: 1, y: top }}
      transition={reduced ? { duration: 0.12 } : { duration: 0.22, ease: 'easeOut' }}
      onClick={onRowClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          openCardPeek(card.id)
        }
      }}
      className="relative flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 active:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {card.risk === 'overdue' ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 w-0.75 rounded-full bg-destructive"
        />
      ) : null}
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-label={card.title}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-foreground">{card.title}</p>
        <p className="truncate text-caption text-muted-foreground">{metaParts.join(' · ')}</p>
      </div>
    </motion.div>
  )
}
