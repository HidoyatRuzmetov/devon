// One People-board card (TECH-SPEC §5). Drag source AND drop target at once (a card is both
// "the thing you pick up" and "the thing you drop next to"). Two drag adapters, chosen by input
// type: mouse/pen keeps `@atlaskit/pragmatic-drag-and-drop`'s native HTML5 adapter (enhanced with a
// custom drag-image preview -- the browser tracks it against the real pointer for free, so this is
// a genuine pointer-following preview, not a fake one); a touch pointer never fires native HTML5
// drag events at all, so it runs a second, hand-rolled pointer path (`lib/touch-drag.ts`) with a
// long-press-to-lift gesture and its own floating preview (`touch-drag-preview.tsx`). `MoveToMenu`
// below is the keyboard-operable equivalent of both (TECH-SPEC "works with mouse and keyboard"),
// reachable from the same card without a pointer, and every path calls the identical `onDropped`/
// `onMoveTo` props so `useAnnounce()`'s live region reports the same sentence regardless of input.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { motion } from 'motion/react'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { preserveOffsetOnSource } from '@atlaskit/pragmatic-drag-and-drop/utils/preserve-offset-on-source'
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/utils/set-custom-native-drag-preview'
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import {
  CalendarClock,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Eye,
  GripVertical,
  Link2,
  ListChecks,
  Lock,
  MessageSquare,
  Minus,
  MoveRight,
  Pin,
  Repeat,
  Timer,
} from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { useCardSignals } from '../../../lib/realtime/index.js'
import {
  Avatar,
  Badge,
  Checkbox,
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HoverLift,
  IconButton,
  LivePulse,
  PressScale,
  Shake,
  initialsFromName,
  springSettle,
  useReducedMotion,
} from '@devon/ui'
import { formatDurationShort } from '../lib/estimate.js'
import type { Card, Label, MemberSummary } from '../api.js'
import type { Project } from '../../projects/api.js'
import {
  DUE_CHIP_TONE,
  PRIORITY_BADGE_TONE,
  PRIORITY_ICON_NAME,
  PRIORITY_LABEL_KEY,
  RISK_LABEL_KEY,
  fullName,
} from '../lib/format.js'
import { touchDrag } from '../lib/touch-drag.js'

/** A touch drag lifts after this long a press -- long enough that a scroll gesture (which moves the
 * finger within a few pixels almost immediately) never gets mistaken for a lift, short enough that
 * a deliberate hold reads as immediate. */
const TOUCH_LIFT_MS = 350
/** A touch move before the lift timer fires this far cancels the lift -- the finger is scrolling the
 * column, not picking up the card. */
const TOUCH_MOVE_CANCEL_PX = 8

const PRIORITY_ICON = { ChevronsUp, ChevronUp, Minus, ChevronDown } as const

export const CARD_DRAG_TYPE = 'devon-work-card'

type DragPayload = { type: typeof CARD_DRAG_TYPE; cardId: string; fromUserId: string | null }

export type CardDropSpec =
  | { kind: 'onCard'; targetCardId: string; edge: Edge; toUserId: string | null }
  | { kind: 'appendToColumn'; toUserId: string | null }

export interface CardTileProps {
  card: Card
  columnUserId: string | null
  members: readonly MemberSummary[]
  labels: readonly Label[]
  /** Looked up by `card.projectId` for the small project chip (Trello/Plane show which project a
   * card belongs to right on the tile, not only inside the detail panel). */
  projects?: readonly Project[]
  onOpen: (cardId: string) => void
  onDropped: (draggedCardId: string, spec: CardDropSpec) => void
  onMoveTo: (cardId: string, toUserId: string | null) => void
  /** v1.1 SPEC §7 (A8). Omit both to get a tile with no selection affordance at all -- the archive
   * and any future read-only board keep exactly the v1.0 tile. When they are supplied the checkbox
   * is revealed on hover/focus, or permanently once anything in the board is selected, which is the
   * pattern every list of this kind uses (Jakob's Law) and which keeps a 26-column board from
   * growing 300 permanent checkboxes. */
  selected?: boolean
  onSelectedChange?: (selected: boolean, shiftKey: boolean) => void
  /** True while *any* card on the board is selected -- pins every checkbox visible so the selection
   * can be extended without hunting for hover targets. */
  selectionActive?: boolean
  /** Set for a beat when a move this card just made was refused by the server and rolled back.
   * Without it the optimistic move simply un-happened between two frames, which reads as the drag
   * having missed rather than as the server having said no (DESIGN.md §10 "rollback shake"). */
  rejected?: boolean
  onRejectedDone?: () => void
}

