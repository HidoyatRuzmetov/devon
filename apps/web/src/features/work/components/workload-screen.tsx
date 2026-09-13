// v1.1 SPEC §7 (A4) -- the workload grid: a row per person, a column per week, each cell the summed
// estimate of that person's cards due that week against their own weekly capacity.
//
// Head-only as a *grid* (the server refuses `/work/workload` for a member); a member opening this
// route gets their own single row through `/work/workload/mine`, which is the one call they are
// allowed to make. That is the whole of SPEC §2.2's rule here: transparency about the department's
// work, privacy about one person's load.
//
// The "Hisobga olinmagan" panel is not decoration. A workload grid lies in exactly two ways -- a card
// with no due date lands in no week, and a card with no estimate adds nothing to any bar -- so both
// counts sit next to the grid rather than being silently excluded from it.
import * as React from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, GripVertical, Users } from 'lucide-react'
import { DEFAULT_WEEKLY_CAPACITY_HOURS } from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Avatar,
  Button,
  IconButton,
  Input,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SectionCard,
  Skeleton,
  StateView,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  initialsFromName,
  toast,
} from '@devon/ui'
import { useDepartment, useSession } from '../../../lib/session.js'
import { useCardsQuery } from '../hooks.js'
import {
  useCapacityQuery,
  useMoveWorkloadMutation,
  useMyWorkloadQuery,
  usePutCapacityMutation,
  useWorkloadQuery,
} from '../hooks-plus.js'
import { formatHoursNumber } from '../lib/estimate.js'
import { fullName, shortName } from '../lib/format.js'
import type { Workload, WorkloadCell, WorkloadRow } from '../api-plus.js'
import type { Card } from '../api.js'

const WEEKS_SHOWN = 6

/** Monday (UTC, `YYYY-MM-DD`) of the week an ISO instant falls in -- the same bucketing the server
 * does, so a card the grid counts in a column is the card this function puts in that column. */
function weekStartOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)),
  )
  return monday.toISOString().slice(0, 10)
}

/**
 * The cards behind each cell, keyed `userId|weekStart`.
 *
 * The workload endpoint returns *totals*, not cards -- which is right, because six weeks times
 * twenty-six people must not carry every card on the wire. But a card cannot be dragged without
 * existing on screen, so the cards themselves come from the list the rest of the module already
 * reads, grouped here by the same rule the server groups by. The numbers in the cells stay the
 * server's; this map only decides what is draggable out of one.
 */
function groupCards(cards: readonly Card[]): ReadonlyMap<string, Card[]> {
  const map = new Map<string, Card[]>()
  for (const card of cards) {
    if (card.status !== 'active' || !card.dueAt || !card.assigneeUserId) continue
    const key = `${card.assigneeUserId}|${weekStartOf(card.dueAt)}`
    const list = map.get(key)
    if (list) list.push(card)
    else map.set(key, [card])
  }
  return map
}

/** Monday of the week `offsetWeeks` from this one, as `YYYY-MM-DD`. The API's `start` is always a
 * Monday; sending anything else would silently shift every column by a day. */
function mondayIso(offsetWeeks: number): string {
  const now = new Date()
  const day = now.getUTCDay() === 0 ? 7 : now.getUTCDay()
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)),
  )
  monday.setUTCDate(monday.getUTCDate() + offsetWeeks * 7)
  return monday.toISOString().slice(0, 10)
}

/**
 * A4's three-step colour. Deliberately three steps and not a gradient: the question a head asks a
 * workload grid is "who is over, who is at the line, who has room", which is three answers. A
 * continuous ramp turns that into a judgement call about shades of orange.
 *
 * Colour is never the only signal -- every cell prints its hours, and the over-capacity step also
 * carries a warning glyph.
 */
function loadStep(hours: number, capacity: number): 'free' | 'near' | 'over' {
  if (capacity <= 0) return hours > 0 ? 'over' : 'free'
  const ratio = hours / capacity
  if (ratio > 1) return 'over'
  if (ratio >= 0.8) return 'near'
  return 'free'
}

