// The People board (TECH-SPEC §5, EPIC-004's centrepiece): one column per member, grouped under a
// colour-coded bo'lim section, unassigned last. EPIC-003 (sub-department "bo'lim" units) has not
// shipped yet (`docs/03-plan/backlog.json`: EPIC-003 is still `ready`, and `apps/api/src/modules/
// work/index.ts`'s own `toFilterable` comment: "unitName: null // EPIC-003 ... has not shipped yet")
// -- so there is exactly one section today, the signed-in department itself, coloured via
// `unitHueClass(departmentId)` (the same stable-hash-to-hue helper a real bo'lim section will use once
// EPIC-003 lands; only the grouping key changes, not the rendering). Virtualisation is intentionally
// not wired in here: at this build's demo scale (~250 cards over 16 columns, TECH-SPEC §14) a plain
// `overflow-x-auto` row of `overflow-y-auto` columns scrolls smoothly with no windowing library; revisit
// if a real department's card count grows an order of magnitude past the demo.
import * as React from 'react'
import { cardMatchesFilterText, parseFilterQuery } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { FilterChip, Skeleton, StateView, cn, unitHueClass } from '@devon/ui'
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

/** Per-viewer, remembered choice (round2 SEV2 "remember the choice per user") -- keyed by user id so
 * a shared machine never leaks one person's board width preference onto the next signed-in user. */
function useShowAllMembers(userId: string | undefined): [boolean, (v: boolean) => void] {
  const key = `devon.work.board.showAllMembers.${userId ?? 'anon'}`
  const [value, setValue] = React.useState(() => {
    try {
      return window.localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const setAndStore = React.useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        if (next) window.localStorage.setItem(key, '1')
        else window.localStorage.removeItem(key)
      } catch {
        // Best-effort only -- the toggle still works for this render.
      }
    },
    [key],
  )
  return [value, setAndStore]
}

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
  const t = useT()
  const { department, departmentId } = useDepartment()
  const { user } = useSession()
  const [showAllMembers, setShowAllMembers] = useShowAllMembers(user?.id)
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
  // round2 SEV2: a 26-person department opened the board at 27 columns with no way to narrow it (3.8
  // of 27 fit an 1112px scroller) -- defaulting to just the viewer's own column, with a chip to bring
  // the rest back, means the board opens at a width someone can actually scan. No manager/report
  // relationship exists in this data model (CLAUDE.md: "no HR"), so "the viewer's own column" is the
  // whole default set; a viewer with no column of their own (e.g. a head who never holds cards) still
  // sees everyone, since narrowing to nothing would be worse than not narrowing at all.
  const ownColumnIndex = board.columns.findIndex((c) => c.member.userId === user?.id)
  // An active search/filter always searches every column -- narrowing to "just me" while a filter is
  // typed would silently hide a matching card in a colleague's column with nothing to explain why.
  const isFiltering = q.trim().length > 0
  const visibleColumns =
    showAllMembers || ownColumnIndex === -1 || isFiltering
      ? board.columns
      : [board.columns[ownColumnIndex]!]

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
            {ownColumnIndex !== -1 ? (
              <FilterChip
                active={showAllMembers}
                onClick={() => setShowAllMembers(!showAllMembers)}
              >
                {showAllMembers
                  ? t('work.board.showFewer')
                  : t('work.board.showAllMembers', { count: board.members.length })}
              </FilterChip>
            ) : null}
            {collapsedCount > 0 ? (
              <span className="flex items-center gap-2 text-caption text-muted-foreground">
                {t('work.board.columnsShowing', {
                  shown: columnKeys.length - collapsedCount,
                  total: columnKeys.length,
                })}
                <button
                  type="button"
                  className="rounded-sm px-1.5 py-0.5 font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => {
                    for (const key of columnKeys) {
                      try {
                        window.localStorage.removeItem(`devon.work.columnCollapsed.${key}`)
                      } catch {
                        // Best-effort -- the remount below still expands the columns for this render.
                      }
                    }
                    setCollapsedByColumn({})
                    setExpandAllNonce((n) => n + 1)
                  }}
                >
                  {t('work.board.expandAllColumns')}
                </button>
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
          {visibleColumns.map((col) => (
            <BoardColumn
              key={`${col.member.userId}:${expandAllNonce}`}
              member={col.member}
              cards={col.cards.filter(filterCard)}
              projects={projects.filter((p) => p.members.includes(col.member.userId))}
              allProjects={projects}
              members={board.members}
              labels={board.labels}
              filterKey={q}
              onOpenCard={openCardPeek}
              onDropped={handleDropped}
              onMoveTo={handleMoveTo}
              onCollapsedChange={handleCollapsedChange}
            />
          ))}
          <BoardColumn
            key={`unassigned:${expandAllNonce}`}
            member={null}
            cards={board.unassigned.filter(filterCard)}
            projects={[]}
            allProjects={projects}
            members={board.members}
            labels={board.labels}
            filterKey={q}
            onOpenCard={openCardPeek}
            onDropped={handleDropped}
            onMoveTo={handleMoveTo}
            onCollapsedChange={handleCollapsedChange}
          />
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
