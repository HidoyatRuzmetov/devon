// The People board (TECH-SPEC §5, EPIC-004's centrepiece): one column per member, grouped under a
// colour-coded bo'lim section, unassigned last.
//
// v1.1 SPEC §3.3 changed three defaults, all of them for the same reason: a head who opens the
// department board and sees his own seven tasks has learned nothing about his department
// (WALKTHROUGH-FINDINGS §2.1 -- 187 of 189 open cards were hidden behind a secondary pill).
//  1. **Hammasi is the default for everyone.** "Mening" is still one click away and is remembered
//     per person, but the board opens as what it says it is: the department.
//  2. **Columns are grouped by boʻlim**, the way the org chart is, with "Boʻlimsiz" last -- the
//     grouping EPIC-003's units finally make possible (`getMembers` brings the unit back with the
//     member now, one left join, no extra round trip).
//  3. **A head's columns are ordered by trouble**: overdue first, then open load. The five people
//     who need attention are the five leftmost columns instead of being alphabetically scattered
//     across seven screens of horizontal scroll.
// Plus the two affordances a 26-column board needs and did not have: collapse-all, and a compact
// density that fits roughly twice as many columns on a 1440px screen.
//
// Virtualisation is intentionally
// not wired in here: at this build's demo scale (~250 cards over 16 columns, TECH-SPEC §14) a plain
// `overflow-x-auto` row of `overflow-y-auto` columns scrolls smoothly with no windowing library; revisit
// if a real department's card count grows an order of magnitude past the demo.
import * as React from 'react'
import { cardMatchesFilterText, parseFilterQuery } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { IconButton, SegmentedControl, Skeleton, StateView, cn, unitHueClass } from '@devon/ui'
import { ChevronsLeftRight, Rows3, Rows4 } from 'lucide-react'
import { useDepartment, useSession } from '../../../lib/session.js'
import { useSearchParams } from '../../../lib/router.js'
import { useViewportBoundedHeight } from '../../../lib/use-viewport-bounded-height.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import type { Card } from '../api.js'
import { keyBetween } from '../lib/fractional.js'
import { useAnnounce, DndAnnouncerProvider } from './dnd-announcer.js'
import { useBoardQuery, useMoveCardMutation } from '../hooks.js'
import { BoardColumn } from './board-column.js'
import { CardPeekDialog, openCardPeek } from './card-peek-dialog.js'
import { TouchDragPreviewLayer } from './touch-drag-preview.js'
import { WorkShell } from './work-shell.js'
import type { CardDropSpec } from './card-tile.js'
import { fullName } from '../lib/format.js'

/** One per-viewer string preference, remembered by user id so a shared machine never leaks one
 * person's board layout onto the next signed-in user. Guarded: a private window or blocked site data
 * must never break the board (DESIGN.md; the same shape `useColumnCollapsed` uses). */
function useStoredPreference<T extends string>(
  name: string,
  userId: string | undefined,
  fallback: T,
  isValid: (v: string) => v is T,
): [T, (v: T) => void] {
  const key = `devon.work.board.${name}.${userId ?? 'anon'}`
  const [value, setValue] = React.useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored && isValid(stored) ? stored : fallback
    } catch {
      return fallback
    }
  })
  const setAndStore = React.useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, next)
      } catch {
        // Best-effort only -- the choice still applies to this render.
      }
    },
    [key],
  )
  return [value, setAndStore]
}

/** SPEC §3.3: "Hammasi | Mening", persisted per user. `all` is the default for everyone, head and
 * member alike -- the board is the department's, and a member who wants only their own column says
 * so once. */
type BoardScope = 'all' | 'mine'
const isBoardScope = (v: string): v is BoardScope => v === 'all' || v === 'mine'

/** SPEC §3.3: a density that fits a 26-person boshqarma on one screen. */
type BoardDensity = 'comfortable' | 'compact'
const isBoardDensity = (v: string): v is BoardDensity => v === 'comfortable' || v === 'compact'

function findMemberMatches(
  needle: string,
  members: readonly { userId: string; givenName: string; familyName: string }[],
): string[] {
  const q = needle.replace(/^@/, '').toLowerCase()
  return members
    .filter((m) => m.givenName.toLowerCase().includes(q) || m.familyName.toLowerCase().includes(q))
    .map((m) => m.userId)
}

