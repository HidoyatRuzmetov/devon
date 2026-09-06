// One People-board column: a member's header, their group-project tiles (EPIC-005), then their
// cards, ending in a drop target for "append to the end of this column" -- the fallback a card's own
// `dropTargetForElements` (`card-tile.tsx`) never claims because the pointer isn't over any card.
import * as React from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { useT } from '@devon/i18n'
import { Avatar, initialsFromName } from '@devon/ui'
import { ProjectTile } from '../../projects/components/project-tile.js'
import type { Project } from '../../projects/api.js'
import type { Card, Label, MemberSummary } from '../api.js'
import { fullName } from '../lib/format.js'
import { CARD_DRAG_TYPE, CardTile, type CardDropSpec } from './card-tile.js'

export interface BoardColumnProps {
  member: MemberSummary | null // null = the "unassigned" column
  cards: readonly Card[]
  projects: readonly Project[]
  members: readonly MemberSummary[]
  labels: readonly Label[]
  onOpenCard: (cardId: string) => void
  onDropped: (draggedCardId: string, spec: CardDropSpec) => void
  onMoveTo: (cardId: string, toUserId: string | null) => void
}

export function BoardColumn({
  member,
  cards,
  projects,
  members,
  labels,
  onOpenCard,
  onDropped,
  onMoveTo,
}: BoardColumnProps) {
  const t = useT()
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const userId = member?.userId ?? null

  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source.data['type'] === CARD_DRAG_TYPE,
      getData: () => ({ type: CARD_DRAG_TYPE, toUserId: userId }),
      onDrop: ({ source }) => {
        const cardId = source.data['cardId']
        if (typeof cardId === 'string')
          onDropped(cardId, { kind: 'appendToColumn', toUserId: userId })
      },
    })
  }, [userId, onDropped])

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
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
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
          {cards.length}
        </span>
      </div>
      <div ref={listRef} className="flex min-h-24 flex-1 flex-col gap-2 rounded-md p-1">
        {projects.map((p) => (
          <ProjectTile key={p.id} project={p} />
        ))}
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            columnUserId={userId}
            members={members}
            labels={labels}
            onOpen={onOpenCard}
            onDropped={onDropped}
            onMoveTo={onMoveTo}
          />
        ))}
        {cards.length === 0 && projects.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-caption text-muted-foreground">
            {t('work.board.columnEmpty')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
