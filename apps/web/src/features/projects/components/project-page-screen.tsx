// The project page (TECH-SPEC §5, EPIC-005: "project page shows milestones, members' loads and the
// timeline"). Objective/subjective tasks are `app.cards` rows scoped to this project -- there is no
// dedicated "list this project's cards" endpoint, so this reuses the work module's own filter grammar
// (`project:"<title>"`, exactly what a person could type into the work module's own filter bar) via
// `GET /api/v1/cards`, then splits the result by `projectScope` client-side. Objective/subjective are
// rendered as tabs (DESIGN.md's Jakob map: "project page with task tabs, members strip, milestones").
// Milestones render as an ordered list by due date, doubling as this page's "timeline" -- a dedicated
// Gantt (`work`'s `TimelineScreen` already has one for cards) was judged not worth a second bespoke
// SVG for six milestones per project at this build's scale.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, CheckCircle2, ChevronLeft } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  AiPreviewPanel,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Checkbox,
  Input,
  ProgressRing,
  SparkleButton,
  Skeleton,
  StateView,
  Stagger,
  StaggerItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  initialsFromName,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { RouterLink, useSearchParams } from '../../../lib/router.js'
import { useAiSettingsQuery, useRunAiFeatureMutation } from '../../ai/use-ai.js'
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
      <Checkbox
        checked={card.status === 'done'}
        onCheckedChange={(v) =>
          patchCard.mutate({ id: card.id, patch: { status: v === true ? 'done' : 'active' } })
        }
        celebrate
        size="sm"
        aria-label={card.title}
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

