// Project cards are loaded by immutable project id and paginated, so renaming a project or sharing
// a title with another project cannot silently move/hide its tasks.
import * as React from 'react'
import { can } from '@devon/contracts'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Checkbox,
  cn,
  initialsFromName,
  Input,
  ProgressRing,
  Skeleton,
  SparkleButton,
  Stagger,
  StaggerItem,
  StateView,
  Strikethrough,
  strikethroughClass,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { RouterLink, useSearchParams, navigate } from '../../../lib/router.js'
import { useActor } from '../../../lib/can.js'
import { EditProjectDialog } from './edit-project-dialog.js'
import { MilestoneActions } from './milestone-actions.js'
import { taskProgress } from '../progress.js'
import { projectPlanRanks } from '../plan-order.js'
import { useAddFocusMutation, useFocusListQuery } from '../../work/hooks-plus.js'
import { useAiSettingsQuery, useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { AiResultPanel } from '../../ai/components/ai-result-panel.js'
import { CatchUpPreview, PlanPreview } from '../../ai/components/previews.js'
import { parseFeatureOutput, type CatchUpOutput, type PlanSprintOutput } from '../../ai/outputs.js'
import type { RunMeta } from '../../ai/types.js'
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
  useDeleteProjectMutation,
} from '../hooks.js'

