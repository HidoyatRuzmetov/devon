// One People-board card (TECH-SPEC §5). Drag source AND drop target at once (a card is both
// "the thing you pick up" and "the thing you drop next to") via `@atlaskit/pragmatic-drag-and-drop`
// -- mouse only; `MoveToMenu` below is the keyboard-operable equivalent (TECH-SPEC "works with mouse
// and keyboard"), reachable from the same card without a pointer, and both paths call the identical
// `onMoved` prop so `useAnnounce()`'s live region reports the same sentence either way.
import * as React from 'react'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
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
  MessageSquare,
  Minus,
  MoveRight,
} from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HoverLift,
  IconButton,
  PressScale,
  initialsFromName,
} from '@devon/ui'
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
}

function isDragPayload(data: Record<string, unknown>): data is DragPayload {
  return data['type'] === CARD_DRAG_TYPE
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
}: CardTileProps) {
  const t = useT()
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [closestEdge, setClosestEdge] = React.useState<Edge | null>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
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
  }, [card.id, columnUserId])

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
      role="button"
      tabIndex={0}
      data-dragging={isDragging || undefined}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(card.id)
        }
      }}
      className="group flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-left shadow-1
        transition-colors duration-(--dur-micro) hover:border-ring/50 focus-visible:outline-none
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        data-[dragging]:opacity-40"
    >
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
        <p className="text-small font-medium leading-snug text-foreground">{card.title}</p>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100"
            aria-hidden="true"
          >
            <GripVertical className="size-4" />
          </span>
          <MoveToMenu card={card} members={members} onMoveTo={onMoveTo} />
        </div>
      </div>

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
        {card.giverUserId ? (
          <span title={t('work.field.giver')}>
            {(() => {
              const giver = members.find((m) => m.userId === card.giverUserId)
              return giver ? (
                <Avatar
                  size="sm"
                  src={null}
                  alt={fullName(giver)}
                  initials={initialsFromName(giver.givenName, giver.familyName)}
                  hueSeed={giver.userId}
                />
              ) : null
            })()}
          </span>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="relative">
      {closestEdge === 'top' ? (
        <div
          className="absolute -top-1 inset-x-1 z-10 h-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : null}
      <PressScale disabled={isDragging}>
        <HoverLift disabled={isDragging}>{cardBody}</HoverLift>
      </PressScale>
      {closestEdge === 'bottom' ? (
        <div
          className="absolute -bottom-1 inset-x-1 z-10 h-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : null}
    </div>
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
