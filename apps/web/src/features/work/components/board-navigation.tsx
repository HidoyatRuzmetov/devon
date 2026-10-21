import * as React from 'react'
import { useT } from '@devon/i18n'
import { Combobox, IconButton } from '@devon/ui'
import { ChevronLeft, ChevronRight, UserRound } from 'lucide-react'
import type { MemberSummary } from '../api.js'
import { fullName } from '../lib/format.js'

export function BoardNavigation({
  scroller,
  members,
  currentUserId,
  canScrollLeft,
  canScrollRight,
  layoutKey,
  showEveryone,
  mobile = false,
  activePersonId,
  onNavigate,
}: {
  scroller: React.RefObject<HTMLDivElement | null>
  members: readonly MemberSummary[]
  currentUserId: string | undefined
  canScrollLeft: boolean
  canScrollRight: boolean
  layoutKey: string
  showEveryone: () => void
  mobile?: boolean
  activePersonId?: string | undefined
  onNavigate?: (id: string) => void
}) {
  const t = useT()
  const [pendingTarget, setPendingTarget] = React.useState<{ id: string } | null>(null)

  React.useEffect(() => {
    if (!pendingTarget) return
    // Selecting a colleague while Mine is active first renders Everyone. Wait for that DOM rather
    // than scrolling a stale column list or changing which cards match the user's filters.
    const frame = requestAnimationFrame(() => {
      const board = scroller.current
      const target = board
        ? [...board.querySelectorAll<HTMLElement>('[data-board-column]')].find(
            (column) => column.dataset['boardColumn'] === pendingTarget.id,
          )
        : undefined
      if (!board || !target) return
      // The picker follows the requested page immediately. Intermediate smooth-scroll positions
      // are reconciled by the board on scroll end, including a reversed/interrupted transition.
      if (mobile) onNavigate?.(pendingTarget.id)
      board.scrollTo({
        left:
          board.scrollLeft +
          target.getBoundingClientRect().left -
          board.getBoundingClientRect().left -
          (mobile ? 0 : 16),
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
      setPendingTarget(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingTarget, layoutKey, scroller, mobile, onNavigate])

  function jumpTo(id: string) {
    showEveryone()
    setPendingTarget({ id })
  }

  function move(direction: -1 | 1) {
    const board = scroller.current
    if (!board) return
    if (mobile) {
      const columns = [...board.querySelectorAll<HTMLElement>('[data-board-column]')]
      const index = columns.findIndex((column) => column.dataset['boardColumn'] === activePersonId)
      const target = columns[Math.max(0, Math.min(columns.length - 1, index + direction))]
      if (target?.dataset['boardColumn']) jumpTo(target.dataset['boardColumn'])
      return
    }
    board.scrollBy({
      left: direction * Math.max(240, board.clientWidth * 0.8),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    })
  }

  return (
    <div
      role="group"
      aria-label={t('work.board.navigationLabel')}
      className={
        mobile
          ? 'flex w-full min-w-0 items-center gap-1'
          : 'flex min-w-0 flex-1 items-center gap-1 xl:flex-none'
      }
    >
      {mobile ? (
        <IconButton
          aria-label={t('work.board.previousColumns')}
          disabled={!canScrollLeft}
          onClick={() => move(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Combobox
          className="h-11 min-w-0 flex-1 text-small md:h-9 xl:w-40"
          value={mobile ? (activePersonId ?? null) : null}
          onValueChange={jumpTo}
          label={t(mobile ? 'boardRefinement.mobile.person' : 'work.board.jumpToPerson')}
          placeholder={t('work.board.jumpToPerson')}
          searchPlaceholder={t('work.board.searchPeople')}
          emptyMessage={t('work.board.noPeople')}
          contentClassName="min-w-64 max-w-[calc(100vw-2rem)] max-h-(--radix-popover-content-available-height) overflow-y-auto"
          options={[
            ...members.map((member) => ({
              value: member.userId,
              label: fullName(member),
              description:
                member.role === 'head'
                  ? t('headScope.leadership')
                  : (member.unitName ?? t('work.board.noUnit')),
            })),
            { value: 'unassigned', label: t('work.board.unassigned') },
          ]}
        />
        {!mobile && currentUserId && members.some((member) => member.userId === currentUserId) ? (
          <IconButton
            className="hidden md:inline-flex md:size-8"
            aria-label={t('work.board.myColumn')}
            tooltip={t('work.board.myColumn')}
            onClick={() => jumpTo(currentUserId)}
          >
            <UserRound className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      {mobile ? (
        <>
          <span
            className="min-w-8 shrink-0 text-center text-caption tabular-nums text-muted-foreground"
            aria-label={t('boardRefinement.mobile.position', {
              current:
                activePersonId === 'unassigned'
                  ? members.length + 1
                  : Math.max(
                      1,
                      members.findIndex((member) => member.userId === activePersonId) + 1,
                    ),
              total: members.length + 1,
            })}
          >
            {activePersonId === 'unassigned'
              ? members.length + 1
              : Math.max(1, members.findIndex((member) => member.userId === activePersonId) + 1)}
            /{members.length + 1}
          </span>
          <IconButton
            aria-label={t('work.board.nextColumns')}
            disabled={!canScrollRight}
            onClick={() => move(1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </IconButton>
        </>
      ) : null}
      <div className={mobile ? 'hidden' : 'ml-auto hidden items-center md:flex'}>
        <IconButton
          className="md:size-7"
          aria-label={t('work.board.previousColumns')}
          title={t('work.board.previousColumns')}
          disabled={!canScrollLeft}
          onClick={() => move(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          className="md:size-7"
          aria-label={t('work.board.nextColumns')}
          title={t('work.board.nextColumns')}
          disabled={!canScrollRight}
          onClick={() => move(1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}
