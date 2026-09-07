// One People-board column: a sticky, colour-tagged member header (avatar, name, workload count),
// their group-project tiles (EPIC-005), then their cards, an inline "+ Add card" quick-add at the
// foot, and a collapse toggle that shrinks the whole column to a thin rail -- Trello/Plane's own
// column shape (DESIGN.md §9.3). The drop target for "append to the end of this column" is the
// fallback a card's own `dropTargetForElements` (`card-tile.tsx`) never claims because the pointer
// isn't over any card.
import * as React from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { ChevronsLeftRight, ChevronsRightLeft } from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  Avatar,
  IconButton,
  Stagger,
  StaggerItem,
  cn,
  initialsFromName,
  unitHueClass,
} from '@devon/ui'
import { ProjectTile } from '../../projects/components/project-tile.js'
import type { Project } from '../../projects/api.js'
import type { Card, Label, MemberSummary } from '../api.js'
import { fullName } from '../lib/format.js'
import { useIsTouchDropTarget } from '../lib/touch-drag.js'
import { CARD_DRAG_TYPE, CardTile, type CardDropSpec } from './card-tile.js'
import { QuickAddBar } from './quick-add-bar.js'

export interface BoardColumnProps {
  member: MemberSummary | null // null = the "unassigned" column
  cards: readonly Card[]
  /** This member's own group-project tiles, rendered above their cards. */
  projects: readonly Project[]
  /** Every project in the department, regardless of membership -- looked up per card for the small
   * project chip (`card-tile.tsx`), which needs the full roster because a card can carry a
   * `projectId` its assignee isn't listed as a member of. */
  allProjects: readonly Project[]
  members: readonly MemberSummary[]
  labels: readonly Label[]
  /** Re-triggers the card list's entrance stagger when it changes -- the board's current `?q=`
   * filter text (UI-OVERHAUL.md §3 "Lists, grids, tiles": "on first render and on filter change"). */
  filterKey?: string
  onOpenCard: (cardId: string) => void
  onDropped: (draggedCardId: string, spec: CardDropSpec) => void
  onMoveTo: (cardId: string, toUserId: string | null) => void
  /** Lets the board report a "showing N of M" affordance for its collapse toggles without lifting
   * the (per-viewer, `localStorage`-backed) collapsed state itself out of each column. */
  onCollapsedChange?: (columnKey: string, collapsed: boolean) => void
}

/** Column collapse is a per-viewer convenience, not shared state -- `localStorage` (guarded: private
 * windows and blocked site data must never break the board). */
function useColumnCollapsed(key: string): [boolean, (next: boolean) => void] {
  const storageKey = `devon.work.columnCollapsed.${key}`
  const [collapsed, setCollapsedState] = React.useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })
  const setCollapsed = React.useCallback(
    (next: boolean) => {
      setCollapsedState(next)
      try {
        if (next) window.localStorage.setItem(storageKey, '1')
        else window.localStorage.removeItem(storageKey)
      } catch {
        // Best-effort only -- collapse still works for this render even if it can't persist.
      }
    },
    [storageKey],
  )
  return [collapsed, setCollapsed]
}

