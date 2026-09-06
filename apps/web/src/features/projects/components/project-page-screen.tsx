// The project page (TECH-SPEC §5, EPIC-005: "project page shows milestones, members' loads and the
// timeline"). Objective/subjective tasks are `app.cards` rows scoped to this project -- there is no
// dedicated "list this project's cards" endpoint, so this reuses the work module's own filter grammar
// (`project:"<title>"`, exactly what a person could type into the work module's own filter bar) via
// `GET /api/v1/cards`, then splits the result by `projectScope` client-side. Milestones render as an
// ordered list by due date, doubling as this page's "timeline" -- a dedicated Gantt (`work`'s
// `TimelineScreen` already has one for cards) was judged not worth a second bespoke SVG for six
// milestones per project at this build's scale.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Avatar, Badge, Button, Input, Skeleton, StateView, initialsFromName } from '@devon/ui'
import { useSearchParams } from '../../../lib/router.js'
import { fetchCards } from '../../work/api.js'
import type { Card } from '../../work/api.js'
import { openCardPeek, CardPeekDialog } from '../../work/components/card-peek-dialog.js'
import { useCreateCardMutation, useMembers, usePatchCardMutation } from '../../work/hooks.js'
import { fullName } from '../../work/lib/format.js'
import {
  useAddMilestoneMutation,
  usePatchMilestoneMutation,
  usePatchProjectMutation,
  useProjectQuery,
} from '../hooks.js'

function useProjectCards(title: string | undefined) {
  return useQuery({
    queryKey: ['projects', 'cards', title],
    // 100 is `GET /api/v1/cards`'s own hard cap (`work/schemas.ts`'s `limit: z.coerce.number()...
    // max(100)`) -- asking for 300 always got a flat 422 (H1: confirmed live, every project page's
    // task list silently rendered "0/0" instead of erroring loudly). A project outgrowing 100 open
    // objective+subjective cards needs real pagination here, not a bigger magic number to outrun.
    queryFn: async () => (await fetchCards({ q: `project:"${title}"`, limit: 100 })).items,
    enabled: Boolean(title),
  })
}

function TaskRow({ card }: { card: Card }) {
  const patchCard = usePatchCardMutation()
  return (
    <div className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent">
      <input
        type="checkbox"
        checked={card.status === 'done'}
        onChange={(e) =>
          patchCard.mutate({ id: card.id, patch: { status: e.target.checked ? 'done' : 'active' } })
        }
        aria-label={card.title}
        className="size-4"
      />
      <button
        type="button"
        onClick={() => openCardPeek(card.id)}
        className={
          card.status === 'done'
            ? 'flex-1 truncate text-left text-small text-muted-foreground line-through'
            : 'flex-1 truncate text-left text-small text-foreground'
        }
      >
        {card.title}
      </button>
    </div>
  )
}

