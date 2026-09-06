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
import { Skeleton, StateView, cn, unitHueClass } from '@devon/ui'
import { useDepartment, useSession } from '../../../lib/session.js'
import { useSearchParams } from '../../../lib/router.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import type { Card } from '../api.js'
import { keyBetween } from '../lib/fractional.js'
import { useAnnounce, DndAnnouncerProvider } from './dnd-announcer.js'
import { useBoardQuery, useMoveCardMutation } from '../hooks.js'
import { BoardColumn } from './board-column.js'
import { CardPeekDialog, openCardPeek } from './card-peek-dialog.js'
import { WorkShell } from './work-shell.js'
import type { CardDropSpec } from './card-tile.js'
import { fullName } from '../lib/format.js'

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
  const boardQuery = useBoardQuery()
  const projectsQuery = useProjectsQuery()
  const moveCard = useMoveCardMutation()
  const announce = useAnnounce()
  const search = useSearchParams()
  const q = search.get('q') ?? ''

  const board = boardQuery.data
  const projects = React.useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])

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

  return (
    <div className="flex h-full flex-col gap-4">
      <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex items-center gap-2 px-1">
          <span
            className={cn('size-2.5 shrink-0 rounded-full', unitHueClass(departmentId ?? 'devon'))}
            aria-hidden="true"
          />
          <h2 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {department?.name ?? t('work.board.department')}
          </h2>
        </div>
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden pb-2">
          {board.columns.map((col) => (
            <BoardColumn
              key={col.member.userId}
              member={col.member}
              cards={col.cards.filter(filterCard)}
              projects={projects.filter((p) => p.members.includes(col.member.userId))}
              members={board.members}
              labels={board.labels}
              onOpenCard={openCardPeek}
              onDropped={handleDropped}
              onMoveTo={handleMoveTo}
            />
          ))}
          <BoardColumn
            member={null}
            cards={board.unassigned.filter(filterCard)}
            projects={[]}
            members={board.members}
            labels={board.labels}
            onOpenCard={openCardPeek}
            onDropped={handleDropped}
            onMoveTo={handleMoveTo}
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
    </DndAnnouncerProvider>
  )
}