export function BoardColumn({
  member,
  cards,
  projects,
  allProjects,
  members,
  labels,
  filterKey,
  onOpenCard,
  onDropped,
  onMoveTo,
  onCollapsedChange,
}: BoardColumnProps) {
  const t = useT()
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [isDropTarget, setIsDropTarget] = React.useState(false)
  const userId = member?.userId ?? null
  const columnKey = userId ?? 'unassigned'
  const [collapsed, setCollapsed] = useColumnCollapsed(columnKey)
  const touchOver = useIsTouchDropTarget(columnKey)

  React.useEffect(() => {
    onCollapsedChange?.(columnKey, collapsed)
  }, [columnKey, collapsed, onCollapsedChange])

  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source.data['type'] === CARD_DRAG_TYPE,
      getData: () => ({ type: CARD_DRAG_TYPE, toUserId: userId }),
      onDragEnter: () => setIsDropTarget(true),
      onDragLeave: () => setIsDropTarget(false),
      onDrop: ({ source }) => {
        setIsDropTarget(false)
        const cardId = source.data['cardId']
        if (typeof cardId === 'string')
          onDropped(cardId, { kind: 'appendToColumn', toUserId: userId })
      },
    })
  }, [userId, onDropped])

  const overdueCount = cards.filter((c) => c.risk === 'overdue').length

  if (collapsed) {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-md border border-border bg-card py-2">
        <IconButton aria-label={t('work.board.expandColumn')} onClick={() => setCollapsed(false)}>
          <ChevronsLeftRight className="size-4" />
        </IconButton>
        <span
          className={cn('size-1.5 shrink-0 rounded-full', unitHueClass(userId ?? 'unassigned'))}
          aria-hidden="true"
        />
        {member ? (
          <Avatar
            size="sm"
            src={null}
            alt={fullName(member)}
            initials={initialsFromName(member.givenName, member.familyName)}
            hueSeed={member.userId}
          />
        ) : null}
        <span
          className="mt-1 text-caption font-medium text-muted-foreground [writing-mode:vertical-rl]"
          title={member ? fullName(member) : t('work.board.unassigned')}
        >
          {member ? fullName(member) : t('work.board.unassigned')}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-caption tabular-nums text-muted-foreground">
          {cards.length}
        </span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col gap-2">
      <div
        className={cn(
          'sticky top-0 z-10 flex items-center gap-2 rounded-md bg-surface-2 px-2 py-2 shadow-1',
        )}
      >
        <span
          className={cn('size-2.5 shrink-0 rounded-full', unitHueClass(userId ?? 'unassigned'))}
          aria-hidden="true"
        />
        {member ? (
          <>
            <Avatar
              size="sm"
              src={null}
              alt={fullName(member)}
              initials={initialsFromName(member.givenName, member.familyName)}
              hueSeed={member.userId}
            />
            <div className="min-w-0">
              <p className="truncate text-small font-semibold text-foreground">
                {fullName(member)}
              </p>
              {member.title ? (
                <p className="truncate text-caption text-muted-foreground">{member.title}</p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-small font-semibold text-muted-foreground">
            {t('work.board.unassigned')}
          </p>
        )}
        <span
          className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-caption tabular-nums text-muted-foreground"
          title={t('work.board.loadCount', { count: cards.length })}
        >
          {cards.length}
        </span>
        {overdueCount > 0 ? (
          <span
            className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-caption tabular-nums text-destructive"
            title={t('work.risk.overdue')}
          >
            {overdueCount}
          </span>
        ) : null}
        <IconButton aria-label={t('work.board.collapseColumn')} onClick={() => setCollapsed(true)}>
          <ChevronsRightLeft className="size-4" />
        </IconButton>
      </div>
      {/* `min-h-0` + `overflow-y-auto`: this list, not the column or the board row, is the thing
          that scrolls -- without it the column grows to its content height and the scroller row
          above (which now has a real, viewport-bounded height) either clips it or lets the document
          grow instead, exactly the "board is not a board" defect this fixes. */}
      <div
        ref={listRef}
        data-dnd-column={columnKey}
        data-drop-target={isDropTarget || touchOver || undefined}
        className="min-h-0 flex-1 overflow-y-auto rounded-md p-1 outline-2 outline-offset-2
          outline-transparent transition-colors duration-(--dur-micro)
          data-[drop-target]:bg-accent/40 data-[drop-target]:outline-primary/40"
      >
        <div className="flex min-h-24 flex-col gap-2">
          {projects.map((p) => (
            <ProjectTile key={p.id} project={p} />
          ))}
          <Stagger
            className="flex flex-col gap-2"
            {...(filterKey !== undefined ? { animateKey: filterKey } : {})}
          >
            {cards.map((card) => (
              <StaggerItem key={card.id}>
                <CardTile
                  card={card}
                  columnUserId={userId}
                  members={members}
                  labels={labels}
                  projects={allProjects}
                  onOpen={onOpenCard}
                  onDropped={onDropped}
                  onMoveTo={onMoveTo}
                />
              </StaggerItem>
            ))}
          </Stagger>
          {cards.length === 0 && projects.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-caption text-muted-foreground">
              {t('work.board.columnEmpty')}
            </p>
          ) : null}
        </div>
      </div>
      {/* The add-card row as the column's footer: outside the scrolling list, always in view. */}
      <div className="px-1">
        <QuickAddBar members={members} defaultAssigneeUserId={userId} compact />
      </div>
    </div>
  )
}
