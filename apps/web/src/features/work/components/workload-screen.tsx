// v1.1 SPEC §7 (A4) -- the workload grid: a row per person, a column per week, each cell the summed
// estimate of that person's cards due that week against their own weekly capacity.
//
// Head-only as a *grid* (the server refuses `/work/workload` for a member); a member opening this
// route gets their own single row through `/work/workload/mine`, which is the one call they are
// allowed to make. That is the whole of SPEC §2.2's rule here: transparency about the department's
// work, privacy about one person's load.
//
// **v1.1 critique SEV1 #3.** The head's signature management view used to say everyone had room
// while the dashboard said the department was drowning: 27 rows x 6 weeks, every cell green, four
// week columns entirely "0 / 0 ta". Nothing ever crossed a threshold because -- as the page itself
// admitted, in a panel *below* all 27 rows -- 37 cards had no due date and 93 had no estimate. Half
// the department's work was invisible to the view whose only job is to show load. Four changes, all
// of them about honesty rather than colour:
//
//   1. The two counts moved from a footnote into a **header warning strip**, and each number is a
//      link to that exact card list (`due:boʻsh`, `estimate:boʻsh` -- the filter grammar learned
//      those two clauses for this). A number a head cannot act on is decoration.
//   2. The legend moved **above** the grid and now states its thresholds instead of naming three
//      colours. A legend under 27 rows is a legend nobody reads.
//   3. When estimates cover **under half** the open work the grid stops pretending: it colours by
//      open-card count against a stated per-week allowance and says so, on a badge, with the
//      percentage that made it switch. A grid that reads "joy bor" for everyone because two thirds
//      of the work is unpriced is worse than one that admits what it is counting.
//   4. The **current week** column is marked, in the header and down the column, so "this week" is
//      not something the head has to work out from six dates.
//
// **SEV2 #12.** This screen imported no motion component at all -- no skeleton, no stagger, no
// NumberFlow, no transition when the week changed -- and read as a spreadsheet someone pasted in.
// It now has a matching-layout skeleton, `Stagger` on the rows, `StatNumber` (NumberFlow) on the
// hour cells, and an `--ease-standard` colour transition keyed to the visible week window.
//
// **SEV2 #29.** The rows used to read "Aliyev A." -- a fifth name format nobody else in the product
// uses -- while being *sorted by given name*, so a head scanning a surname column saw A, B, B, D, D,
// F... apparently at random. DESIGN.md §5: "Ism Familiya in casual lists". The rows now render and
// sort by the same key.
import * as React from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Users,
} from 'lucide-react'
import { DEFAULT_WEEKLY_CAPACITY_HOURS } from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  IconButton,
  Input,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SectionCard,
  Skeleton,
  Stagger,
  StaggerItem,
  StatNumber,
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
import { fullName } from '../lib/format.js'
import type { Workload, WorkloadCell, WorkloadRow } from '../api-plus.js'
import type { Card } from '../api.js'

const WEEKS_SHOWN = 6

/**
 * Below this share of the open work carrying an estimate, the hour columns are not a picture of load
 * -- they are a picture of who happens to have filled an optional field. Half is the line because at
 * half the grid is as likely to be wrong as right, and because it is a number a head can check
 * against the warning strip's own "N ta karta baholanmagan" in one glance.
 */
const ESTIMATE_COVERAGE_FLOOR = 0.5

/** The nominal size of one card when counting instead of summing, used only to turn a person's
 * weekly *hours* capacity into a weekly *card* allowance. Four hours = half a working day, which is
 * what a card on this department's board typically is. Stated in the legend, never hidden. */
const NOMINAL_HOURS_PER_CARD = 4

type ColourMode = 'hours' | 'count'

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
 * Colour is never the only signal -- every cell prints its number, and the over-capacity step also
 * carries a warning glyph.
 *
 * SEV1 #3: `mode` is the honesty switch. In `'count'` mode the same three steps are measured against
 * a card allowance derived from the person's own capacity, because the hours are not there to
 * measure.
 */