const STEP_CLASS: Record<'free' | 'near' | 'over', string> = {
  free: 'bg-success/10 text-foreground',
  near: 'bg-warning/20 text-foreground',
  over: 'bg-destructive/20 text-foreground',
}

function Cell({
  cell,
  capacity,
  memberName,
  cards,
  onDropCard,
  canDrag,
}: {
  cell: WorkloadCell
  capacity: number
  memberName: string
  cards: readonly Card[]
  onDropCard: (cardId: string) => void
  canDrag: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [over, setOver] = React.useState(false)
  const step = loadStep(cell.estimateHours, capacity)

  const summary = t('work.workload.cellSummary', {
    name: memberName,
    week: formatDate(new Date(cell.weekStart), locale),
    hours: formatHoursNumber(cell.estimateHours),
    capacity: formatHoursNumber(capacity),
    cards: cell.cardCount,
  })

  const cellBody = (
    <div
      // A drop target *and* a disclosure: clicking opens the cards behind the number, which is where
      // a drag starts. The drag has a keyboard equivalent -- the card sheet's own assignee and
      // due-date fields move exactly the same card.
      onDragOver={
        canDrag
          ? (e) => {
              e.preventDefault()
              setOver(true)
            }
          : undefined
      }
      onDragLeave={canDrag ? () => setOver(false) : undefined}
      onDrop={
        canDrag
          ? (e) => {
              e.preventDefault()
              setOver(false)
              const cardId = e.dataTransfer.getData('text/devon-card')
              if (cardId) onDropCard(cardId)
            }
          : undefined
      }
      className={cn(
        'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-sm border px-2 py-1.5 transition-colors duration-(--dur-micro)',
        STEP_CLASS[step],
        over ? 'border-primary ring-2 ring-ring' : 'border-transparent',
      )}
    >
      <span className="flex items-center gap-1 text-small font-semibold tabular-nums">
        {step === 'over' ? (
          <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
        ) : null}
        {formatHoursNumber(cell.estimateHours)}
      </span>
      <span className="text-caption text-muted-foreground">
        {t('work.workload.cardCount', { count: cell.cardCount })}
      </span>
    </div>
  )

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={summary}
                className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {cellBody}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{summary}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="center" className="w-72">
        <p className="mb-2 text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {summary}
        </p>
        {cards.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t('work.workload.cellEmpty')}</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {cards.map((card) => (
              <li key={card.id}>
                <div
                  draggable={canDrag}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/devon-card', card.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5 text-small',
                    canDrag && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  {canDrag ? (
                    <GripVertical
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{card.title}</span>
                  {card.estimateMin ? (
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {formatHoursNumber(card.estimateMin / 60)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * A4's "per-person capacity overrides", edited where the number is actually read rather than buried
 * in a settings screen nobody opens while looking at a red week.
 *
 * `canEdit` is the same rule the API enforces (`plus-routes.ts`: a member sets their own, the head
 * sets anybody's) -- the client only hides a control that would be refused anyway. A capacity still
 * on the registry default shows as such instead of pretending somebody chose 40.
 */
function CapacityCell({
  userId,
  hours,
  isDefault,
  canEdit,
}: {
  userId: string
  hours: number
  isDefault: boolean
  canEdit: boolean
}): React.JSX.Element {
  const t = useT()
  const putCapacity = usePutCapacityMutation()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(String(hours))

  React.useEffect(() => setDraft(String(hours)), [hours])

  function commit(): void {
    setEditing(false)
    const next = Number(draft)
    if (!Number.isFinite(next) || next < 0 || next > 168) {
      setDraft(String(hours))
      toast.error(t('work.workload.capacityInvalid'))
      return
    }
    if (next === hours) return
    putCapacity.mutate(
      { userId, weeklyHours: next },
      {
        onSuccess: () => toast.success(t('work.workload.capacitySaved')),
        onError: () => {
          setDraft(String(hours))
          toast.error(t('work.workload.capacityFailed'))
        },
      },
    )
  }

  if (!canEdit) {
    return (
      <span className="truncate text-caption tabular-nums text-muted-foreground">
        {t('work.workload.capacityValue', { hours: formatHoursNumber(hours) })}
      </span>
    )
  }

  if (editing) {
    return (
      <Input
        autoFocus
        type="number"
        min={0}
        max={168}
        inputMode="numeric"
        value={draft}
        aria-label={t('work.workload.capacityLabel')}
        className="h-7 w-20 px-1.5 text-caption"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(String(hours))
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={t('work.workload.capacityEdit')}
      className="truncate rounded-sm text-left text-caption tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t('work.workload.capacityValue', { hours: formatHoursNumber(hours) })}
      {isDefault ? ` · ${t('work.workload.capacityDefault')}` : ''}
    </button>
  )
}

function Row({
  row,
  cardsByCell,
  onMove,
  canDrag,
  capacityIsDefault,
  canEditCapacity,
}: {
  row: WorkloadRow
  cardsByCell: ReadonlyMap<string, Card[]>
  onMove: (cardId: string, toUserId: string, toWeekStart: string) => void
  canDrag: boolean
  capacityIsDefault: boolean
  canEditCapacity: boolean
}): React.JSX.Element {
  const capacity = row.capacityHours || DEFAULT_WEEKLY_CAPACITY_HOURS
  const name = fullName(row.member)
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center gap-2 bg-card py-1.5 pr-3">
        <Avatar
          alt={name}
          {...(row.member.avatarKey ? { src: row.member.avatarKey } : {})}
          initials={initialsFromName(row.member.givenName, row.member.familyName)}
          hueSeed={row.member.userId}
          size="sm"
        />
        <div className="min-w-0">
          <p className="truncate text-small font-medium text-foreground">{shortName(row.member)}</p>
          <CapacityCell
            userId={row.member.userId}
            hours={capacity}
            isDefault={capacityIsDefault}
            canEdit={canEditCapacity}
          />
        </div>
      </div>
      {row.cells.map((cell) => (
        <Cell
          key={cell.weekStart}
          cell={cell}
          capacity={capacity}
          memberName={name}
          cards={cardsByCell.get(`${row.member.userId}|${cell.weekStart}`) ?? []}
          canDrag={canDrag}
          onDropCard={(cardId) => onMove(cardId, row.member.userId, cell.weekStart)}
        />
      ))}
    </>
  )
}

function Grid({
  workload,
  cardsByCell,
  canDrag,
  onMove,
  defaultCapacityUserIds,
  canEditCapacityFor,
}: {
  workload: Workload
  cardsByCell: ReadonlyMap<string, Card[]>
  canDrag: boolean
  onMove: (cardId: string, toUserId: string, toWeekStart: string) => void
  defaultCapacityUserIds: ReadonlySet<string>
  canEditCapacityFor: (userId: string) => boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  return (
    // The grid scrolls inside its own container -- the page body never scrolls sideways.
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[44rem] gap-1"
        style={{
          gridTemplateColumns: `12rem repeat(${workload.weekStarts.length}, minmax(5rem, 1fr))`,
        }}
        role="table"
        aria-label={t('work.workload.title')}
      >
        <div className="sticky left-0 z-10 bg-card" />
        {workload.weekStarts.map((weekStart) => (
          <div
            key={weekStart}
            className="pb-1 text-center text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground"
          >
            {formatDate(new Date(weekStart), locale)}
          </div>
        ))}
        {workload.rows.map((row) => (
          <Row
            key={row.member.userId}
            row={row}
            cardsByCell={cardsByCell}
            onMove={onMove}
            canDrag={canDrag}
            capacityIsDefault={defaultCapacityUserIds.has(row.member.userId)}
            canEditCapacity={canEditCapacityFor(row.member.userId)}
          />
        ))}
      </div>
    </div>
  )
}

export default function WorkloadScreen(): React.JSX.Element {
  const t = useT()
  const { department } = useDepartment()
  const { user } = useSession()
  const isHead = department?.role === 'head'
  const [offset, setOffset] = React.useState(0)
  const start = mondayIso(offset)
  const query = { weeks: WEEKS_SHOWN, start }

  // Exactly one of these ever runs: a member never calls the head-only grid endpoint, so they never
  // see a 403 they could do nothing about.
  const headQuery = useWorkloadQuery(query, isHead)
  const mineQuery = useMyWorkloadQuery(query, !isHead)
  const active = isHead ? headQuery : mineQuery
  const moveCard = useMoveWorkloadMutation()
  const cardsQuery = useCardsQuery({ limit: 100 })
  const cardsByCell = React.useMemo(() => groupCards(cardsQuery.data ?? []), [cardsQuery.data])
  // Which rows are still on the registry default -- the row says so rather than showing 40 as if
  // somebody had chosen it. Head-only: `/work/capacity` is a management read.
  const capacityQuery = useCapacityQuery(isHead)
  const defaultCapacityUserIds = React.useMemo(
    () => new Set((capacityQuery.data ?? []).filter((r) => r.isDefault).map((r) => r.userId)),
    [capacityQuery.data],
  )

  function move(cardId: string, toUserId: string, toWeekStart: string): void {
    moveCard.mutate(
      { cardId, toUserId, toWeekStart },
      {
        onSuccess: () => toast.success(t('work.workload.moved')),
        onError: () => toast.error(t('work.workload.moveFailed')),
      },
    )
  }

  let body: React.ReactNode
  if (active.isPending) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  } else if (active.isError) {
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void active.refetch() }}
      />
    )
  } else if (active.data.rows.length === 0) {
    body = (
      <StateView
        kind="empty"
        titleKey="work.workload.emptyTitle"
        bodyKey="work.workload.emptyBody"
      />
    )
  } else {
    const workload = active.data
    body = (
      <div className="flex flex-col gap-4">
        <Grid
          workload={workload}
          cardsByCell={cardsByCell}
          canDrag={isHead}
          onMove={move}
          defaultCapacityUserIds={defaultCapacityUserIds}
          canEditCapacityFor={(userId) => isHead || userId === user?.id}
        />
        {/* The two ways a workload grid quietly lies, stated rather than hidden. */}
        {workload.unscheduled.noDueDate > 0 || workload.unscheduled.noEstimate > 0 ? (
          <SectionCard title={t('work.workload.unscheduledTitle')}>
            <ul className="flex flex-col gap-1 text-small text-muted-foreground">
              {workload.unscheduled.noDueDate > 0 ? (
                <li>{t('work.workload.noDueDate', { count: workload.unscheduled.noDueDate })}</li>
              ) : null}
              {workload.unscheduled.noEstimate > 0 ? (
                <li>{t('work.workload.noEstimate', { count: workload.unscheduled.noEstimate })}</li>
              ) : null}
            </ul>
          </SectionCard>
        ) : null}
        <div className="flex flex-wrap items-center gap-4 text-caption text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-success/40" aria-hidden="true" />
            {t('work.workload.legendFree')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-warning/50" aria-hidden="true" />
            {t('work.workload.legendNear')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-destructive/40" aria-hidden="true" />
            {t('work.workload.legendOver')}
          </span>
          {isHead ? <span>{t('work.workload.dragHint')}</span> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={t('work.eyebrow')}
        title={t('work.workload.title')}
        description={isHead ? t('work.workload.description') : t('work.workload.descriptionMine')}
        actions={
          <div className="flex items-center gap-1">
            <IconButton
              aria-label={t('work.workload.previousWeeks')}
              onClick={() => setOffset((v) => v - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </IconButton>
            <Button variant="ghost" size="sm" onClick={() => setOffset(0)} disabled={offset === 0}>
              {t('work.workload.today')}
            </Button>
            <IconButton
              aria-label={t('work.workload.nextWeeks')}
              onClick={() => setOffset((v) => v + 1)}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        }
      />
      {!isHead ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-small text-muted-foreground"
        >
          <Users className="size-4 shrink-0" aria-hidden="true" />
          {t('work.workload.memberNotice')}
        </p>
      ) : null}
      {body}
    </div>
  )
}