function isDragPayload(data: Record<string, unknown>): data is DragPayload {
  return data['type'] === CARD_DRAG_TYPE
}

/** v1.1 EPIC-018: "Anvar is editing this" / "Nodira is writing a comment", live, on the tile.
 *
 * Reads the shared signal store (one subscription and one expiry timer for the whole board -- see
 * `lib/realtime/signals-store.ts`), so a card nobody is touching costs this component nothing and
 * never re-renders because of it. Renders nothing at all when nobody is on the card: an indicator
 * that is always present has stopped being an indicator.
 *
 * A dot plus a name, not an avatar: the tile already carries the assignee's face, and a second face
 * meaning something entirely different is how a board becomes unreadable. */
function LiveSignalStrip({ cardId }: { cardId: string }): React.JSX.Element | null {
  const t = useT()
  const signals = useCardSignals(cardId)
  if (signals.length === 0) return null

  const typing = signals.filter((s) => s.kind === 'comment_typing')
  const editing = signals.filter((s) => s.kind === 'card_editing')
  const primary = editing[0] ?? typing[0]!
  const label =
    editing.length > 0
      ? primary.name
        ? t('realtime.signal.editingBy', { name: primary.name })
        : t('realtime.signal.editing')
      : typing.length > 1
        ? t('realtime.signal.typingMany', { count: typing.length })
        : primary.name
          ? t('realtime.signal.typingBy', { name: primary.name })
          : t('realtime.signal.typing')

  return (
    <p
      aria-live="polite"
      className="flex items-center gap-1.5 text-caption text-primary motion-safe:animate-[devon-fade-in_220ms_var(--ease-out)]"
    >
      {/* v1.1 motion pass: this was Tailwind's generic `animate-pulse` behind `motion-safe:`, which
          *deletes* the signal under reduced motion rather than replacing it (DESIGN.md §2.5).
          `LivePulse` breathes on a 2 s loop and falls back to a steady dot, and it is named for a
          screen reader -- the strip's own text is `aria-live`, so the dot carries no new words. */}
      <LivePulse label="" className="mt-px" />
      {label}
    </p>
  )
}

