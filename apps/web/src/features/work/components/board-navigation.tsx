import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Combobox, IconButton } from '@devon/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
}: {
  scroller: React.RefObject<HTMLDivElement | null>
  members: readonly MemberSummary[]
  currentUserId: string | undefined
  canScrollLeft: boolean
  canScrollRight: boolean
  layoutKey: string
  showEveryone: () => void
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
      board.scrollTo({
        left:
          board.scrollLeft +
          target.getBoundingClientRect().left -
          board.getBoundingClientRect().left -
          16,
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
      setPendingTarget(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingTarget, layoutKey, scroller])

  function jumpTo(id: string) {
    showEveryone()
    setPendingTarget({ id })
  }

  function move(direction: -1 | 1) {
    const board = scroller.current
    if (!board) return
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
      className="flex flex-wrap items-center gap-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <Combobox
          className="h-9 min-w-0 flex-1 text-small sm:w-52"
          value={null}
          onValueChange={jumpTo}
          label={t('work.board.jumpToPerson')}
          placeholder={t('work.board.jumpToPerson')}
          searchPlaceholder={t('work.board.searchPeople')}
          emptyMessage={t('work.board.noPeople')}
          contentClassName="min-w-64"
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
        {currentUserId && members.some((member) => member.userId === currentUserId) ? (
          <Button size="sm" variant="secondary" onClick={() => jumpTo(currentUserId)}>
            {t('work.board.myColumn')}
          </Button>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <IconButton
          aria-label={t('work.board.previousColumns')}
          title={t('work.board.previousColumns')}
          disabled={!canScrollLeft}
          onClick={() => move(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
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