function loadStep(
  cell: WorkloadCell,
  capacity: number,
  mode: ColourMode,
): 'free' | 'near' | 'over' {
  if (mode === 'count') {
    const allowance = cardAllowance(capacity)
    if (allowance <= 0) return cell.cardCount > 0 ? 'over' : 'free'
    const ratio = cell.cardCount / allowance
    if (ratio > 1) return 'over'
    if (ratio >= 0.8) return 'near'
    return 'free'
  }
  if (capacity <= 0) return cell.estimateHours > 0 ? 'over' : 'free'
  const ratio = cell.estimateHours / capacity
  if (ratio > 1) return 'over'
  if (ratio >= 0.8) return 'near'
  return 'free'
}

/** How many cards one person's week holds, at the stated nominal size. Rounded down and never below
 * one, so somebody on a 4-hour week is still allowed a card before turning red. */
function cardAllowance(capacityHours: number): number {
  return Math.max(1, Math.floor(capacityHours / NOMINAL_HOURS_PER_CARD))
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
  mode,
  isCurrentWeek,
}: {
  cell: WorkloadCell
  capacity: number
  memberName: string
  cards: readonly Card[]
  onDropCard: (cardId: string) => void
  canDrag: boolean
  mode: ColourMode
  isCurrentWeek: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [over, setOver] = React.useState(false)
  const step = loadStep(cell, capacity, mode)

  const summary =
    mode === 'count'
      ? t('work.workload.cellSummaryCount', {
          name: memberName,
          week: formatDate(new Date(cell.weekStart), locale),
          cards: cell.cardCount,
          allowance: cardAllowance(capacity),
        })
      : t('work.workload.cellSummary', {
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
        'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-sm border px-2 py-1.5',
        // SEV2 #12: the colour eases rather than snapping when the week window moves. The duration
        // token collapses to 0ms under `prefers-reduced-motion` (tokens.css), so this is the
        // reduced-motion-safe way to express it.
        'transition-colors duration-(--dur-standard) ease-(--ease-standard)',
        STEP_CLASS[step],
        over ? 'border-primary ring-2 ring-ring' : 'border-transparent',
        isCurrentWeek && !over && 'border-primary/40',
      )}
    >
      <span className="flex items-center gap-1 text-small font-semibold tabular-nums">
        {step === 'over' ? (
          <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
        ) : null}
        {mode === 'count' ? (
          <StatNumber value={cell.cardCount} locale={locale} />
        ) : (
          // `formatHoursNumber` can produce a fraction ("6,5"); NumberFlow rolls the whole thing.
          <StatNumber value={Number(cell.estimateHours.toFixed(1))} locale={locale} />
        )}
      </span>
      <span className="text-caption text-muted-foreground">
        {mode === 'count'
          ? t('work.workload.capacityValue', { hours: formatHoursNumber(cell.estimateHours) })
          : t('work.workload.cardCount', { count: cell.cardCount })}
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
  mode,
  currentWeek,
}: {
  row: WorkloadRow
  cardsByCell: ReadonlyMap<string, Card[]>
  onMove: (cardId: string, toUserId: string, toWeekStart: string) => void
  canDrag: boolean
  capacityIsDefault: boolean
  canEditCapacity: boolean
  mode: ColourMode
  currentWeek: string
}): React.JSX.Element {
  const capacity = row.capacityHours || DEFAULT_WEEKLY_CAPACITY_HOURS
  // SEV2 #29: one name format, and it is the one every other casual list in the product uses.
  const name = fullName(row.member)
  return (
    <>
      <StaggerItem className="sticky left-0 z-10 flex items-center gap-2 bg-card py-1.5 pr-3">
        <Avatar
          alt={name}
          {...(row.member.avatarKey ? { src: row.member.avatarKey } : {})}
          initials={initialsFromName(row.member.givenName, row.member.familyName)}
          hueSeed={row.member.userId}
          size="sm"
        />
        <div className="min-w-0">
          <p className="truncate text-small font-medium text-foreground">{name}</p>
          <CapacityCell
            userId={row.member.userId}
            hours={capacity}
            isDefault={capacityIsDefault}
            canEdit={canEditCapacity}
          />
        </div>
      </StaggerItem>
      {row.cells.map((cell) => (
        <StaggerItem key={cell.weekStart}>
          <Cell
            cell={cell}
            capacity={capacity}
            memberName={name}
            mode={mode}
            isCurrentWeek={cell.weekStart === currentWeek}
            cards={cardsByCell.get(`${row.member.userId}|${cell.weekStart}`) ?? []}
            canDrag={canDrag}
            onDropCard={(cardId) => onMove(cardId, row.member.userId, cell.weekStart)}
          />
        </StaggerItem>
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
  mode,
  currentWeek,
}: {
  workload: Workload
  cardsByCell: ReadonlyMap<string, Card[]>
  canDrag: boolean
  onMove: (cardId: string, toUserId: string, toWeekStart: string) => void
  defaultCapacityUserIds: ReadonlySet<string>
  canEditCapacityFor: (userId: string) => boolean
  mode: ColourMode
  currentWeek: string
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  // SEV2 #29: sorted by the key the row actually shows. Sorting by given name while printing
  // surnames is what made the column look randomly ordered.
  const rows = React.useMemo(
    () => [...workload.rows].sort((a, b) => fullName(a.member).localeCompare(fullName(b.member))),
    [workload.rows],
  )
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
            className={cn(
              'pb-1 text-center text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing)',
              weekStart === currentWeek
                ? 'rounded-t-sm border-b-2 border-primary text-primary'
                : 'text-muted-foreground',
            )}
          >
            {formatDate(new Date(weekStart), locale)}
            {weekStart === currentWeek ? (
              <span className="block text-caption normal-case tracking-normal text-primary">
                {t('work.workload.currentWeek')}
              </span>
            ) : null}
          </div>
        ))}
        {/* SEV2 #12: `display:contents` keeps the stagger container out of the grid's own layout, so
            every cell stays a direct grid item while the rows still enter in sequence. `animateKey`
            re-runs the stagger when the week window or the colour mode changes. */}
        <Stagger
          as="div"
          className="contents"
          animateKey={`${workload.weekStarts[0] ?? ''}|${mode}`}
        >
          {rows.map((row) => (
            <Row
              key={row.member.userId}
              row={row}
              cardsByCell={cardsByCell}
              onMove={onMove}
              canDrag={canDrag}
              mode={mode}
              currentWeek={currentWeek}
              capacityIsDefault={defaultCapacityUserIds.has(row.member.userId)}
              canEditCapacity={canEditCapacityFor(row.member.userId)}
            />
          ))}
        </Stagger>
      </div>
    </div>
  )
}

