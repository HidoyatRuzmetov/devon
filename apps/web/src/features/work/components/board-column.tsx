import { avatarUrl } from '../../../lib/avatar.js'
// One People-board column: a sticky, colour-tagged member header (avatar, name, workload count),
// their group-project tiles (EPIC-005), then their cards, an inline "+ Add card" quick-add at the
// foot, and a collapse toggle that shrinks the whole column to a thin rail -- Trello/Plane's own
// column shape (DESIGN.md §9.3). The drop target for "append to the end of this column" is the
// fallback a card's own `dropTargetForElements` (`card-tile.tsx`) never claims because the pointer
// isn't over any card.
import * as React from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { ChevronsLeftRight, ChevronsRightLeft } from 'lucide-react'
import { numberFlowLocale, useLocale, useT } from '@devon/i18n'
import {
  Avatar,
  CountFlow,
  IconButton,
  Stagger,
  StaggerItem,
  cn,
  initialsFromName,
} from '@devon/ui'
import type { Project } from '../../projects/api.js'
import type { Card, Label, MemberSummary } from '../api.js'
import { fullName } from '../lib/format.js'
import { unitColorClass } from '../../../lib/unit-palette.js'
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
  unitPalette: ReadonlyMap<string, string>
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
  /** v1.1 SPEC 3.3: `compact` narrows the column and tightens its header so a 26-person boshqarma
   * fits on one screen instead of seven screens of horizontal scroll. Owned by the board (one
   * preference for the whole board, remembered per viewer), passed down rather than read here. */
  density?: 'comfortable' | 'compact'
  mobile?: boolean
  /** v1.1 SPEC §7 (A8) -- the board's multitask selection, owned by the board and passed straight
   * through to each tile. Omit `onSelectedChange` and the tiles render with no checkbox at all. */
  selectedIds?: ReadonlySet<string>
  onCardSelectedChange?: (cardId: string, selected: boolean, shiftKey: boolean) => void
  selectionActive?: boolean
  /** The card whose move the server just refused, if any -- that tile shakes itself back into place
   * rather than silently reappearing where it started. Owned by the board (the mutation lives
   * there), passed through. */
  rejectedCardId?: string | null
  onRejectionShown?: () => void
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
  allProjects,
  members,
  unitPalette,
  labels,
  filterKey,
  onOpenCard,
  onDropped,
  onMoveTo,
  onCollapsedChange,
  density = 'comfortable',
  mobile = false,
  selectedIds,
  onCardSelectedChange,
  selectionActive = false,
  rejectedCardId = null,
  onRejectionShown,
}: BoardColumnProps) {
  const t = useT()
  // `uz-Latn` groups with an ASCII comma on a real embedded-Chromium ICU; `numberFlowLocale` maps it
  // to `uz-Cyrl`, which groups the way DESIGN.md §5 asks for. Same shim KpiTile's call sites use.
  const locale = numberFlowLocale(useLocale())
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const columnRef = React.useRef<HTMLDivElement | null>(null)
  const headerRef = React.useRef<HTMLDivElement | null>(null)
  const [isDropTarget, setIsDropTarget] = React.useState(false)
  const userId = member?.userId ?? null
  const columnKey = userId ?? 'unassigned'
  const unitKey = member?.unitId ?? (member?.role === 'head' ? 'department' : 'unassigned')
  const unitName =
    member?.unitName ?? t(member?.role === 'head' ? 'headScope.leadership' : 'work.board.noUnit')
  const unitColour = unitColorClass(unitPalette, member?.unitId, member?.role === 'head')
  const unitStyle = {
    '--work-unit-color': `var(${unitColour.replace('bg-', '--color-')})`,
  } as React.CSSProperties
  const [collapsed, setCollapsed] = useColumnCollapsed(columnKey)
  const touchOver = useIsTouchDropTarget(columnKey)

  React.useLayoutEffect(() => {
    const column = columnRef.current
    const header = headerRef.current
    if (!column || !header) return
    // Native focus/scroll-into-view must reserve this sticky header's actual height,
    // including translated text and density changes, plus room for the focus ring.
    const measure = () =>
      column.style.setProperty(
        '--work-column-scroll-margin',
        `calc(${Math.ceil(header.getBoundingClientRect().height)}px + var(--space-2))`,
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [collapsed, mobile])

  React.useEffect(() => {
    onCollapsedChange?.(columnKey, collapsed && !mobile)
  }, [columnKey, collapsed, mobile, onCollapsedChange])

  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source.data['type'] === CARD_DRAG_TYPE,
      getData: () => ({ type: CARD_DRAG_TYPE, toUserId: userId }),
      onDragEnter: () => setIsDropTarget(true),
      onDragLeave: () => setIsDropTarget(false),
      onDrop: ({ source, location }) => {
        setIsDropTarget(false)
        // Drop callbacks bubble through every registered target. A card has already handled its
        // own before/after insertion; the parent must not send a second append-to-end request.
        if (location.current.dropTargets[0]?.element !== el) return
        const cardId = source.data['cardId']
        if (typeof cardId === 'string')
          onDropped(cardId, { kind: 'appendToColumn', toUserId: userId })
      },
    })
  }, [userId, onDropped])

  const overdueCount = cards.filter((c) => c.risk === 'overdue').length

  if (collapsed && !mobile) {
    return (
      <div
        data-board-column={columnKey}
        data-unit-id={unitKey}
        data-unit-color={unitColour}
        style={unitStyle}
        title={unitName}
        className="devon-board-column flex w-11 shrink-0 flex-col items-center gap-2 rounded-md border border-border py-2"
      >
        <IconButton aria-label={t('work.board.expandColumn')} onClick={() => setCollapsed(false)}>
          <ChevronsLeftRight className="size-4" />
        </IconButton>
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            unitColorClass(unitPalette, member?.unitId, member?.role === 'head'),
          )}
          aria-hidden="true"
        />
        {member ? (
          <Avatar
            size="sm"
            src={avatarUrl(member.avatarKey, 64)}
            alt={fullName(member)}
            initials={initialsFromName(member.givenName, member.familyName)}
            hueSeed={member.unitId ?? 'department'}
            className={unitColorClass(unitPalette, member.unitId, member.role === 'head')}
          />
        ) : null}
        <span
          className="mt-1 text-caption font-medium text-muted-foreground [writing-mode:vertical-rl]"
          title={member ? fullName(member) : t('work.board.unassigned')}
        >
          {member ? fullName(member) : t('work.board.unassigned')}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
          <CountFlow value={cards.length} locale={locale} />
        </span>
      </div>
    )
  }

  const compact = density === 'compact'

  return (
    // Columns stretch with the board's content canvas, so every sticky member/add header keeps its
    // full scrolling range even when a different colleague has the longest card list.
    <div
      ref={columnRef}
      data-board-column={columnKey}
      data-unit-id={unitKey}
      data-unit-color={unitColour}
      role="region"
      aria-label={member ? fullName(member) : t('work.board.unassigned')}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- On phones each named person page owns its vertical scrolling.
      tabIndex={mobile ? 0 : undefined}
      style={unitStyle}
      className={cn(
        'devon-board-column flex shrink-0 flex-col gap-1 rounded-md border border-border',
        compact ? 'w-56' : 'w-72',
      )}
    >
      <div
        ref={headerRef}
        className={cn(
          'devon-board-column-header sticky top-0 z-10 flex flex-col gap-2 rounded-t-md px-2 pb-2 shadow-1',
          compact ? 'pt-1' : 'pt-2',
        )}
      >
        <div className="hidden items-center gap-2 md:flex" title={unitName}>
          {member ? (
            <>
              <Avatar
                size="sm"
                src={avatarUrl(member.avatarKey, 64)}
                alt={fullName(member)}
                initials={initialsFromName(member.givenName, member.familyName)}
                hueSeed={member.unitId ?? 'department'}
                className={unitColorClass(unitPalette, member.unitId, member.role === 'head')}
              />
              <div className="min-w-0">
                <p
                  className="line-clamp-2 text-small font-semibold leading-tight text-foreground [overflow-wrap:anywhere]"
                  title={fullName(member)}
                >
                  {fullName(member)}
                </p>
                {/* The job title is the first thing to go at compact density -- the name and the two
                  counts are what a head is scanning for. */}
                {member.title && !compact ? (
                  <p className="truncate text-caption text-muted-foreground">{member.title}</p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-small font-semibold text-muted-foreground">
              {t('work.board.unassigned')}
            </p>
          )}
          {/* The two counts are the direct consequence of the card somebody just dragged in or ticked
            off, so they tick rather than cut (DESIGN.md §10 "Counters"). Tabular figures come with
            `CountFlow`, so 9 -> 10 never nudges the collapse button. */}
          <span
            className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
            title={t('work.board.loadCount', { count: cards.length })}
          >
            <CountFlow value={cards.length} locale={locale} />
          </span>
          {overdueCount > 0 ? (
            <span
              className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-caption text-destructive"
              title={t('work.risk.overdue')}
            >
              <CountFlow value={overdueCount} locale={locale} />
            </span>
          ) : null}
          <IconButton
            aria-label={t('work.board.collapseColumn')}
            onClick={() => setCollapsed(true)}
          >
            <ChevronsRightLeft className="size-4" />
          </IconButton>
        </div>
        <QuickAddBar members={members} defaultAssigneeUserId={userId} compact />
        <div className="flex items-center justify-between text-caption text-muted-foreground md:hidden">
          <span>{t('work.board.loadCount', { count: cards.length })}</span>
          {overdueCount > 0 ? (
            <span className="text-destructive">
              {t('work.risk.overdue')} · {overdueCount}
            </span>
          ) : null}
        </div>
      </div>

      {/* One shared two-axis region owns scrolling. Card lists remain plain blocks; the sticky
          member and quick-add header gives every column the same direct action at any depth. */}
      <div
        ref={listRef}
        data-dnd-column={columnKey}
        data-drop-target={isDropTarget || touchOver || undefined}
        className="flex-1 rounded-md p-1 outline-2 outline-offset-2
          outline-transparent transition-colors duration-(--dur-micro)
          data-[drop-target]:bg-accent/40 data-[drop-target]:outline-primary/40"
      >
        <div className="flex min-h-24 flex-col gap-2">
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
                  unitPalette={unitPalette}
                  labels={labels}
                  projects={allProjects}
                  onOpen={onOpenCard}
                  onDropped={onDropped}
                  onMoveTo={onMoveTo}
                  selected={selectedIds?.has(card.id) ?? false}
                  selectionActive={selectionActive}
                  rejected={rejectedCardId === card.id}
                  {...(onRejectionShown ? { onRejectedDone: onRejectionShown } : {})}
                  {...(onCardSelectedChange
                    ? {
                        onSelectedChange: (selected: boolean, shiftKey: boolean) =>
                          onCardSelectedChange(card.id, selected, shiftKey),
                      }
                    : {})}
                />
              </StaggerItem>
            ))}
          </Stagger>
          {cards.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-caption text-muted-foreground">
              {t('work.board.columnEmpty')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