export function CardTile({
  card,
  columnUserId,
  members,
  labels,
  projects = [],
  onOpen,
  onDropped,
  onMoveTo,
  selected = false,
  onSelectedChange,
  selectionActive = false,
  rejected = false,
  onRejectedDone,
}: CardTileProps) {
  const t = useT()
  const reducedMotion = useReducedMotion()
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const shiftRef = React.useRef(false)
  const [closestEdge, setClosestEdge] = React.useState<Edge | null>(null)
  const touchLift = React.useRef<{
    timer: number | null
    startX: number
    startY: number
    active: boolean
  }>({ timer: null, startX: 0, startY: 0, active: false })

  // v1.1 SPEC §2.2 (D6a): a member may read the whole department's board and move only the cards
  // they gave, were given or created (the head moves anything). Without this, dragging a colleague's
  // card would animate, land, 403 and snap back -- the worst of both worlds. `canEdit` is the
  // server's own answer, carried on the card DTO.
  const canMove = card.canEdit !== false

  React.useEffect(() => {
    const el = ref.current
    if (!el || !canMove) return
    return combine(
      draggable({
        element: el,
        getInitialData: (): DragPayload => ({
          type: CARD_DRAG_TYPE,
          cardId: card.id,
          fromUserId: columnUserId,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
        // The native drag *image* (what actually tracks the pointer -- the browser, not JS, moves
        // it) is otherwise a raw screenshot of the source element, edge-clipped by the column's own
        // `overflow-y-auto`. Rendering a standalone, correctly-sized copy at DESIGN.md's "ghost 0.9"
        // opacity, offset from the *original* grab point (`preserveOffsetOnSource`), gives desktop
        // mouse/pen drag the same pointer-following preview the touch path below builds by hand.
        onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
          const rect = el.getBoundingClientRect()
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: preserveOffsetOnSource({ element: el, input: location.current.input }),
            render: ({ container }) => {
              container.style.width = `${rect.width}px`
              const root = createRoot(container)
              root.render(
                <div className="rounded-md border border-border bg-card p-3 text-left opacity-90 shadow-2">
                  <p className="text-small font-medium leading-snug text-foreground">
                    {card.title}
                  </p>
                </div>,
              )
              return () => root.unmount()
            },
          })
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => isDragPayload(source.data) && source.data.cardId !== card.id,
        getData: ({ input, element }) =>
          attachClosestEdge(
            { type: CARD_DRAG_TYPE, cardId: card.id },
            { input, element, allowedEdges: ['top', 'bottom'] },
          ),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: ({ source, self }) => {
          setClosestEdge(null)
          if (!isDragPayload(source.data)) return
          const edge = extractClosestEdge(self.data) ?? 'top'
          onDropped(source.data.cardId, {
            kind: 'onCard',
            targetCardId: card.id,
            edge,
            toUserId: columnUserId,
          })
        },
      }),
    )
    // `card.id`/`columnUserId` capture what the closures above need; `onDropped` is expected stable
    // (defined once per board render via `React.useCallback` in `BoardScreen`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, columnUserId, canMove])

  // Touch-only pointer path (item 9): native HTML5 drag (`draggable()` above) never starts from a
  // touchscreen, so a coarse pointer gets its own long-press-to-lift gesture instead, reusing the
  // exact `onDropped` contract the mouse path uses -- the board never needs to know which one fired.
  function findColumnAndCard(
    x: number,
    y: number,
  ): { columnKey: string | null; cardEl: HTMLElement | null } {
    const el = document.elementFromPoint(x, y)
    const columnEl = el?.closest<HTMLElement>('[data-dnd-column]') ?? null
    const cardEl = el?.closest<HTMLElement>('[data-dnd-card]') ?? null
    return { columnKey: columnEl?.dataset['dndColumn'] ?? null, cardEl }
  }

  function onTouchPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    // Same rule as the mouse path above: no lift gesture on a card this viewer may not move.
    if (!canMove) return
    // Pointer capture, taken immediately (not just once the lift fires): once the finger travels
    // past this element's own bounds, an *uncaptured* pointer's move/up events start targeting
    // whatever element is now underneath it instead -- this card's own handlers would simply stop
    // firing. Capturing keeps every subsequent event for this `pointerId` routed here regardless of
    // where the finger physically is, which is what lets `findColumnAndCard` do its own hit-testing
    // by coordinates instead.
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const timer = window.setTimeout(() => {
      touchLift.current.active = true
      setIsDragging(true)
      touchDrag.start({
        cardId: card.id,
        title: card.title,
        fromUserId: columnUserId,
        pointerX: startX,
        pointerY: startY,
        overColumnKey: null,
      })
    }, TOUCH_LIFT_MS)
    touchLift.current = { timer, startX, startY, active: false }
  }

  function onTouchPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    const lift = touchLift.current
    if (!lift.active) {
      if (
        lift.timer !== null &&
        (Math.abs(e.clientX - lift.startX) > TOUCH_MOVE_CANCEL_PX ||
          Math.abs(e.clientY - lift.startY) > TOUCH_MOVE_CANCEL_PX)
      ) {
        window.clearTimeout(lift.timer)
        lift.timer = null
      }
      return
    }
    e.preventDefault()
    const { columnKey } = findColumnAndCard(e.clientX, e.clientY)
    touchDrag.move({ pointerX: e.clientX, pointerY: e.clientY, overColumnKey: columnKey })
  }

  function onTouchPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    const lift = touchLift.current
    if (lift.timer !== null) window.clearTimeout(lift.timer)
    if (lift.active) {
      const { columnKey, cardEl } = findColumnAndCard(e.clientX, e.clientY)
      if (columnKey !== null) {
        const toUserId = columnKey === 'unassigned' ? null : columnKey
        const targetCardId = cardEl?.dataset['dndCard']
        if (targetCardId && targetCardId !== card.id) {
          const rect = cardEl!.getBoundingClientRect()
          const edge: Edge = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
          onDropped(card.id, { kind: 'onCard', targetCardId, edge, toUserId })
        } else {
          onDropped(card.id, { kind: 'appendToColumn', toUserId })
        }
      }
      touchDrag.end()
      setIsDragging(false)
    }
    touchLift.current = { timer: null, startX: 0, startY: 0, active: false }
  }

  const activeLabels = labels.filter((l) => card.labels.includes(l.id))
  const priorityKey = PRIORITY_LABEL_KEY[card.priority]
  const showPriority = card.priority !== 'none'
  const priorityIconName = PRIORITY_ICON_NAME[card.priority]
  const PriorityIcon = priorityIconName ? PRIORITY_ICON[priorityIconName] : null
  const project = card.projectId ? projects.find((p) => p.id === card.projectId) : undefined
  const locale = useLocale()

  const cardBody = (
    <div
      ref={ref}
      role="group"
      aria-label={card.title}
      data-dragging={isDragging || undefined}
      data-dnd-card={card.id}
      onPointerDown={onTouchPointerDown}
      onPointerMove={onTouchPointerMove}
      onPointerUp={onTouchPointerUp}
      onPointerCancel={onTouchPointerUp}
      className={cn(
        `group relative flex touch-pan-y flex-col gap-2 rounded-md border bg-card p-3 text-left shadow-1
        transition-colors duration-(--dur-micro) hover:border-ring/50 focus-visible:outline-none
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        data-[dragging]:touch-none data-[dragging]:opacity-40`,
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      {onSelectedChange ? (
        <span
          className={cn(
            'absolute right-2 top-2 z-10 transition-opacity duration-(--dur-micro)',
            selected || selectionActive
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Checkbox
            checked={selected}
            size="sm"
            aria-label={t('work.bulk.selectCard', { title: card.title })}
            // The handlers live on the checkbox itself (a real button) rather than on a wrapping
            // span, so the tile behind it never also opens, and no non-interactive element carries
            // a click handler.
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              shiftRef.current = e.shiftKey
            }}
            onCheckedChange={(v) => onSelectedChange(v === true, shiftRef.current)}
          />
        </span>
      ) : null}
      {activeLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {activeLabels.map((l) => (
            <span
              key={l.id}
              className="h-1.5 w-8 rounded-full"
              style={{ backgroundColor: l.colour }}
              title={l.name}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          className="text-left text-small font-medium leading-snug text-foreground after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {card.title}
        </button>
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          {canMove ? (
            <span
              className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100"
              aria-hidden="true"
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          {canMove ? <MoveToMenu card={card} members={members} onMoveTo={onMoveTo} /> : null}
        </div>
      </div>

      <LiveSignalStrip cardId={card.id} />

      {project ? (
        <Chip tone="outline">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: project.colour }}
            aria-hidden="true"
          />
          {project.title}
        </Chip>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {showPriority ? (
          <Badge tone={PRIORITY_BADGE_TONE[card.priority]}>
            {PriorityIcon ? <PriorityIcon className="size-3" aria-hidden="true" /> : null}
            {t(priorityKey)}
          </Badge>
        ) : null}
        {card.dueAt ? (
          <Chip
            tone={DUE_CHIP_TONE[card.risk]}
            title={card.risk !== 'none' ? t(RISK_LABEL_KEY[card.risk]) : undefined}
          >
            <CalendarClock className="size-3" aria-hidden="true" />
            {formatDate(new Date(card.dueAt), locale)}
          </Chip>
        ) : null}
        {/* v1.1 SPEC §7. Each chip is a *fact the tile could not otherwise show*: this card is
            waiting on other work (A10), it comes back on a schedule (A7), somebody sized it (A3),
            it is one of my five (A9). All four are server-computed, so none of them is a guess. */}
        {(card.blockedByOpenCount ?? 0) > 0 ? (
          <Chip
            tone="destructive"
            leading={<Lock className="size-3" />}
            title={t('work.chip.blockedBy', { count: card.blockedByOpenCount ?? 0 })}
          >
            {t('work.chip.blocked')}
          </Chip>
        ) : null}
        {card.recurrence ? (
          <Chip tone="info" leading={<Repeat className="size-3" />} title={t('work.chip.repeats')}>
            {t('work.chip.repeats')}
          </Chip>
        ) : null}
        {card.estimateMin ? (
          <Chip
            tone="outline"
            leading={<Timer className="size-3" />}
            title={t('work.estimate.label')}
          >
            {formatDurationShort(card.estimateMin, t)}
          </Chip>
        ) : null}
        {card.focusPinned ? (
          <Chip tone="primary" leading={<Pin className="size-3" />} title={t('work.focus.title')}>
            {t('work.focus.chip')}
          </Chip>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-caption text-muted-foreground">
        <div className="flex items-center gap-2.5">
          {card.checklistTotal > 0 ? (
            <span className="flex items-center gap-1">
              <ListChecks className="size-3.5" aria-hidden="true" />
              {card.checklistDone}/{card.checklistTotal}
            </span>
          ) : null}
          {card.commentCount > 0 ? (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {card.commentCount}
            </span>
          ) : null}
          {card.links.length > 0 ? (
            <span className="flex items-center gap-1">
              <Link2 className="size-3.5" aria-hidden="true" />
              {card.links.length}
            </span>
          ) : null}
          {card.watchers.length > 0 ? (
            <span className="flex items-center gap-1" title={t('work.field.watchers')}>
              <Eye className="size-3.5" aria-hidden="true" />
              {card.watchers.length}
            </span>
          ) : null}
        </div>
        {/* WALKTHROUGH-FINDINGS 4.8 / SPEC 3.3: the avatar on a card used to be the KIMDAN
            (delegator), so a person's own column showed a dozen different faces and every Trello or
            Jira user read them as the assignee. The main avatar is now the **assignee**; the giver,
            when it is somebody else, is a small secondary avatar overlapped behind it, with a
            tooltip that says which is which -- so "who is doing this" and "who asked for it" are
            both answerable without opening the card. */}
        {(() => {
          const assignee = members.find((m) => m.userId === card.assigneeUserId)
          const giver = members.find((m) => m.userId === card.giverUserId)
          const showGiver = giver && giver.userId !== assignee?.userId
          if (!assignee && !showGiver) return null
          return (
            <span className="flex shrink-0 items-center">
              {showGiver ? (
                <span
                  className="relative z-0 -mr-1.5 opacity-80"
                  title={t('work.card.byGiver', { name: fullName(giver) })}
                >
                  <Avatar
                    size="xs"
                    src={null}
                    alt={t('work.card.byGiver', { name: fullName(giver) })}
                    initials={initialsFromName(giver.givenName, giver.familyName)}
                    hueSeed={giver.userId}
                  />
                </span>
              ) : null}
              {assignee ? (
                <span
                  className="relative z-10 rounded-full ring-2 ring-card"
                  title={t('work.card.assignedTo', { name: fullName(assignee) })}
                >
                  <Avatar
                    size="sm"
                    src={null}
                    alt={t('work.card.assignedTo', { name: fullName(assignee) })}
                    initials={initialsFromName(assignee.givenName, assignee.familyName)}
                    hueSeed={assignee.userId}
                  />
                </span>
              ) : null}
            </span>
          )
        })()}
      </div>
    </div>
  )

  return (
    // `layoutId` (not just `layout`): dropping a card moves it into a *different* column's list, a
    // different React parent, so a plain `layout` (which only tracks one mounted instance) would see
    // an unmount-here/mount-there pair with no animation. A shared `layoutId` bridges the two mounts
    // into one FLIP transition on `spring.settle` -- DESIGN.md's own "drop settle" token -- so the
    // card visibly glides to its new slot instead of popping there. `layout="position"` only, so the
    // card's own text never stretches mid-animation.
    <motion.div
      layout="position"
      layoutId={`work-card-${card.id}`}
      transition={reducedMotion ? { duration: 0 } : springSettle}
      className="relative"
    >
      {closestEdge === 'top' ? (
        <div
          className="absolute -top-1 inset-x-1 z-10 h-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : null}
      <Shake play={rejected} {...(onRejectedDone ? { onDone: onRejectedDone } : {})}>
        <PressScale disabled={isDragging}>
          <HoverLift disabled={isDragging}>{cardBody}</HoverLift>
        </PressScale>
      </Shake>
      {closestEdge === 'bottom' ? (
        <div
          className="absolute -bottom-1 inset-x-1 z-10 h-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : null}
    </motion.div>
  )
}

/** Keyboard/no-pointer path for exactly the same move a mouse drag performs (TECH-SPEC "works with
 * mouse and keyboard"): jumps the card to the top of a chosen member's column, or unassigned. Less
 * granular than a mouse drop's exact insertion point, but reaches every column and every card a
 * pointer can, with a fully-labelled, arrow-key-navigable menu. */
function MoveToMenu({
  card,
  members,
  onMoveTo,
}: {
  card: Card
  members: readonly MemberSummary[]
  onMoveTo: (cardId: string, toUserId: string | null) => void
}) {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={t('work.card.moveTo')} onClick={(e) => e.stopPropagation()}>
          <ChevronDown className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel>{t('work.card.moveTo')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onMoveTo(card.id, null)}
          disabled={card.assigneeUserId === null}
        >
          <MoveRight className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('work.field.unassigned')}
        </DropdownMenuItem>
        {members.map((m) => (
          <DropdownMenuItem
            key={m.userId}
            onSelect={() => onMoveTo(card.id, m.userId)}
            disabled={card.assigneeUserId === m.userId}
          >
            <Avatar
              size="sm"
              src={null}
              alt={fullName(m)}
              initials={initialsFromName(m.givenName, m.familyName)}
              hueSeed={m.userId}
            />
            {fullName(m)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