function BoardScreenInner() {
  // H4.1: a measured hot spot (`vite.config.ts`'s own note) -- up to ~27 columns of drag-and-drop
  // cards re-rendering on every filter keystroke, drag frame, and poll tick; opted into the React
  // Compiler individually rather than via a blanket `compiler: true`.
  'use memo'
  const t = useT()
  const { department, departmentId } = useDepartment()
  const { user } = useSession()
  const [scope, setScope] = useStoredPreference<BoardScope>('scope', user?.id, 'all', isBoardScope)
  const [density, setDensity] = useStoredPreference<BoardDensity>(
    'density',
    user?.id,
    'comfortable',
    isBoardDensity,
  )
  const isHead = department?.role === 'head'
  // UI-OVERHAUL.md "pin the board to the viewport": the app shell's `<main>` has no bounded height
  // of its own, so the plain `h-full`/`flex-1`/`min-h-0` chain below did nothing and the columns
  // grew to their content height with the *document* scrolling -- see use-viewport-bounded-height.ts.
  const [heightRef, scrollerHeight] = useViewportBoundedHeight<HTMLDivElement>(320)
  const scrollerElRef = React.useRef<HTMLDivElement | null>(null)
  const [showRightFade, setShowRightFade] = React.useState(false)
  const updateEdgeFade = React.useCallback((e: React.UIEvent<HTMLDivElement> | undefined) => {
    const el = e ? e.currentTarget : scrollerElRef.current
    if (!el) return
    setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])
  const setScrollerRefs = React.useCallback(
    (el: HTMLDivElement | null) => {
      scrollerElRef.current = el
      heightRef(el)
      // Re-check once the columns have actually rendered/resized (member count, filter results),
      // not just on scroll -- a department that grows past the visible width should show the fade
      // immediately, before anyone has touched the scrollbar.
      if (el) requestAnimationFrame(() => updateEdgeFade(undefined))
    },
    [heightRef, updateEdgeFade],
  )
  // "showing N of M" (UI-OVERHAUL.md's column-collapse affordance): each column owns its own
  // collapsed flag in `localStorage` (a per-viewer convenience, not shared state), so the board only
  // *observes* the aggregate via a callback rather than lifting that state out of BoardColumn.
  const [collapsedByColumn, setCollapsedByColumn] = React.useState<Record<string, boolean>>({})
  const [expandAllNonce, setExpandAllNonce] = React.useState(0)
  const handleCollapsedChange = React.useCallback((columnKey: string, collapsed: boolean) => {
    setCollapsedByColumn((prev) =>
      prev[columnKey] === collapsed ? prev : { ...prev, [columnKey]: collapsed },
    )
  }, [])
  const boardQuery = useBoardQuery()
  const projectsQuery = useProjectsQuery()
  const moveCard = useMoveCardMutation()
  const announce = useAnnounce()
  const search = useSearchParams()
  const q = search.get('q') ?? ''

  const board = boardQuery.data
  const projects = React.useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])

  React.useEffect(() => {
    updateEdgeFade(undefined)
  }, [board?.columns.length, updateEdgeFade])

  const filterQuery = React.useMemo(() => (q.trim() ? parseFilterQuery(q) : null), [q])

  const filterCard = React.useCallback(
    (card: Card): boolean => {
      if (!filterQuery || !board) return true
      const labelNames = new Map(board.labels.map((l) => [l.id, l.name]))
      const projectNames = new Map(projects.map((p) => [p.id, p.title]))
      return cardMatchesFilterText(
        {
          ...card,
          description: card.description?.text ?? null,
          labelNames: card.labels.map((id) => labelNames.get(id) ?? ''),
          projectName: card.projectId ? (projectNames.get(card.projectId) ?? null) : null,
        },
        q,
        {
          meUserId: user?.id ?? null,
          resolveUserIds: (tok) => findMemberMatches(tok, board.members),
        },
      )
    },
    [filterQuery, board, q, user, projects],
  )

  const handleDropped = React.useCallback(
    (draggedCardId: string, spec: CardDropSpec) => {
      if (!board) return
      const destCards = (
        spec.toUserId === null
          ? board.unassigned
          : (board.columns.find((c) => c.member.userId === spec.toUserId)?.cards ?? [])
      ).filter((c) => c.id !== draggedCardId)

      let orderKey: string
      if (spec.kind === 'appendToColumn') {
        orderKey = keyBetween(destCards.at(-1)?.orderKey ?? null, null)
      } else {
        const idx = destCards.findIndex((c) => c.id === spec.targetCardId)
        if (idx === -1) {
          orderKey = keyBetween(destCards.at(-1)?.orderKey ?? null, null)
        } else if (spec.edge === 'top') {
          orderKey = keyBetween(
            idx > 0 ? (destCards[idx - 1]?.orderKey ?? null) : null,
            destCards[idx]!.orderKey,
          )
        } else {
          orderKey = keyBetween(
            destCards[idx]!.orderKey,
            idx + 1 < destCards.length ? (destCards[idx + 1]?.orderKey ?? null) : null,
          )
        }
      }

      const targetMember = spec.toUserId
        ? board.members.find((m) => m.userId === spec.toUserId)
        : null
      const draggedCard = [...board.unassigned, ...board.columns.flatMap((c) => c.cards)].find(
        (c) => c.id === draggedCardId,
      )
      moveCard.mutate({ id: draggedCardId, toUserId: spec.toUserId, orderKey })
      announce(
        t('work.board.moved', {
          title: draggedCard?.title ?? '',
          target: targetMember ? fullName(targetMember) : t('work.board.unassigned'),
        }),
      )
    },
    [board, moveCard, announce, t],
  )

  const handleMoveTo = React.useCallback(
    (cardId: string, toUserId: string | null) => {
      handleDropped(cardId, { kind: 'appendToColumn', toUserId })
    },
    [handleDropped],
  )

  if (boardQuery.isPending) {
    return (
      <div className="flex gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-96 w-72 shrink-0" />
        ))}
      </div>
    )
  }
  if (boardQuery.isError || !board) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void boardQuery.refetch() }}
      />
    )
  }
  if (board.members.length === 0) {
    return (
      <StateView kind="empty" titleKey="work.board.emptyTitle" bodyKey="work.board.emptyBody" />
    )
  }

  const columnKeys = [...board.columns.map((c) => c.member.userId), 'unassigned']
  const collapsedCount = columnKeys.filter((k) => collapsedByColumn[k]).length
  const ownColumnIndex = board.columns.findIndex((c) => c.member.userId === user?.id)
  // An active search/filter always searches every column -- narrowing to "just me" while a filter is
  // typed would silently hide a matching card in a colleague's column with nothing to explain why.
  const isFiltering = q.trim().length > 0
  const visibleColumns =
    scope === 'all' || ownColumnIndex === -1 || isFiltering
      ? board.columns
      : [board.columns[ownColumnIndex]!]

  // SPEC §3.3: a head's columns lead with trouble -- most overdue first, then heaviest open load,
  // then name so the order is stable between polls. Everyone else keeps the roster order (head
  // first, then alphabetical), which is how people look each other up.
  const orderedColumns =
    isHead && scope === 'all'
      ? [...visibleColumns].sort((a, b) => {
          const overdue = (col: typeof a) => col.cards.filter((c) => c.risk === 'overdue').length
          const open = (col: typeof a) => col.cards.filter((c) => c.status === 'active').length
          return (
            overdue(b) - overdue(a) ||
            open(b) - open(a) ||
            fullName(a.member).localeCompare(fullName(b.member))
          )
        })
      : visibleColumns

  // SPEC §3.3: grouped by boʻlim, "Boʻlimsiz" last. A department with no units at all collapses to
  // one unnamed group, which renders exactly like the flat board did -- no empty heading.
  type Group = { unitId: string | null; unitName: string | null; columns: typeof orderedColumns }
  const groups: Group[] = []
  for (const col of orderedColumns) {
    const unitId = col.member.unitId ?? null
    const existing = groups.find((g) => g.unitId === unitId)
    if (existing) existing.columns.push(col)
    else groups.push({ unitId, unitName: col.member.unitName ?? null, columns: [col] })
  }
  groups.sort((a, b) => {
    if (a.unitId === null) return 1
    if (b.unitId === null) return -1
    return (a.unitName ?? '').localeCompare(b.unitName ?? '')
  })
  const hasNamedGroups = groups.some((g) => g.unitId !== null)

  function setAllCollapsed(collapsed: boolean): void {
    for (const key of columnKeys) {
      try {
        if (collapsed) window.localStorage.setItem(`devon.work.columnCollapsed.${key}`, '1')
        else window.localStorage.removeItem(`devon.work.columnCollapsed.${key}`)
      } catch {
        // Best-effort -- the remount below still applies it for this render.
      }
    }
    setCollapsedByColumn(
      collapsed ? Object.fromEntries(columnKeys.map((k) => [k, true])) : {},
    )
    setExpandAllNonce((n) => n + 1)
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span
            className={cn('size-2.5 shrink-0 rounded-full', unitHueClass(departmentId ?? 'devon'))}
            aria-hidden="true"
          />
          <h2 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {department?.name ?? t('work.board.department')}
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* SPEC 3.3: a visible segmented control, not a secondary pill -- "Hammasi" is the
                default and both options are readable before either is chosen. Hidden entirely for a
                viewer with no column of their own, for whom "Mening" would be an empty board. */}
            {ownColumnIndex !== -1 ? (
              <SegmentedControl
                size="sm"
                label={t('work.board.scopeLabel')}
                value={isFiltering ? 'all' : scope}
                onValueChange={setScope}
                options={[
                  { value: 'all', label: t('work.board.scopeAll'), count: board.members.length },
                  { value: 'mine', label: t('work.board.scopeMine') },
                ]}
              />
            ) : null}
            <IconButton
              title={t(
                density === 'compact' ? 'work.board.densityRoomy' : 'work.board.densityCompact',
              )}
              aria-label={t(
                density === 'compact' ? 'work.board.densityRoomy' : 'work.board.densityCompact',
              )}
              onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            >
              {density === 'compact' ? (
                <Rows3 className="size-4" aria-hidden="true" />
              ) : (
                <Rows4 className="size-4" aria-hidden="true" />
              )}
            </IconButton>
            <IconButton
              title={t(
                collapsedCount === columnKeys.length
                  ? 'work.board.expandAllColumns'
                  : 'work.board.collapseAllColumns',
              )}
              aria-label={t(
                collapsedCount === columnKeys.length
                  ? 'work.board.expandAllColumns'
                  : 'work.board.collapseAllColumns',
              )}
              onClick={() => setAllCollapsed(collapsedCount !== columnKeys.length)}
            >
              <ChevronsLeftRight className="size-4" aria-hidden="true" />
            </IconButton>
            {collapsedCount > 0 ? (
              <span className="text-caption text-muted-foreground">
                {t('work.board.columnsShowing', {
                  shown: columnKeys.length - collapsedCount,
                  total: columnKeys.length,
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div
          ref={setScrollerRefs}
          onScroll={updateEdgeFade}
          // `flex-none` here, not `flex-1`: a flex item's `flex-basis` (0% from `flex-1`) wins over
          // an inline `height` for sizing along the flex container's main axis, so as long as this
          // row was `flex-1` the explicit pixel height below was silently ignored and the row grew
          // to its content size regardless -- found live, in the browser, the whole reason this file
          // has a viewport-bounded-height hook instead of a CSS-only fix. `min-h-80` is only the
          // instant-before-first-measurement fallback (`useViewportBoundedHeight`'s own floor).
          className="flex flex-none gap-4 overflow-x-auto overflow-y-hidden pb-2 min-h-80"
          style={{
            ...(scrollerHeight !== undefined ? { height: scrollerHeight } : undefined),
            // A five-person department already overflows the board horizontally with no scrollbar
            // affordance visible until you try -- a right-edge fade signals "more columns" the same
            // way the filter bar and command palette already fade their own overflow, and disappears
            // once you've scrolled to the last column so it never looks like clipped content.
            maskImage: showRightFade
              ? 'linear-gradient(to right, black calc(100% - 40px), transparent)'
              : undefined,
            WebkitMaskImage: showRightFade
              ? 'linear-gradient(to right, black calc(100% - 40px), transparent)'
              : undefined,
          }}
        >
          {groups.map((group) => (
            <div
              key={group.unitId ?? 'no-unit'}
              className="flex h-full min-w-0 shrink-0 flex-col gap-1.5"
            >
              {/* One heading per unit, printed once above its columns instead of a colour the
                  reader has to decode. A department with no units at all shows no heading. */}
              {hasNamedGroups ? (
                <div className="flex items-center gap-1.5 px-1">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      unitHueClass(group.unitId ?? 'unassigned'),
                    )}
                    aria-hidden="true"
                  />
                  <h3 className="truncate text-caption font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                    {group.unitName ?? t('work.board.noUnit')}
                  </h3>
                </div>
              ) : null}
              <div className="flex min-h-0 flex-1 gap-4">
                {group.columns.map((col) => (
                  <BoardColumn
                    key={`${col.member.userId}:${expandAllNonce}`}
                    member={col.member}
                    cards={col.cards.filter(filterCard)}
                    projects={projects.filter((p) => p.members.includes(col.member.userId))}
                    allProjects={projects}
                    members={board.members}
                    labels={board.labels}
                    filterKey={q}
                    density={density}
                    onOpenCard={openCardPeek}
                    onDropped={handleDropped}
                    onMoveTo={handleMoveTo}
                    onCollapsedChange={handleCollapsedChange}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="flex h-full min-w-0 shrink-0 flex-col gap-1.5">
            {hasNamedGroups ? <div className="h-4.5" aria-hidden="true" /> : null}
            <div className="flex min-h-0 flex-1">
              <BoardColumn
                key={`unassigned:${expandAllNonce}`}
                member={null}
                cards={board.unassigned.filter(filterCard)}
                projects={[]}
                allProjects={projects}
                members={board.members}
                labels={board.labels}
                filterKey={q}
                density={density}
                onOpenCard={openCardPeek}
                onDropped={handleDropped}
                onMoveTo={handleMoveTo}
                onCollapsedChange={handleCollapsedChange}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function BoardScreen() {
  return (
    <DndAnnouncerProvider>
      <WorkShell filterLayout="people_board">
        <BoardScreenInner />
      </WorkShell>
      <CardPeekDialog />
      <TouchDragPreviewLayer />
    </DndAnnouncerProvider>
  )
}