function useProjectCards(projectId: string | undefined) {
  return useQuery({
    queryKey: ['work', 'cards', { projectId }],
    queryFn: async () => {
      const cards: Card[] = []
      let cursor: string | undefined
      do {
        const page = await fetchCards({ projectId, cursor, limit: 100 })
        cards.push(...page.items)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return cards
    },
    enabled: Boolean(projectId),
  })
}

function TaskRow({ card }: { card: Card }) {
  const patchCard = usePatchCardMutation()
  return (
    <div className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent">
      <Checkbox
        disabled={card.canEdit === false || patchCard.isPending}
        checked={card.status === 'done'}
        onCheckedChange={(v) =>
          patchCard.mutate({
            id: card.id,
            patch: { status: v === true ? 'done' : 'active' },
          })
        }
        celebrate
        size="sm"
        aria-label={card.title}
      />
      <button
        type="button"
        onClick={() => openCardPeek(card.id)}
        className={cn(
          'flex-1 truncate text-left text-small text-foreground',
          strikethroughClass(card.status === 'done'),
        )}
      >
        {card.title}
      </button>
      {card.checklistTotal > 0 ? (
        <span className="text-caption tabular-nums text-muted-foreground">
          {card.checklistDone}/{card.checklistTotal}
        </span>
      ) : null}
    </div>
  )
}

export default function ProjectPageScreen() {
  const t = useT()
  const actor = useActor()
  const locale = useLocale()
  const search = useSearchParams()
  const id = search.get('id')
  const projectQuery = useProjectQuery(id)
  const members = useMembers()
  const cardsQuery = useProjectCards(projectQuery.data?.id)
  const createCard = useCreateCardMutation()
  const patchProject = usePatchProjectMutation(id ?? '')
  const patchCard = usePatchCardMutation()
  const addMilestone = useAddMilestoneMutation(id ?? '')
  const patchMilestone = usePatchMilestoneMutation(id ?? '')
  const deleteProject = useDeleteProjectMutation()
  const undoDelete = useDeleteProjectMutation(true)

  const [newMilestone, setNewMilestone] = React.useState('')
  const milestoneAddRef = React.useRef<HTMLInputElement>(null)
  const [newObjective, setNewObjective] = React.useState('')

  const aiSettings = useAiSettingsQuery()
  const planAi = useRunAiFeatureMutation('plan_sprint')
  const addFocus = useAddFocusMutation()
  const focusList = useFocusListQuery()
  const planEnabled =
    aiSettings.data !== undefined &&
    aiSettings.data.flags['plan_sprint'] === true &&
    aiSettings.data.budgetStatus !== 'hard_stop'
  const [plan, setPlan] = React.useState<{
    output: PlanSprintOutput
    meta: RunMeta
  } | null>(null)

  // N-4: "Juma kunidan beri nima oʻzgardi?" over this project's own cards. The same `catch_up`
  // prompt as the personal and department briefings, at `scope: 'project'` -- one feature, three
  // scopes, one golden set (AI-AUDIT §4, D-1).
  const catchUpAi = useRunAiFeatureMutation('catch_up')
  const catchUpEnabled =
    aiSettings.data !== undefined &&
    aiSettings.data.flags['catch_up'] === true &&
    aiSettings.data.budgetStatus !== 'hard_stop'
  const [catchUp, setCatchUp] = React.useState<{
    output: CatchUpOutput
    meta: RunMeta
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
        action={{
          labelKey: 'state.error.action',
          onAction: () => void projectQuery.refetch(),
        }}
      />
    )
  }

  const project = projectQuery.data
  const canEdit = can(actor, 'update', {
    kind: 'owned',
    departmentId: actor?.departmentId ?? '',
    ownerUserIds: [project.ownerUserId, ...project.members],
  }).allowed
  const cards = cardsQuery.data ?? []
  const objective = cards.filter((c) => c.projectScope !== 'subjective')
  const subjective = cards.filter((c) => c.projectScope === 'subjective')
  const percent = Math.round(project.progress * 100)
  const canDelete = can(actor, 'delete', {
    kind: 'owned',
    departmentId: actor?.departmentId ?? '',
    ownerUserIds: [project.ownerUserId],
  }).allowed
  const openObjective = objective.filter((c) => c.status !== 'done')

  async function removeProject() {
    try {
      await deleteProject.mutateAsync(project.id)
      navigate('/projects')
      toastWithUndo({
        message: t('projectLifecycle.deleted'),
        undoLabel: t('action.undo'),
        durationMs: 20_000,
        onUndo: async () => {
          await undoDelete.mutateAsync(project.id)
          navigate(`/projects/view?id=${encodeURIComponent(project.id)}`)
        },
      })
    } catch {
      /* The mutation hook reports the error. */
    }
  }

  function runPlanAi() {
    if (openObjective.length === 0) return
    setPlan(null)
    // AI-AUDIT §4 D-5: v1.0 lied to this feature to reuse it -- `sprintKind: 'day'` and
    // `goal: project.title` on a call that is not planning a day and has no goal. The scope is
    // explicit now, and the feature is told the real due dates, priorities and estimates instead of
    // titles alone, which is the difference between an ordering and a re-sort.
    const now = new Date()
    const horizon = new Date(now.getTime() + 14 * 86_400_000)
    planAi.mutate(
      {
        locale,
        scope: 'project',
        projectId: project.id,
        periodKind: 'custom',
        now: now.toISOString(),
        periodEndsAt: horizon.toISOString(),
        capacityMin: null,
        goal: project.title,
        items: openObjective.map((c) => ({
          id: c.id,
          title: c.title,
          estimateMin: c.estimateMin,
          dueAt: c.dueAt,
          priority: c.priority,
          assigneeName: members.find((m) => m.userId === c.assigneeUserId)
            ? fullName(members.find((m) => m.userId === c.assigneeUserId)!)
            : null,
          blockedByIds: [],
        })),
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<PlanSprintOutput>('plan_sprint', res.data)
          if (output) setPlan({ output, meta: res.meta })
        },
      },
    )
  }

  /**
   * AI-AUDIT §0.2: v1.0 rendered the whole ordering and then applied **one field patch** --
   * `priority: 'urgent'` on the focus card. Everything else the person read was discarded.
   *
   * The ordering is the answer, so the ordering is what lands: the plan's own sequence becomes the
   * cards' `orderKey` order on the board, the focus card is pinned to the user's focus list, and anything the model
   * said will not fit in the horizon is left alone (moving a due date the person did not ask about
   * is not this feature's business).
   */
  async function acceptPlan() {
    if (!plan) return
    if (openObjective.some((c) => c.canEdit === false)) return
    const byId = new Map(openObjective.map((c) => [c.id, c] as const))
    const ordered = plan.output.orderedIds.filter((id) => byId.has(id))

    // One patch per card, all independent, so `Promise.all` rather than an awaited loop
    // (TECH-SPEC §16: no query in a loop).
    try {
      await Promise.all(
        projectPlanRanks(openObjective, ordered).map(({ id, orderKey }) =>
          patchCard.mutateAsync({ id, patch: { orderKey } }),
        ),
      )
    } catch {
      return
    }
    const focusId = plan.output.focusId
    if (
      focusId &&
      byId.has(focusId) &&
      !focusList.data?.items.some((pin) => pin.cardId === focusId)
    ) {
      try {
        await addFocus.mutateAsync(focusId)
      } catch {
        toast.error(t('work.focus.failed'))
      }
    }
    toast(t('projects.ai.planApplied'))
    setPlan(null)
    planAi.reset()
  }

  function runCatchUp() {
    setCatchUp(null)
    const now = Date.now()
    const weekAgo = now - 7 * 86_400_000
    const asItem = (c: Card) => ({ id: c.id, title: c.title })
    const done = cards.filter(
      (c) => c.status === 'done' && c.doneAt !== null && new Date(c.doneAt).getTime() >= weekAgo,
    )
    const isOverdue = (c: Card): boolean => {
      if (c.status === 'done' || c.dueAt === null) return false
      return new Date(c.dueAt).getTime() < now
    }
    const overdue = cards.filter(isOverdue)
    catchUpAi.mutate(
      {
        locale,
        scope: 'project',
        window: 'week',
        projectId: project.id,
        subjectName: project.title,
        viewerName: t('projects.ai.viewerYou'),
        period: {
          start: new Date(weekAgo).toISOString().slice(0, 10),
          end: new Date(now).toISOString().slice(0, 10),
        },
        counts: {
          done: done.length,
          doneLastPeriod: 0,
          created: 0,
          overdue: overdue.length,
        },
        done: done.map(asItem),
        overdue: overdue.map(asItem),
        dueThisWeek: [],
        assignedToMe: [],
        mentions: [],
        comments: [],
        loadPerPerson: [],
        eventsAhead: [],
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<CatchUpOutput>('catch_up', res.data)
          if (output) setCatchUp({ output, meta: res.meta })
        },
      },
    )
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
          {canEdit ? (
            <div className="self-end">
              <EditProjectDialog project={project} />
            </div>
          ) : null}
          <div className="flex items-start gap-3">
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
              <h1 className="break-words font-display text-h3 text-foreground sm:text-h2">
                {project.title}
              </h1>
              <div className="flex items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: project.colour }}
                  aria-hidden="true"
                />
                <Badge tone="neutral">{t(`projects.status.${project.status}`)}</Badge>
              </div>
              {project.description ? (
                <p className="max-w-160 text-body text-muted-foreground">
                  {project.description.text}
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-caption text-muted-foreground">{t('projectLifecycle.progressHint')}</p>
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

        {/* N-4: "what changed on this project since Friday", where the question is actually asked --
            the project header, not a settings screen. Head or member: a project's own progress is
            not managerial information, it is the work. */}
        {catchUpEnabled ? (
          <section className="flex flex-col gap-2">
            <SparkleButton
              aria-label={t('projects.ai.catchUp')}
              label={t('projects.ai.catchUp')}
              size="sm"
              className="self-start"
              loading={catchUpAi.isPending}
              onClick={runCatchUp}
            />
            {catchUpAi.isPending || catchUp || catchUpAi.isError ? (
              <AiResultPanel
                title={t('projects.ai.catchUpPreviewTitle')}
                status={catchUpAi.isPending ? 'pending' : catchUpAi.isError ? 'error' : 'ready'}
                errorMessage={t('work.quickAdd.aiError')}
                {...(catchUp ? { meta: catchUp.meta } : {})}
                // Nothing to accept: a briefing is something you read, and every risk it names is
                // already a link to the card it is about.
                readOnly
                onDiscard={() => {
                  setCatchUp(null)
                  catchUpAi.reset()
                }}
                onRetry={runCatchUp}
              >
                {catchUp ? (
                  <CatchUpPreview
                    output={catchUp.output}
                    cardTitle={(id) => cards.find((c) => c.id === id)?.title ?? null}
                  />
                ) : null}
              </AiResultPanel>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-small font-semibold uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('projects.field.milestones')}
          </h2>
          <Stagger as="ol" className="flex flex-col gap-1.5 border-l-2 border-border pl-3">
            {[...project.milestones]
              .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
              .map((m) => (
                <StaggerItem key={m.id} as="li">
                  <div className="relative flex items-start gap-2">
                    <span
                      className={
                        m.doneAt
                          ? 'absolute -left-[19px] top-1.5 size-2.5 rounded-full bg-success max-md:top-4'
                          : 'absolute -left-[19px] top-1.5 size-2.5 rounded-full bg-border max-md:top-4'
                      }
                      aria-hidden="true"
                    />
                    <Checkbox
                      id={`project-milestone-${m.id}`}
                      disabled={!canEdit || patchMilestone.isPending}
                      checked={m.doneAt !== null}
                      onCheckedChange={(v) => {
                        patchMilestone.mutate(
                          {
                            milestoneId: m.id,
                            patch: { done: v === true },
                          },
                          {
                            onSuccess: () => {
                              if (v === true)
                                toast(
                                  t('projects.milestone.completedToast', {
                                    title: m.title,
                                  }),
                                )
                            },
                          },
                        )
                        // round2 SEV2 "milestone completion has no celebration": the checkbox's own
                        // `celebrate` already bursts on check -- this toast is the same "named
                        // moment" acknowledgement `personal.sprints.complete.toast` gives a
                        // completed sprint, so a milestone reads as just as real a finish line.
                      }}
                      celebrate
                      size="sm"
                      aria-label={m.title}
                    />
                    <div className="min-w-0 flex-1 py-0.5 max-md:py-3">
                      <label
                        htmlFor={`project-milestone-${m.id}`}
                        className={cn(
                          'block break-words text-small text-foreground',
                          canEdit && 'cursor-pointer',
                        )}
                      >
                        <Strikethrough done={m.doneAt !== null}>{m.title}</Strikethrough>
                      </label>
                      {m.dueOn ? (
                        <time
                          dateTime={m.dueOn}
                          className="mt-1 flex items-center gap-1 text-caption text-muted-foreground"
                        >
                          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                          {formatDate(new Date(m.dueOn), locale)}
                        </time>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <MilestoneActions
                        projectId={project.id}
                        milestone={m}
                        onDeleted={() => milestoneAddRef.current?.focus()}
                      />
                    ) : null}
                  </div>
                </StaggerItem>
              ))}
          </Stagger>
          {canEdit ? (
            <div className="flex gap-2 pl-3">
              <Input
                ref={milestoneAddRef}
                className="min-w-0"
                value={newMilestone}
                onChange={(e) => setNewMilestone(e.target.value)}
                placeholder={t('projects.milestone.addPlaceholder')}
                aria-label={t('projects.milestone.addPlaceholder')}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!newMilestone.trim() || addMilestone.isPending}
                onClick={() => {
                  if (newMilestone.trim()) {
                    addMilestone.mutate(
                      { title: newMilestone.trim() },
                      { onSuccess: () => setNewMilestone('') },
                    )
                  }
                }}
              >
                {t('work.action.save')}
              </Button>
            </div>
          ) : null}
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
                  percent: Math.round(taskProgress(objective) * 100),
                })}
              </span>
              {canEdit && planEnabled && openObjective.length > 0 ? (
                <SparkleButton
                  aria-label={t('projects.ai.plan')}
                  size="sm"
                  loading={planAi.isPending}
                  onClick={runPlanAi}
                />
              ) : null}
            </div>
            {cardsQuery.isError ? (
              <StateView
                kind="error"
                titleKey="state.error.title"
                action={{
                  labelKey: 'state.error.action',
                  onAction: () => void cardsQuery.refetch(),
                }}
              />
            ) : null}
            {cardsQuery.isPending ? <Skeleton className="h-20 w-full" /> : null}
            {!cardsQuery.isPending && !cardsQuery.isError ? (
              <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                {objective.map((card) => (
                  <TaskRow key={card.id} card={card} />
                ))}
                {canEdit ? (
                  <form
                    className="flex gap-2 pt-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!newObjective.trim() || createCard.isPending) return
                      createCard.mutate(
                        {
                          title: newObjective.trim(),
                          assigneeUserId: project.ownerUserId,
                          giverUserId: project.ownerUserId,
                          projectId: project.id,
                          projectScope: 'objective',
                          kind: 'project_task',
                        },
                        { onSuccess: () => setNewObjective('') },
                      )
                    }}
                  >
                    <Input
                      value={newObjective}
                      onChange={(e) => setNewObjective(e.target.value)}
                      placeholder={t('projects.card.addObjectivePlaceholder')}
                      aria-label={t('projects.card.addObjectivePlaceholder')}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={!newObjective.trim() || createCard.isPending}
                    >
                      {t('work.action.save')}
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}

            {planAi.isPending || plan || planAi.isError ? (
              <AiResultPanel
                title={t('projects.ai.planPreviewTitle')}
                status={planAi.isPending ? 'pending' : planAi.isError ? 'error' : 'ready'}
                errorMessage={t('work.quickAdd.aiError')}
                acceptLabel={t('projects.ai.applyPlan')}
                editLabel={t('work.ai.edit')}
                {...(plan ? { meta: plan.meta } : {})}
                readOnly={openObjective.some((c) => c.canEdit === false)}
                onAccept={() => void acceptPlan()}
                // Edit opens the focus card so the person can adjust it before the plan lands --
                // v1.0's Edit discarded the answer, which is what Discard already did.
                onEdit={() => {
                  if (plan?.output.focusId) openCardPeek(plan.output.focusId)
                }}
                onDiscard={() => {
                  setPlan(null)
                  planAi.reset()
                }}
                onRetry={runPlanAi}
              >
                {plan ? (
                  <PlanPreview
                    output={plan.output}
                    itemTitle={(id) => cards.find((c) => c.id === id)?.title ?? null}
                  />
                ) : null}
              </AiResultPanel>
            ) : null}
          </TabsContent>

          <TabsContent value="subjective" className="flex flex-col gap-3">
            {[
              ...new Set([
                ...project.members,
                ...subjective
                  .map((c) => c.assigneeUserId)
                  .filter((id): id is string => Boolean(id)),
              ]),
            ].map((memberId) => {
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
                  {canEdit ? (
                    <SubjectiveAddRow
                      projectId={project.id}
                      assigneeUserId={memberId}
                      giverUserId={project.ownerUserId}
                    />
                  ) : null}
                </div>
              )
            })}
          </TabsContent>
        </Tabs>

        <footer className="flex flex-col items-start gap-3 border-t border-border pt-4 sm:flex-row">
          {canDelete ? (
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={deleteProject.isPending}
                onClick={() => void removeProject()}
              >
                {t('projectLifecycle.delete')}
              </Button>
              <p className="text-caption text-muted-foreground">
                {t('projectLifecycle.deleteHint')}
              </p>
            </div>
          ) : null}
          {canEdit && project.status !== 'archived' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const previousStatus = project.status
                patchProject.mutate(
                  { status: 'archived' },
                  {
                    onSuccess: () =>
                      toastWithUndo({
                        message: t('projects.action.archived', {
                          title: project.title,
                        }),
                        undoLabel: t('action.undo'),
                        onUndo: () => patchProject.mutate({ status: previousStatus }),
                      }),
                  },
                )
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
    <form
      className="flex gap-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim() || createCard.isPending) return
        createCard.mutate(
          {
            title: text.trim(),
            assigneeUserId,
            giverUserId,
            projectId,
            projectScope: 'subjective',
            kind: 'project_task',
          },
          { onSuccess: () => setText('') },
        )
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('projects.card.addSubjectivePlaceholder')}
        aria-label={t('projects.card.addSubjectivePlaceholder')}
      />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={!text.trim() || createCard.isPending}
      >
        {t('work.action.save')}
      </Button>
    </form>
  )
}
