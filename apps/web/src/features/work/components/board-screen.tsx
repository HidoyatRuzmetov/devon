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
import { useQuery } from '@tanstack/react-query'
import { cardMatchesFilterText, parseFilterQuery } from '@devon/contracts'
import { useT, useLocale } from '@devon/i18n'
import {
  IconButton,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Skeleton,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import {
  ArrowDownWideNarrow,
  ChevronsLeftRight,
  ChevronsRightLeft,
  FolderKanban,
  Info,
  Rows3,
  Rows4,
} from 'lucide-react'
import { useDepartment, useSession } from '../../../lib/session.js'
import { useSearchParams } from '../../../lib/router.js'
import { useMediaQuery } from '../../../lib/use-media-query.js'
import { createUnitPalette, unitColorClass } from '../../../lib/unit-palette.js'
import { fetchUnitsOverview } from '../../structure/api.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import type { Card } from '../api.js'
import { useAnnounce, DndAnnouncerProvider } from './dnd-announcer.js'
import { useBoardQuery, useMoveCardMutation } from '../hooks.js'
import { useAiSettingsQuery, useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { AiResultPanel } from '../../ai/components/ai-result-panel.js'
import { BoardRiskDigestPreview } from '../../ai/components/previews.js'
import { parseFeatureOutput, type BoardRiskDigestOutput } from '../../ai/outputs.js'
import type { RunMeta } from '../../ai/types.js'
import { SparkleButton } from '@devon/ui'
import { BoardColumn } from './board-column.js'
import { BoardNavigation } from './board-navigation.js'
import './board-scroller.css'
import { MultitaskToolbar, MultitaskToolbarSlot, useCardSelection } from './multitask-toolbar.js'
import { CardPeekDialog, openCardPeek } from './card-peek-dialog.js'
import { NewCardDialog } from './new-card-dialog.js'
import { TouchDragPreviewLayer } from './touch-drag-preview.js'
import { WorkShell } from './work-shell.js'
import { useScopeTransition } from '../lib/use-scope-transition.js'
import type { CardDropSpec } from './card-tile.js'
import { fullName } from '../lib/format.js'
import { orderBoardCards, type BoardCardOrder } from '../lib/board-state.js'

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
const isCardOrder = (v: string): v is BoardCardOrder => v === 'manual' || v === 'attention'

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
  const { user } = useSession()
  const { departmentId } = useDepartment()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [activePersonId, setActivePersonId] = React.useState<string | undefined>(undefined)
  const unitsQuery = useQuery({
    queryKey: ['structure', 'units', departmentId],
    queryFn: () => fetchUnitsOverview(departmentId!),
    enabled: departmentId !== null,
  })
  const unitPalette = React.useMemo(
    () => createUnitPalette(unitsQuery.data?.units ?? []),
    [unitsQuery.data],
  )
  const [cardOrder, setCardOrder] = useStoredPreference<BoardCardOrder>(
    'cardOrder',
    user?.id,
    'manual',
    isCardOrder,
  )
  const [scope, setScope] = useStoredPreference<BoardScope>('scope', user?.id, 'all', isBoardScope)
  const [density, setDensity] = useStoredPreference<BoardDensity>(
    'density',
    user?.id,
    'compact',
    isBoardDensity,
  )
  const scrollerElRef = React.useRef<HTMLDivElement | null>(null)
  const changeScope = useScopeTransition(scope, setScope, scrollerElRef)
  const mobileNavigationTargetRef = React.useRef<string | null>(null)
  const edgeObserverRef = React.useRef<ResizeObserver | null>(null)
  const [edges, setEdges] = React.useState({ left: false, right: false })
  const handleMobileNavigate = React.useCallback((id: string) => {
    mobileNavigationTargetRef.current = id
    setActivePersonId(id)
    const columns = [
      ...(scrollerElRef.current?.querySelectorAll<HTMLElement>('[data-board-column]') ?? []),
    ]
    const index = columns.findIndex((column) => column.dataset['boardColumn'] === id)
    if (index >= 0) setEdges({ left: index > 0, right: index < columns.length - 1 })
  }, [])
  const updateEdgeFade = React.useCallback(
    (e: React.UIEvent<HTMLDivElement> | undefined) => {
      const el = e ? e.currentTarget : scrollerElRef.current
      if (!el) return
      const width = `${el.clientWidth}px`
      if (el.style.getPropertyValue('--work-mobile-column-width') !== width)
        el.style.setProperty('--work-mobile-column-width', width)
      if (isMobile) {
        const edge = el.getBoundingClientRect().left
        const columns = [...el.querySelectorAll<HTMLElement>('[data-board-column]')]
        const closest = columns.reduce<HTMLElement | undefined>(
          (best, column) =>
            !best ||
            Math.abs(column.getBoundingClientRect().left - edge) <
              Math.abs(best.getBoundingClientRect().left - edge)
              ? column
              : best,
          undefined,
        )
        const target = mobileNavigationTargetRef.current
        if (target) {
          const hasArrived =
            closest?.dataset['boardColumn'] === target &&
            Math.abs(closest.getBoundingClientRect().left - edge) < 2
          if (!hasArrived) return
          mobileNavigationTargetRef.current = null
        }
        if (closest?.dataset['boardColumn']) setActivePersonId(closest.dataset['boardColumn'])
      }
      const left = el.scrollLeft > 1
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((previous) =>
        previous.left === left && previous.right === right ? previous : { left, right },
      )
    },
    [isMobile],
  )
  const reconcileMobilePage = React.useCallback(() => {
    mobileNavigationTargetRef.current = null
    updateEdgeFade(undefined)
  }, [updateEdgeFade])
  const setScrollerRefs = React.useCallback(
    (el: HTMLDivElement | null) => {
      edgeObserverRef.current?.disconnect()
      edgeObserverRef.current = null
      scrollerElRef.current = el
      // Re-check once the columns have actually rendered/resized (member count, filter results),
      // not just on scroll -- a department that grows past the visible width should show the fade
      // immediately, before anyone has touched the scrollbar.
      if (el) {
        const observer = new ResizeObserver(() => updateEdgeFade(undefined))
        observer.observe(el)
        if (el.firstElementChild) observer.observe(el.firstElementChild)
        edgeObserverRef.current = observer
        requestAnimationFrame(() => updateEdgeFade(undefined))
      }
    },
    [updateEdgeFade],
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
  // The one card whose move the server refused, cleared by the tile once its shake has played.
  const [rejectedCardId, setRejectedCardId] = React.useState<string | null>(null)
  const clearRejection = React.useCallback(() => setRejectedCardId(null), [])
  const announce = useAnnounce()
  const search = useSearchParams()
  const q = search.get('q') ?? ''

  const board = boardQuery.data
  const riskDigest = useBoardRiskDigest(board)
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
          // SEV2 #3: `estimate:boʻsh` needs the value, and `exactOptionalPropertyTypes` means an
          // absent estimate has to arrive as `null` rather than `undefined`.
          estimateMin: card.estimateMin ?? null,
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
      // A drop explicitly chooses a shared position. Return to that ordering instead of letting an
      // automatic visual sort immediately hide the user's placement.
      if (cardOrder !== 'manual') {
        setCardOrder('manual')
        toast.info(t('boardRefinement.sort.manualAfterMove'))
      }
      const targetMember = spec.toUserId
        ? board.members.find((m) => m.userId === spec.toUserId)
        : null
      const draggedCard = [...board.unassigned, ...board.columns.flatMap((c) => c.cards)].find(
        (c) => c.id === draggedCardId,
      )
      moveCard.mutate(
        {
          id: draggedCardId,
          toUserId: spec.toUserId,
          targetCardId: spec.kind === 'onCard' ? spec.targetCardId : null,
          edge: spec.kind === 'onCard' && spec.edge === 'top' ? 'before' : 'after',
        },
        {
          // The mutation already rolls the optimistic move back on failure. Rolling back silently is
          // the problem: the card slides to its new column, then simply is not there any more, which
          // reads as a drag that missed rather than as a refusal. One shake on the tile that came
          // back, plus the error toast, and the two together say what happened.
          // ...and the same for a person who cannot see the shake: the optimistic
          // `announce(work.board.moved)` below has already been spoken by the time the server
          // refuses, so it has to be retracted here or the screen reader is the only surface in the
          // product still reporting success (motion verdict F8).
          onError: () => {
            setRejectedCardId(draggedCardId)
            toast.error(t('work.board.moveFailed'))
            announce(t('work.board.moveFailed'))
          },
        },
      )
      announce(
        t('work.board.moved', {
          title: draggedCard?.title ?? '',
          target: targetMember ? fullName(targetMember) : t('work.board.unassigned'),
        }),
      )
    },
    [board, moveCard, announce, t, cardOrder, setCardOrder],
  )

  const handleMoveTo = React.useCallback(
    (cardId: string, toUserId: string | null) => {
      handleDropped(cardId, { kind: 'appendToColumn', toUserId })
    },
    [handleDropped],
  )

  const sourceColumns = React.useMemo(() => board?.columns ?? [], [board?.columns])
  const ownColumnIndex = sourceColumns.findIndex((c) => c.member.userId === user?.id)
  // An active search/filter always searches every column -- narrowing to "just me" while a filter is
  // typed would silently hide a matching card in a colleague's column with nothing to explain why.
  const isFiltering = q.trim().length > 0
  const visibleColumns = React.useMemo(
    () =>
      isMobile || scope === 'all' || ownColumnIndex === -1 || isFiltering
        ? sourceColumns
        : [sourceColumns[ownColumnIndex]!],
    [isMobile, scope, ownColumnIndex, isFiltering, sourceColumns],
  )

  // The roster is stable while people move/finish work. Sorting columns by live load made a drop
  // move several other people's columns under the pointer; risk counts still show who needs help.
  const orderedColumns = visibleColumns

  // SPEC §3.3: grouped by boʻlim, "Boʻlimsiz" last. A department with no units at all collapses to
  // one unnamed group, which renders exactly like the flat board did -- no empty heading.
  type Group = {
    scope: 'department' | 'unit' | 'unassigned'
    unitId: string | null
    unitName: string | null
    columns: typeof orderedColumns
  }
  const groups = React.useMemo(() => {
    const groups: Group[] = []
    for (const col of orderedColumns) {
      const scope =
        col.member.role === 'head' ? 'department' : col.member.unitId ? 'unit' : 'unassigned'
      const unitId = scope === 'unit' ? (col.member.unitId ?? null) : null
      const existing = groups.find((g) => g.scope === scope && g.unitId === unitId)
      if (existing) existing.columns.push(col)
      else
        groups.push({
          scope,
          unitId,
          unitName: col.member.unitName ?? null,
          columns: [col],
        })
    }
    return groups.sort((a, b) => {
      if (a.scope === 'department') return -1
      if (b.scope === 'department') return 1
      if (a.unitId === null) return 1
      if (b.unitId === null) return -1
      return (a.unitName ?? '').localeCompare(b.unitName ?? '')
    })
  }, [orderedColumns])

  // v1.1 SPEC §7 (A8) -- the board's own multitask selection. The ordered id list is column by
  // column, top to bottom, which is exactly the order the columns are rendered in, so a shift-click
  // range covers what the eye expects rather than whatever order the API happened to return.
  //
  // Declared above the loading/error/empty returns below, because a hook may not be called
  // conditionally: while the board is still loading the list is simply empty, which is correct.
  const visibleCardIds = React.useMemo(
    () => [
      ...groups
        .flatMap((group) => group.columns)
        .filter((col) => isMobile || !collapsedByColumn[col.member.userId])
        .flatMap((col) =>
          orderBoardCards(col.cards.filter(filterCard), cardOrder).map((c) => c.id),
        ),
      ...(!isMobile && collapsedByColumn['unassigned']
        ? []
        : orderBoardCards((board?.unassigned ?? []).filter(filterCard), cardOrder).map(
            (c) => c.id,
          )),
    ],
    [groups, collapsedByColumn, filterCard, cardOrder, board?.unassigned, isMobile],
  )
  const {
    selected: selectedCardIds,
    toggle: toggleCardSelected,
    selectRange: selectCardRange,
    clear: clearSelection,
  } = useCardSelection(visibleCardIds)
  const lastSelectedRef = React.useRef<string | null>(null)

  const handleCardSelectedChange = React.useCallback(
    (cardId: string, selected: boolean, shiftKey: boolean) => {
      if (shiftKey && lastSelectedRef.current) {
        selectCardRange(lastSelectedRef.current, cardId, visibleCardIds)
        return
      }
      lastSelectedRef.current = cardId
      toggleCardSelected(cardId, selected)
    },
    [selectCardRange, toggleCardSelected, visibleCardIds],
  )

  if (boardQuery.isPending) {
    return (
      <WorkShell filterLayout="people_board" hideMeControl>
        <div className="flex gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      </WorkShell>
    )
  }
  if (boardQuery.isError || !board) {
    return (
      <WorkShell filterLayout="people_board" hideMeControl>
        <StateView
          kind="error"
          titleKey="state.error.title"
          bodyKey="state.error.body"
          action={{
            labelKey: 'state.error.action',
            onAction: () => void boardQuery.refetch(),
          }}
        />
      </WorkShell>
    )
  }
  if (board.members.length === 0) {
    return (
      <WorkShell filterLayout="people_board" hideMeControl>
        <StateView kind="empty" titleKey="work.board.emptyTitle" bodyKey="work.board.emptyBody" />
      </WorkShell>
    )
  }

  const columnKeys = [...board.columns.map((c) => c.member.userId), 'unassigned']

  const collapsedCount = columnKeys.filter((k) => collapsedByColumn[k]).length

  function setAllCollapsed(collapsed: boolean): void {
    for (const key of columnKeys) {
      try {
        if (collapsed) window.localStorage.setItem(`devon.work.columnCollapsed.${key}`, '1')
        else window.localStorage.removeItem(`devon.work.columnCollapsed.${key}`)
      } catch {
        // Best-effort -- the remount below still applies it for this render.
      }
    }
    setCollapsedByColumn(collapsed ? Object.fromEntries(columnKeys.map((k) => [k, true])) : {})
    setExpandAllNonce((n) => n + 1)
  }

  const sortControl = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 shrink-0 gap-1 px-2 md:min-h-9"
          aria-label={t('boardRefinement.sort.label', {
            order: t(`boardRefinement.sort.${cardOrder}`),
          })}
          title={t('boardRefinement.sort.label', {
            order: t(`boardRefinement.sort.${cardOrder}`),
          })}
        >
          <ArrowDownWideNarrow className="size-4" aria-hidden="true" />
          <span className="inline">{t(`boardRefinement.sort.${cardOrder}`)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={cardOrder}
          onValueChange={(next) => {
            if (isCardOrder(next)) setCardOrder(next)
          }}
        >
          <DropdownMenuRadioItem value="manual">
            {t('boardRefinement.sort.manualOption')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="attention">
            {t('boardRefinement.sort.attentionOption')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p className="max-w-64 border-t border-border px-3 py-2 text-caption text-muted-foreground">
          {t(`boardRefinement.sort.${cardOrder}Help`)}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const guideControl = (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          className="shrink-0 md:size-8"
          aria-label={t('boardRefinement.guide.title')}
          tooltip={t('boardRefinement.guide.title')}
        >
          <Info className="size-4" aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-h-[min(36rem,var(--radix-popover-content-available-height))] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto"
      >
        <p className="text-small font-semibold">{t('boardRefinement.guide.title')}</p>
        <div className="space-y-2 text-small">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-9 shrink-0 items-center justify-center rounded-sm border border-primary/25 border-l-2 border-l-primary/65 bg-accent">
              <FolderKanban className="size-3.5 text-primary" aria-hidden="true" />
            </span>
            <span>{t('boardRefinement.projectTask')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="h-6 w-9 shrink-0 rounded-sm border border-border bg-card"
              aria-hidden="true"
            />
            <span>{t('boardRefinement.standaloneTask')}</span>
          </div>
          <p className="text-caption text-muted-foreground">
            {t('boardRefinement.guide.indicators')}
          </p>
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-caption font-medium">{t('boardRefinement.guide.units')}</p>
          <div className="grid gap-1.5">
            {(unitsQuery.data?.units ?? []).map((unit) => (
              <span key={unit.id} className="flex items-center gap-2 text-caption">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    unitColorClass(unitPalette, unit.id),
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">{unit.name}</span>
              </span>
            ))}
          </div>
        </div>
        <p className="border-t border-border pt-3 text-caption text-muted-foreground">
          {t(`boardRefinement.sort.${cardOrder}Help`)}
        </p>
      </PopoverContent>
    </Popover>
  )
  const toolbar = (
    <div
      className="hidden w-full min-w-0 items-center justify-end gap-1 pb-1 md:flex xl:w-auto xl:shrink-0 xl:pb-0"
      data-board-toolbar
    >
      <BoardNavigation
        scroller={scrollerElRef}
        members={board.members}
        currentUserId={user?.id}
        canScrollLeft={edges.left}
        canScrollRight={edges.right}
        layoutKey={`${scope}:${density}:${expandAllNonce}`}
        showEveryone={() => void changeScope('all')}
      />
      <div
        className="flex shrink-0 items-center gap-1 border-l border-border pl-1"
        data-board-layout-controls
      >
        <Button
          variant="ghost"
          size="sm"
          className="min-h-9 px-2"
          onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
        >
          {density === 'compact' ? (
            <Rows3 className="size-4" aria-hidden="true" />
          ) : (
            <Rows4 className="size-4" aria-hidden="true" />
          )}
          {t(density === 'compact' ? 'work.board.densityRoomy' : 'work.board.densityCompact')}
        </Button>
        <IconButton
          className="md:size-8"
          aria-label={t(
            collapsedCount === columnKeys.length
              ? 'work.board.expandAllColumns'
              : 'work.board.collapseAllColumns',
          )}
          tooltip={t(
            collapsedCount === columnKeys.length
              ? 'work.board.expandAllColumns'
              : 'work.board.collapseAllColumns',
          )}
          onClick={() => setAllCollapsed(collapsedCount !== columnKeys.length)}
        >
          {collapsedCount === columnKeys.length ? (
            <ChevronsLeftRight aria-hidden="true" />
          ) : (
            <ChevronsRightLeft aria-hidden="true" />
          )}
        </IconButton>
      </div>
      {ownColumnIndex !== -1 ? (
        <SegmentedControl
          size="sm"
          className="shrink-0 max-md:[&_button]:min-h-10"
          label={t('work.board.scopeLabel')}
          value={isFiltering ? 'all' : scope}
          onValueChange={(next) => void changeScope(next)}
          options={[
            { value: 'all', label: t('work.board.scopeAll'), count: board.members.length },
            { value: 'mine', label: t('work.board.scopeMine') },
          ]}
        />
      ) : null}
      {sortControl}
      {guideControl}
    </div>
  )

  return (
    <WorkShell
      filterLayout="people_board"
      hideMeControl
      fillViewport
      toolbar={toolbar}
      viewAction={riskDigest.trigger}
      mobileToolbar={
        <div className="flex items-center gap-1">
          {sortControl}
          {guideControl}
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {/* N-2 "Kim kechiktiryapti?" -- the head's daily version of the risk explainer, over the top
          at-risk cards on this board, in ONE batched call instead of one per card. Head only, on the
          server (`department_managed`) and here: it is a ranked list of who is late, which is
          management information about other people. */}
        {riskDigest.panel}
        <div className="shrink-0 md:hidden" data-board-mobile-navigation>
          <BoardNavigation
            mobile
            activePersonId={activePersonId}
            onNavigate={handleMobileNavigate}
            scroller={scrollerElRef}
            members={groups.flatMap((group) => group.columns.map((column) => column.member))}
            currentUserId={user?.id}
            canScrollLeft={edges.left}
            canScrollRight={edges.right}
            layoutKey={`mobile:${scope}:${expandAllNonce}`}
            showEveryone={() => void changeScope('all')}
          />
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* A8: the multitask toolbar takes over this row the moment anything is selected, sliding up
            on the same spring the table's does -- one bar, one behaviour, two screens. */}
          <div className="shrink-0">
            <MultitaskToolbarSlot show={selectedCardIds.size > 0}>
              <div className="pb-2">
                <MultitaskToolbar
                  ids={[...selectedCardIds]}
                  members={board.members}
                  labels={board.labels}
                  onClear={clearSelection}
                />
              </div>
            </MultitaskToolbarSlot>
          </div>
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              ref={setScrollerRefs}
              data-board-scope={isFiltering ? 'all' : scope}
              onScroll={updateEdgeFade}
              // eslint-disable-next-line react/no-unknown-property -- React 19.2 supports scrollend; the pinned React lint plugin predates that event.
              onScrollEnd={reconcileMobilePage}
              onPointerDownCapture={reconcileMobilePage}
              onWheelCapture={reconcileMobilePage}
              onKeyDownCapture={reconcileMobilePage}
              // The outer WorkShell owns the viewport bound. CSS shares the remaining height
              // with animated controls in the same layout pass, avoiding resize-observer lag.
              // Desktop shares one two-axis canvas; phones keep a vertical scroll per person.
              role="region"
              aria-label={t('work.board.regionLabel')}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This named overflow region needs focus for native arrow-key scrolling.
              tabIndex={0}
              className="devon-board-scroller h-full overflow-auto pb-2 min-h-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="devon-board-track flex min-h-full w-max min-w-full items-stretch gap-4">
                {groups.map((group) => (
                  <div
                    key={group.unitId ?? group.scope}
                    className="devon-board-group flex min-w-0 shrink-0 flex-col"
                  >
                    <div className="devon-board-group-columns flex min-h-0 flex-1 gap-2">
                      {group.columns.map((col) => (
                        <BoardColumn
                          key={`${col.member.userId}:${expandAllNonce}`}
                          member={col.member}
                          cards={orderBoardCards(col.cards.filter(filterCard), cardOrder)}
                          projects={projects.filter((p) => p.members.includes(col.member.userId))}
                          allProjects={projects}
                          members={board.members}
                          unitPalette={unitPalette}
                          labels={board.labels}
                          filterKey={q}
                          density={density}
                          mobile={isMobile}
                          onOpenCard={openCardPeek}
                          onDropped={handleDropped}
                          onMoveTo={handleMoveTo}
                          onCollapsedChange={handleCollapsedChange}
                          selectedIds={selectedCardIds}
                          onCardSelectedChange={handleCardSelectedChange}
                          selectionActive={selectedCardIds.size > 0}
                          rejectedCardId={rejectedCardId}
                          onRejectionShown={clearRejection}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="devon-board-group flex min-w-0 shrink-0 flex-col">
                  <div className="devon-board-group-columns flex min-h-0 flex-1">
                    <BoardColumn
                      key={`unassigned:${expandAllNonce}`}
                      member={null}
                      cards={orderBoardCards(board.unassigned.filter(filterCard), cardOrder)}
                      projects={[]}
                      allProjects={projects}
                      members={board.members}
                      unitPalette={unitPalette}
                      labels={board.labels}
                      filterKey={q}
                      density={density}
                      mobile={isMobile}
                      onOpenCard={openCardPeek}
                      onDropped={handleDropped}
                      onMoveTo={handleMoveTo}
                      onCollapsedChange={handleCollapsedChange}
                      selectedIds={selectedCardIds}
                      onCardSelectedChange={handleCardSelectedChange}
                      selectionActive={selectedCardIds.size > 0}
                      rejectedCardId={rejectedCardId}
                      onRejectionShown={clearRejection}
                    />
                  </div>
                </div>
              </div>
            </div>
            {edges.left ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 hidden md:block left-0 z-20 w-5 bg-linear-to-r from-background to-transparent"
              />
            ) : null}
            {edges.right ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 hidden md:block right-0 z-20 w-5 bg-linear-to-l from-background to-transparent"
              />
            ) : null}
          </div>
        </section>
      </div>
    </WorkShell>
  )
}

export default function BoardScreen() {
  return (
    <DndAnnouncerProvider>
      {/* SEV2 #18: the board owns the Me/All control, because its own one carries the count. */}
      <BoardScreenInner />
      <CardPeekDialog />
      {/* SPEC 12: the shell's "+ Yangi -> Yangi vazifa" routes to `/work?new=1`, which this opens. */}
      <NewCardDialog />
      <TouchDragPreviewLayer />
    </DndAnnouncerProvider>
  )
}

/**
 * The head's board digest (AI-AUDIT §4, N-2).
 *
 * One call, not N: v1.0's `deadline_risk` could only explain a single card, and explaining a board
 * meant twenty calls and twenty previews. This ranks the top few at-risk cards together, with one
 * reason each and one suggested action each, plus the "pressure points" -- the people whose load is
 * the structural cause -- because a head reading five late cards mostly wants to know whether it is
 * five problems or one person with too much work.
 *
 * Renders nothing at all for a member, or when nothing on the board is at risk. An empty AI panel
 * over a healthy board is noise.
 */
function useBoardRiskDigest(
  board:
    | {
        members: readonly { userId: string }[]
        columns: readonly {
          member: { userId: string; givenName: string; familyName: string }
          cards: readonly Card[]
        }[]
        unassigned: readonly Card[]
      }
    | undefined,
) {
  const t = useT()
  const locale = useLocale()
  const { department } = useDepartment()
  const isHead = department?.role === 'head'
  const aiSettings = useAiSettingsQuery()
  const digestAi = useRunAiFeatureMutation('board_risk_digest')
  const [digest, setDigest] = React.useState<{
    output: BoardRiskDigestOutput
    meta: RunMeta
  } | null>(null)

  const enabled =
    isHead &&
    aiSettings.data !== undefined &&
    aiSettings.data.flags['board_risk_digest'] === true &&
    aiSettings.data.budgetStatus !== 'hard_stop'

  const nameFor = React.useCallback(
    (userId: string | null): string | null => {
      if (!userId) return null
      const column = board?.columns.find((c) => c.member.userId === userId)
      return column ? fullName(column.member) : null
    },
    [board?.columns],
  )

  const allCards = React.useMemo(
    () => (board ? [...board.columns.flatMap((column) => column.cards), ...board.unassigned] : []),
    [board],
  )
  const atRisk = React.useMemo(
    () => allCards.filter((card) => card.risk !== 'none' && card.status === 'active'),
    [allCards],
  )

  function run() {
    if (!board || atRisk.length === 0) return
    setDigest(null)
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const now = Date.now()
    digestAi.mutate(
      {
        locale,
        departmentName: department?.name ?? t('work.board.department'),
        today,
        cards: atRisk.slice(0, 40).map((card) => ({
          id: card.id,
          title: card.title,
          riskLevel: card.risk,
          assigneeName: nameFor(card.assigneeUserId),
          dueDate: card.dueAt ? card.dueAt.slice(0, 10) : null,
          daysOverdue: card.dueAt
            ? Math.max(0, Math.round((now - new Date(card.dueAt).getTime()) / 86_400_000))
            : 0,
          daysSinceUpdate: Math.max(
            0,
            Math.round((now - new Date(card.updatedAt).getTime()) / 86_400_000),
          ),
          checklistDone: card.checklistDone,
          checklistTotal: card.checklistTotal,
          blocked: false,
        })),
        loadPerPerson: board.columns.map((column) => ({
          name: fullName(column.member),
          openCount: column.cards.filter((card) => card.status === 'active').length,
        })),
        topN: 5,
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<BoardRiskDigestOutput>('board_risk_digest', res.data)
          if (output) setDigest({ output, meta: res.meta })
        },
      },
    )
  }

  if (!enabled || atRisk.length === 0) return { trigger: null, panel: null }

  return {
    trigger: (
      <SparkleButton
        aria-label={t('work.ai.boardDigest')}
        label={`${t('work.ai.reviewRisk')} · ${atRisk.length}`}
        title={t('work.ai.boardDigest')}
        size="sm"
        className="shrink-0"
        loading={digestAi.isPending}
        onClick={run}
      />
    ),
    panel:
      digestAi.isPending || digest || digestAi.isError ? (
        <AiResultPanel
          title={t('work.ai.boardDigestPreviewTitle')}
          status={digestAi.isPending ? 'pending' : digestAi.isError ? 'error' : 'ready'}
          errorMessage={t('work.quickAdd.aiError')}
          {...(digest ? { meta: digest.meta } : {})}
          // Read-only: each row already carries its own action, and a single Accept over a ranked
          // list of five different problems would mean nothing.
          readOnly
          onDiscard={() => {
            setDigest(null)
            digestAi.reset()
          }}
          onRetry={run}
        >
          {digest ? (
            <BoardRiskDigestPreview
              output={digest.output}
              cardTitle={(id) => allCards.find((card) => card.id === id)?.title ?? null}
              onAction={(cardId) => openCardPeek(cardId)}
            />
          ) : null}
        </AiResultPanel>
      ) : null,
  }
}