/**
 * SEV2 #12: a skeleton with the grid's own shape -- a name column and six week columns -- rather
 * than five full-width bars. The point of a skeleton is that the layout does not jump when the
 * answer arrives.
 */
function GridSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-9 w-full max-w-2xl rounded-md" />
      <div className="overflow-hidden">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `12rem repeat(${WEEKS_SHOWN}, minmax(5rem, 1fr))` }}
        >
          <div />
          {Array.from({ length: WEEKS_SHOWN }).map((_, i) => (
            <Skeleton key={`h${i}`} className="mb-1 h-4 w-full rounded-sm" />
          ))}
          {Array.from({ length: 8 }).map((_, r) => (
            <React.Fragment key={`r${r}`}>
              <div className="flex items-center gap-2 py-1.5 pr-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Skeleton className="h-3.5 w-28 rounded-sm" />
                  <Skeleton className="h-3 w-20 rounded-sm" />
                </div>
              </div>
              {Array.from({ length: WEEKS_SHOWN }).map((_, c) => (
                <Skeleton key={`c${r}-${c}`} className="h-14 w-full rounded-sm" />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * SEV1 #3's header warning. Two numbers, both links, both above the grid rather than under 27 rows.
 * `due:boʻsh` / `estimate:boʻsh` are real clauses of the shared filter grammar, so these open the
 * table already narrowed to exactly the cards this grid could not draw.
 */
function CoverageWarning({
  noDueDate,
  noEstimate,
}: {
  noDueDate: number
  noEstimate: number
}): React.JSX.Element | null {
  const t = useT()
  if (noDueDate === 0 && noEstimate === 0) return null
  const links: { key: string; label: string; href: string }[] = []
  if (noDueDate > 0) {
    links.push({
      key: 'due',
      label: t('work.workload.warningNoDue', { count: noDueDate }),
      href: `/work/table?q=${encodeURIComponent('status:active due:boʻsh')}`,
    })
  }
  if (noEstimate > 0) {
    links.push({
      key: 'estimate',
      label: t('work.workload.warningNoEstimate', { count: noEstimate }),
      href: `/work/table?q=${encodeURIComponent('status:active estimate:boʻsh')}`,
    })
  }
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5"
    >
      <p className="flex items-center gap-2 text-small font-medium text-foreground">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-warning" />
        {t('work.workload.warningTitle')}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {links.map((link) => (
          <li key={link.key}>
            <a
              href={link.href}
              className="inline-flex items-center gap-1 rounded-sm text-small text-foreground underline decoration-warning decoration-2 underline-offset-4 transition-colors duration-(--dur-micro) ease-(--ease-standard) hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {link.label}
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
              <span className="sr-only"> — {t('work.workload.warningOpenLink')}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** SEV1 #3: above the grid, and it states what each colour *means* rather than repeating its name. */
function Legend({
  mode,
  coveragePct,
  canDrag,
}: {
  mode: ColourMode
  coveragePct: number
  canDrag: boolean
}): React.JSX.Element {
  const t = useT()
  // One person's allowance at the department default -- the legend has to name a number, and this is
  // the one almost every row uses. A row with its own capacity gets its own threshold in the cell
  // tooltip.
  const near = Math.max(1, Math.round(cardAllowance(DEFAULT_WEEKLY_CAPACITY_HOURS) * 0.8))
  const over = cardAllowance(DEFAULT_WEEKLY_CAPACITY_HOURS)
  const steps: { key: 'free' | 'near' | 'over'; swatch: string; text: string }[] = [
    {
      key: 'free',
      swatch: 'bg-success/40',
      text:
        mode === 'count'
          ? t('work.workload.legendFreeCount', { near })
          : t('work.workload.legendFreeHours'),
    },
    {
      key: 'near',
      swatch: 'bg-warning/50',
      text:
        mode === 'count'
          ? t('work.workload.legendNearCount', { near, over })
          : t('work.workload.legendNearHours'),
    },
    {
      key: 'over',
      swatch: 'bg-destructive/40',
      text:
        mode === 'count'
          ? t('work.workload.legendOverCount', { over })
          : t('work.workload.legendOverHours'),
    },
  ]
  const stepLabel: Record<'free' | 'near' | 'over', string> = {
    free: t('work.workload.legendFree'),
    near: t('work.workload.legendNear'),
    over: t('work.workload.legendOver'),
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption font-medium uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('work.workload.legendTitle')}
        </span>
        <Badge variant="subtle" tone={mode === 'count' ? 'warning' : 'neutral'}>
          {mode === 'count' ? t('work.workload.modeCountBadge') : t('work.workload.modeHoursBadge')}
        </Badge>
      </div>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption text-muted-foreground">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-1.5">
            <span className={cn('size-3 shrink-0 rounded-sm', step.swatch)} aria-hidden="true" />
            <span className="text-foreground">{stepLabel[step.key]}</span>
            <span>— {step.text}</span>
          </li>
        ))}
      </ul>
      {mode === 'count' ? (
        <p className="text-caption text-muted-foreground">
          {t('work.workload.modeCountWhy', { pct: coveragePct })}
        </p>
      ) : null}
      {canDrag ? (
        <p className="text-caption text-muted-foreground">{t('work.workload.dragHint')}</p>
      ) : null}
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
  const currentWeek = mondayIso(0)
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
    body = <GridSkeleton />
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
    // SEV1 #3: how much of the open work the hour columns can actually see. `openTotal === 0` is not
    // "0% covered" -- it is "nothing to cover", so the grid stays in its normal mode.
    const openTotal = workload.unscheduled.openTotal
    const coverage = openTotal > 0 ? (openTotal - workload.unscheduled.noEstimate) / openTotal : 1
    const mode: ColourMode = coverage < ESTIMATE_COVERAGE_FLOOR ? 'count' : 'hours'
    const coveragePct = Math.round(coverage * 100)

    body = (
      <div className="flex flex-col gap-4">
        <CoverageWarning
          noDueDate={workload.unscheduled.noDueDate}
          noEstimate={workload.unscheduled.noEstimate}
        />
        <Legend mode={mode} coveragePct={coveragePct} canDrag={isHead} />
        <Grid
          workload={workload}
          cardsByCell={cardsByCell}
          canDrag={isHead}
          onMove={move}
          mode={mode}
          currentWeek={currentWeek}
          defaultCapacityUserIds={defaultCapacityUserIds}
          canEditCapacityFor={(userId) => isHead || userId === user?.id}
        />
        {/* The full breakdown still lives below the grid, for the head who wants the sentence as
            well as the link. The header strip is what makes it actionable. */}
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