type PlanSprintResult = {
  orderedTaskTitles: string[]
  focusTaskTitle: string | null
  scheduleNote: string
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
  const patchCard = usePatchCardMutation()
  const addMilestone = useAddMilestoneMutation(id ?? '')
  const patchMilestone = usePatchMilestoneMutation(id ?? '')

  const [newMilestone, setNewMilestone] = React.useState('')
  const [newObjective, setNewObjective] = React.useState('')

  const aiSettings = useAiSettingsQuery()
  const planAi = useRunAiFeatureMutation('plan_sprint')
  const planEnabled =
    aiSettings.data !== undefined &&
    aiSettings.data.flags['plan_sprint'] === true &&
    aiSettings.data.budgetStatus !== 'hard_stop'
  const [plan, setPlan] = React.useState<{
    result: PlanSprintResult
    tokens: number
    ms: number
  } | null>(null)

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
  const openObjective = objective.filter((c) => c.status !== 'done')

  function runPlanAi() {
    if (openObjective.length === 0) return
    setPlan(null)
    planAi.mutate(
      {
        locale,
        sprintKind: 'day',
        goal: project.title,
        tasks: openObjective.map((c) => ({ title: c.title })),
      },
      {
        onSuccess: (res) => {
          const data = res.data as Partial<PlanSprintResult>
          if (Array.isArray(data.orderedTaskTitles) && typeof data.scheduleNote === 'string') {
            setPlan({
              result: {
                orderedTaskTitles: data.orderedTaskTitles,
                focusTaskTitle: data.focusTaskTitle ?? null,
                scheduleNote: data.scheduleNote,
              },
              tokens: res.meta.totalTokens,
              ms: res.meta.latencyMs,
            })
          }
        },
      },
    )
  }

  async function acceptPlan() {
    if (!plan) return
    const focus = plan.result.focusTaskTitle
      ? openObjective.find((c) => c.title === plan.result.focusTaskTitle)
      : undefined
    if (focus && focus.priority !== 'urgent') {
      await patchCard.mutateAsync({ id: focus.id, patch: { priority: 'urgent' } })
    }
    toast(t('projects.ai.planApplied'))
    setPlan(null)
    planAi.reset()
  }

  return (
    <>
      <div className="mx-auto flex max-w-220 flex-col gap-6 pb-12">
        {/* DESIGN.md §9.1: PageContainer -> PageHeader is the only way a screen starts; this screen's
            header is too specialised (progress ring, colour dot, member stack) to fit PageHeader's
            title/description/actions shape, but it was still missing the one PageHeader gives every
            other screen for free -- a breadcrumb back to the list. */}
        <RouterLink
          href="/projects"
          className="inline-flex w-fit items-center gap-1 text-small text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t('projects.title')}
        </RouterLink>
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <ProgressRing
              value={percent}
              size={56}
              strokeWidth={4.5}
              label={t('projects.tile.progressAria', { percent })}
              toneClassName={project.status === 'done' ? 'text-success' : 'text-primary'}
            >
              {percent}
            </ProgressRing>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: project.colour }}
                  aria-hidden="true"
                />
                <h1 className="font-display text-h2 text-foreground">{project.title}</h1>
                <Badge tone="neutral">{t(`projects.status.${project.status}`)}</Badge>
              </div>
              {project.description ? (
                <p className="max-w-160 text-body text-muted-foreground">
                  {project.description.text}
                </p>
              ) : null}
            </div>
          </div>
          {project.members.length > 0 ? (
            <AvatarStack
              label={t('projects.field.members')}
              people={project.members
                .map((memberId) => members.find((mm) => mm.userId === memberId))
                .filter((m): m is NonNullable<typeof m> => Boolean(m))
                .map((m) => ({
                  id: m.userId,
                  name: fullName(m),
                  initials: initialsFromName(m.givenName, m.familyName),
                }))}
              max={8}
              size="md"
            />
          ) : null}
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('projects.field.milestones')}
          </h2>
          <Stagger as="ol" className="flex flex-col gap-1.5 border-l-2 border-border pl-3">
            {[...project.milestones]
              .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
              .map((m) => (
                <StaggerItem key={m.id} as="li">
                  <div className="relative flex items-center gap-2">
                    <span
                      className={
                        m.doneAt
                          ? 'absolute -left-[19px] size-2.5 rounded-full bg-success'
                          : 'absolute -left-[19px] size-2.5 rounded-full bg-border'
                      }
                      aria-hidden="true"
                    />
                    <Checkbox
                      checked={m.doneAt !== null}
                      onCheckedChange={(v) => {
                        patchMilestone.mutate({
                          milestoneId: m.id,
                          patch: { done: v === true },
                        })
                        // round2 SEV2 "milestone completion has no celebration": the checkbox's own
                        // `celebrate` already bursts on check -- this toast is the same "named
                        // moment" acknowledgement `personal.sprints.complete.toast` gives a
                        // completed sprint, so a milestone reads as just as real a finish line.
                        if (v === true)
                          toast(t('projects.milestone.completedToast', { title: m.title }))
                      }}
                      celebrate
                      size="sm"
                      aria-label={m.title}
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
                  </div>
                </StaggerItem>
              ))}
          </Stagger>
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

        <Tabs defaultValue="objective" className="flex flex-col gap-3">
          <TabsList aria-label={t('projects.field.title')}>
            <TabsTrigger value="objective" count={objective.length}>
              {t('projects.field.objective')}
            </TabsTrigger>
            <TabsTrigger value="subjective" count={subjective.length}>
              {t('projects.field.subjective')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="objective" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-muted-foreground">
                {t('projects.tile.progress', {
                  percent:
                    objective.length > 0
                      ? Math.round(
                          (objective.filter((c) => c.status === 'done').length / objective.length) *
                            100,
                        )
                      : 0,
                })}
              </span>
              {planEnabled && openObjective.length > 0 ? (
                <SparkleButton
                  aria-label={t('projects.ai.plan')}
                  size="sm"
                  loading={planAi.isPending}
                  onClick={runPlanAi}
                />
              ) : null}
            </div>
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

            {planAi.isPending || plan || planAi.isError ? (
              <AiPreviewPanel
                title={t('projects.ai.planPreviewTitle')}
                status={planAi.isPending ? 'pending' : planAi.isError ? 'error' : 'ready'}
                pendingLabel={t('projects.ai.plan')}
                errorMessage={t('work.quickAdd.aiError')}
                acceptLabel={t('projects.ai.applyFocus')}
                editLabel={t('work.ai.edit')}
                discardLabel={t('work.ai.discard')}
                retryLabel={t('work.ai.retry')}
                onAccept={() => void acceptPlan()}
                onEdit={() => setPlan(null)}
                onDiscard={() => {
                  setPlan(null)
                  planAi.reset()
                }}
                onRetry={runPlanAi}
                {...(plan
                  ? { costLine: t('work.quickAdd.aiMeta', { tokens: plan.tokens, ms: plan.ms }) }
                  : {})}
              >
                {plan ? (
                  <div className="flex flex-col gap-2">
                    {plan.result.focusTaskTitle ? (
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                        {t('projects.ai.focus', { title: plan.result.focusTaskTitle })}
                      </p>
                    ) : null}
                    <ol className="flex list-decimal flex-col gap-1 pl-4">
                      {plan.result.orderedTaskTitles.map((title, i) => (
                        <li key={i}>{title}</li>
                      ))}
                    </ol>
                    <p className="text-muted-foreground">{plan.result.scheduleNote}</p>
                  </div>
                ) : null}
              </AiPreviewPanel>
            ) : null}
          </TabsContent>

          <TabsContent value="subjective" className="flex flex-col gap-3">
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
                    <span className="text-small font-medium text-foreground">
                      {fullName(member)}
                    </span>
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
          </TabsContent>
        </Tabs>

        <footer className="flex gap-2 border-t border-border pt-4">
          {project.status !== 'archived' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const previousStatus = project.status
                patchProject.mutate({ status: 'archived' })
                toastWithUndo({
                  message: t('projects.action.archived', { title: project.title }),
                  undoLabel: t('action.undo'),
                  onUndo: () => patchProject.mutate({ status: previousStatus }),
                })
              }}
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