export default function ProjectPageScreen() {
  const t = useT()
  const locale = useLocale()
  const search = useSearchParams()
  const id = search.get('id')
  const projectQuery = useProjectQuery(id)
  const members = useMembers()
  const cardsQuery = useProjectCards(projectQuery.data?.title)
  const createCard = useCreateCardMutation()
  const patchProject = usePatchProjectMutation(id ?? '')
  const addMilestone = useAddMilestoneMutation(id ?? '')
  const patchMilestone = usePatchMilestoneMutation(id ?? '')

  const [newMilestone, setNewMilestone] = React.useState('')
  const [newObjective, setNewObjective] = React.useState('')

  if (!id) {
    return <StateView kind="empty" titleKey="projects.noIdTitle" bodyKey="projects.noIdBody" />
  }
  if (projectQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }
  if (projectQuery.isError || !projectQuery.data) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void projectQuery.refetch() }}
      />
    )
  }

  const project = projectQuery.data
  const cards = cardsQuery.data ?? []
  const objective = cards.filter((c) => c.projectScope === 'objective')
  const subjective = cards.filter((c) => c.projectScope === 'subjective')
  const percent = Math.round(project.progress * 100)

  return (
    <>
      <div className="mx-auto flex max-w-220 flex-col gap-6 pb-12">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: project.colour }}
              aria-hidden="true"
            />
            <h1 className="font-display text-h2 text-foreground">{project.title}</h1>
            <Badge tone="neutral">{t(`projects.status.${project.status}`)}</Badge>
          </div>
          {project.description ? (
            <p className="max-w-160 text-body text-muted-foreground">{project.description.text}</p>
          ) : null}
          <div className="flex items-center gap-3">
            <div className="h-2 w-64 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-small text-muted-foreground">
              {t('projects.tile.progress', { percent })}
            </span>
          </div>
          <div className="flex -space-x-2">
            {project.members.map((memberId) => {
              const m = members.find((mm) => mm.userId === memberId)
              return m ? (
                <Avatar
                  key={memberId}
                  size="md"
                  src={null}
                  alt={fullName(m)}
                  initials={initialsFromName(m.givenName, m.familyName)}
                  hueSeed={memberId}
                  className="ring-2 ring-card"
                />
              ) : null
            })}
          </div>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('projects.field.milestones')}
          </h2>
          <ol className="flex flex-col gap-1.5 border-l border-border pl-3">
            {[...project.milestones]
              .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
              .map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={m.doneAt !== null}
                    onChange={(e) =>
                      patchMilestone.mutate({
                        milestoneId: m.id,
                        patch: { done: e.target.checked },
                      })
                    }
                    aria-label={m.title}
                    className="size-4"
                  />
                  <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span
                    className={
                      m.doneAt
                        ? 'text-small text-muted-foreground line-through'
                        : 'text-small text-foreground'
                    }
                  >
                    {m.title}
                  </span>
                  {m.dueOn ? (
                    <span className="text-caption text-muted-foreground">
                      {formatDate(new Date(m.dueOn), locale)}
                    </span>
                  ) : null}
                </li>
              ))}
          </ol>
          <div className="flex gap-2 pl-3">
            <Input
              value={newMilestone}
              onChange={(e) => setNewMilestone(e.target.value)}
              placeholder={t('projects.milestone.addPlaceholder')}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (newMilestone.trim()) {
                  addMilestone.mutate({ title: newMilestone.trim() })
                  setNewMilestone('')
                }
              }}
            >
              {t('work.action.save')}
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('projects.field.objective')} ({objective.filter((c) => c.status === 'done').length}/
            {objective.length})
          </h2>
          {cardsQuery.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="flex flex-col gap-1 rounded-md border border-border p-2">
              {objective.map((card) => (
                <TaskRow key={card.id} card={card} />
              ))}
              <div className="flex gap-2 pt-1">
                <Input
                  value={newObjective}
                  onChange={(e) => setNewObjective(e.target.value)}
                  placeholder={t('projects.card.addObjectivePlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newObjective.trim()) {
                      createCard.mutate({
                        title: newObjective.trim(),
                        assigneeUserId: project.ownerUserId,
                        giverUserId: project.ownerUserId,
                        projectId: project.id,
                        projectScope: 'objective',
                        kind: 'project_task',
                      })
                      setNewObjective('')
                    }
                  }}
                />
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('projects.field.subjective')}
          </h2>
          {project.members.map((memberId) => {
            const member = members.find((m) => m.userId === memberId)
            if (!member) return null
            const memberTasks = subjective.filter((c) => c.assigneeUserId === memberId)
            return (
              <div
                key={memberId}
                className="flex flex-col gap-1 rounded-md border border-border p-2"
              >
                <div className="flex items-center gap-2">
                  <Avatar
                    size="sm"
                    src={null}
                    alt={fullName(member)}
                    initials={initialsFromName(member.givenName, member.familyName)}
                    hueSeed={memberId}
                  />
                  <span className="text-small font-medium text-foreground">{fullName(member)}</span>
                  <span className="text-caption text-muted-foreground">
                    {memberTasks.filter((c) => c.status === 'done').length}/{memberTasks.length}
                  </span>
                </div>
                {memberTasks.map((card) => (
                  <TaskRow key={card.id} card={card} />
                ))}
                <SubjectiveAddRow
                  projectId={project.id}
                  assigneeUserId={memberId}
                  giverUserId={project.ownerUserId}
                />
              </div>
            )
          })}
        </section>

        <footer className="flex gap-2 border-t border-border pt-4">
          {project.status !== 'archived' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => patchProject.mutate({ status: 'archived' })}
            >
              {t('projects.action.archive')}
            </Button>
          ) : null}
        </footer>
      </div>
      <CardPeekDialog />
    </>
  )
}

function SubjectiveAddRow({
  projectId,
  assigneeUserId,
  giverUserId,
}: {
  projectId: string
  assigneeUserId: string
  giverUserId: string
}) {
  const t = useT()
  const [text, setText] = React.useState('')
  const createCard = useCreateCardMutation()
  return (
    <div className="flex gap-2 pt-1">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('projects.card.addSubjectivePlaceholder')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            createCard.mutate({
              title: text.trim(),
              assigneeUserId,
              giverUserId,
              projectId,
              projectScope: 'subjective',
              kind: 'project_task',
            })
            setText('')
          }
        }}
      />
    </div>
  )
}
