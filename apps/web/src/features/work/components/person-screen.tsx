import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Button, Badge, StateView, cn } from '@devon/ui'
import {
  CheckCheck,
  Circle,
  CircleDot,
  FolderKanban,
  ListTodo,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react'
import { useDepartment, useMeQuery } from '../../../lib/session.js'
import { replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { ViewSkeleton } from '../../../lib/view-skeleton.js'
import { fetchCards, type Card } from '../api.js'
import { useBoardQuery, useLiveRefetchInterval } from '../hooks.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import { orderBoardCards } from '../lib/board-state.js'
import { PRIORITY_LABEL_KEY, PRIORITY_BADGE_TONE } from '../lib/format.js'
import { openCardPeek, CardPeekDialog } from './card-peek-dialog.js'
import { CheckinMemberChooser } from '../../analytics/checkin-member.js'
import { fetchUnitsOverview } from '../../structure/api.js'
import { WorkShell } from './work-shell.js'
import { NewCardDialog } from './new-card-dialog.js'
import { CardActionsMenu } from './card-actions-menu.js'
import { TaskChecklist } from './task-checklist.js'
import { RestoreCardButton } from './restore-card-button.js'
import './person-screen.css'

export type PersonStage = 'todo' | 'in_progress' | 'done' | 'deleted'
const stages = [
  { id: 'todo', icon: Circle, label: 'homeMember.toDo' },
  { id: 'in_progress', icon: CircleDot, label: 'homeMember.inProgress' },
  { id: 'done', icon: CheckCheck, label: 'homeMember.done' },
  { id: 'deleted', icon: Trash2, label: 'cardActions.deleted' },
] as const

export function personCardStage(card: Card): PersonStage {
  return card.deletedAt ? 'deleted' : card.status === 'done' ? 'done' : (card.workStage ?? 'todo')
}

/** Fetch both lifecycle partitions and follow every cursor; a person's history is not a top-100 view. */
export async function fetchPersonCards(userId: string, signal?: AbortSignal): Promise<Card[]> {
  const partitions = await Promise.all(
    [false, true].map(async (deleted) => {
      const cards: Card[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      do {
        signal?.throwIfAborted()
        const page = await fetchCards({ assigneeUserId: userId, deleted, limit: 100, cursor })
        cards.push(...page.items)
        if (!page.nextCursor) break
        if (seen.has(page.nextCursor)) throw new Error('Repeated card cursor')
        seen.add(page.nextCursor)
        cursor = page.nextCursor
      } while (cursor)
      signal?.throwIfAborted()
      return cards
    }),
  )
  return [...new Map(partitions.flat().map((card) => [card.id, card])).values()]
}

function PersonTask({ card, projectTitle }: { card: Card; projectTitle?: string | undefined }) {
  const t = useT()
  const locale = useLocale()
  const deleted = Boolean(card.deletedAt)
  const pinned = card.assigneePinned || card.focusPinned
  const body = (
    <>
      {projectTitle ? (
        <span className="mb-1.5 flex items-center gap-1.5 text-caption text-muted-foreground">
          <FolderKanban className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{projectTitle}</span>
        </span>
      ) : null}
      <span className="block break-words text-small font-semibold leading-snug">{card.title}</span>
      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {pinned && !deleted ? (
          <Pin className="size-3 text-primary" aria-label={t('personWork.pinned')} />
        ) : null}
        <Badge tone={PRIORITY_BADGE_TONE[card.priority]}>
          {t(PRIORITY_LABEL_KEY[card.priority])}
        </Badge>
        {card.dueAt && !deleted ? (
          <span
            className={cn(
              'text-caption tabular-nums text-muted-foreground',
              card.status === 'active' && card.risk === 'overdue' && 'text-destructive',
            )}
          >
            {formatDate(new Date(card.dueAt), locale)}
          </span>
        ) : null}
      </span>
    </>
  )
  return (
    <article
      data-person-card={card.id}
      className={cn(
        'person-task',
        pinned && !deleted && 'person-task-pinned',
        deleted && 'person-task-deleted',
      )}
    >
      <div className="flex items-start gap-1 px-3 pt-3">
        {deleted ? (
          <div className="min-w-0 flex-1 pb-2">{body}</div>
        ) : (
          <button
            type="button"
            className="person-task-open min-w-0 flex-1 pb-3 text-left"
            onClick={() => openCardPeek(card.id)}
          >
            {body}
          </button>
        )}
        {!deleted ? <CardActionsMenu card={card} /> : null}
      </div>
      {deleted ? (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
          <span className="text-caption text-muted-foreground">
            {formatDate(new Date(card.deletedAt!), locale)}
          </span>
          <RestoreCardButton card={card} />
        </div>
      ) : (
        <div className="border-t border-border/60 px-3 py-1.5">
          <TaskChecklist
            cardId={card.id}
            card={card}
            total={card.checklistTotal}
            done={card.checklistDone}
            defaultExpanded={false}
            compact
          />
        </div>
      )}
    </article>
  )
}

export default function PersonScreen() {
  const t = useT()
  const { department } = useDepartment()
  const me = useMeQuery()
  const board = useBoardQuery()
  const projects = useProjectsQuery()
  const units = useQuery({
    queryKey: ['structure', 'units', department?.departmentId],
    queryFn: () => fetchUnitsOverview(department!.departmentId),
    enabled: Boolean(department?.departmentId),
  })
  const search = useSearchParams()
  const viewerId = me.data?.user.id ?? ''
  const personId = search.get('person') ?? viewerId
  const members = board.data?.members ?? []
  const person = members.find((member) => member.userId === personId)
  const cards = useQuery({
    queryKey: ['work', 'cards', 'person', department?.departmentId, viewerId, personId],
    queryFn: ({ signal }) => fetchPersonCards(personId, signal),
    enabled: Boolean(department?.departmentId && viewerId && person),
    // Centrifugo's work events refresh every person partition. This shared work helper disables
    // its fallback while connected and during optimistic writes, retaining offline parity with Board.
    // nosemgrep: devon-polling-instead-of-realtime -- Reviewed disconnected-transport fallback, matching work/hooks.ts.
    refetchInterval: useLiveRefetchInterval(),
  })
  const mayCreate = department?.role === 'head' || viewerId === personId
  const ordered = React.useMemo(() => orderBoardCards(cards.data ?? [], 'attention'), [cards.data])
  const projectNames = new Map((projects.data ?? []).map((project) => [project.id, project.title]))
  const loading = me.isPending || board.isPending || (Boolean(person) && cards.isPending)
  const error = board.error ?? cards.error
  const activeCount = ordered.filter((card) => !card.deletedAt && card.status === 'active').length
  const doneCount = ordered.filter((card) => !card.deletedAt && card.status === 'done').length
  const personPicker = (
    <CheckinMemberChooser
      data={{ members, units: units.data?.units ?? [] }}
      selected={person}
      label={t('personWork.choosePerson')}
      onChange={(id) => {
        if (id) replaceSearchParam('person', id === viewerId ? null : id)
      }}
    />
  )

  return (
    <WorkShell
      showQuickAdd={false}
      hideMeControl
      fillViewport
      mobileToolbar={<div className="min-w-0 flex-1">{personPicker}</div>}
      toolbar={
        <div className="mb-1 ml-auto hidden min-w-0 max-w-full md:block">{personPicker}</div>
      }
    >
      {loading ? (
        <ViewSkeleton view="personWork" />
      ) : error ? (
        <StateView
          kind="error"
          titleKey="state.error.title"
          bodyKey="state.error.body"
          action={{
            labelKey: 'state.error.action',
            onAction: () => {
              void board.refetch()
              void cards.refetch()
            },
          }}
        />
      ) : !person ? (
        <StateView
          kind="empty"
          titleKey="personWork.unavailable"
          bodyKey="personWork.chooseAnother"
        />
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-small text-muted-foreground">
              <ListTodo className="size-4" aria-hidden="true" />
              {t('personWork.summary', { active: activeCount, done: doneCount })}
            </p>
            {mayCreate ? (
              <Button size="sm" onClick={() => replaceSearchParam('new', '1')}>
                <Plus className="size-4" aria-hidden="true" />
                {t('work.actions.create')}
              </Button>
            ) : null}
          </div>
          <div className="person-work-columns" data-testid="person-work-columns">
            {stages.map(({ id, icon: Icon, label }) => {
              const items = ordered.filter((card) => personCardStage(card) === id)
              return (
                <section
                  key={id}
                  className="person-work-column"
                  data-stage={id}
                  aria-label={t(label)}
                >
                  <header className="person-work-column-heading">
                    <Icon className="size-4" aria-hidden="true" />
                    <h2 className="text-small font-semibold">{t(label)}</h2>
                    <span className="ml-auto text-caption tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  </header>
                  <div
                    className="person-work-column-body"
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Named scroll regions need keyboard access when their cards exceed the viewport.
                    tabIndex={0}
                    role="region"
                    aria-label={t(label)}
                  >
                    {items.map((card) => (
                      <PersonTask
                        key={card.id}
                        card={card}
                        projectTitle={card.projectId ? projectNames.get(card.projectId) : undefined}
                      />
                    ))}
                    {items.length === 0 ? (
                      <p className="person-work-empty">{t(`personWork.empty.${id}`)}</p>
                    ) : null}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
      <NewCardDialog defaultAssigneeUserId={personId} />
      <CardPeekDialog />
    </WorkShell>
  )
}
