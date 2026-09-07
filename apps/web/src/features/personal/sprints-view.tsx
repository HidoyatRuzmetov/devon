// Periods (TECH-SPEC §3.3: "3h/day/week/custom, goal and rollover") -- what the product calls a
// "sprint" internally (`SprintKind` etc.) is always "period" in copy, never the banned project-
// management jargon (DESIGN.md §5, `packages/i18n` banned-word gate).
//
// AI wiring: "Plan with AI" (`plan_sprint`) reorders one active period's open to-dos and names the one
// to start with; "Weekly summary" (`weekly_summary`) narrates the last seven days of finished/new
// to-dos into a note. Both go through `<AiPreviewPanel>`'s Accept/Edit/Discard.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Plus, RotateCcw, Sparkles, Target } from 'lucide-react'
import {
  AiPreviewPanel,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTrigger,
  EmptyPersonalIllustration,
  Input,
  ProgressRing,
  Reveal,
  SparkleButton,
  Stagger,
  StaggerItem,
  StateView,
  Textarea,
  toast,
} from '@devon/ui'
import { useRunAiFeatureMutation } from '../ai/use-ai.js'
import { aiCostLine, aiErrorMessageKey } from './lib/ai-helpers.js'
import {
  SPRINT_KIND_LABEL_KEYS,
  defaultSprintRange,
  formatTimeLeft,
  sprintElapsedPct,
  sprintHasEnded,
} from './lib/sprint-labels.js'
import {
  useCreateNoteMutation,
  useCreateSprintMutation,
  usePatchSprintMutation,
  useReorderTasksMutation,
  useRolloverSprintMutation,
  useSprintsQuery,
  useTasksQuery,
} from './use-personal.js'
import type { Sprint, SprintKind, Task } from './types.js'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type PlanAiState =
  | { sprintId: string; status: 'pending' }
  | {
      sprintId: string
      status: 'ready'
      orderedTitles: string[]
      focusTitle: string | null
      note: string
      costLine: string
      editing: boolean
    }
  | { sprintId: string; status: 'error'; message: string }

type WeeklyAiState =
  | { status: 'pending' }
  | { status: 'ready'; narrative: string; costLine: string; editing: boolean }
  | { status: 'error'; message: string }

function SprintPlanPanel({
  state,
  draft,
  onDraftChange,
  onAccept,
  onEditToggle,
  onDiscard,
}: {
  state: PlanAiState
  draft: string
  onDraftChange: (value: string) => void
  onAccept: () => void
  onEditToggle: () => void
  onDiscard: () => void
}) {
  const t = useT()
  return (
    <AiPreviewPanel
      title={t('personal.ai.planSprint.title')}
      status={state.status}
      pendingLabel={t('personal.ai.pending')}
      acceptLabel={t('personal.ai.accept')}
      editLabel={t('personal.ai.edit')}
      discardLabel={t('personal.ai.discard')}
      {...(state.status === 'error' ? { errorMessage: state.message } : {})}
      {...(state.status === 'ready' ? { costLine: state.costLine } : {})}
      onAccept={onAccept}
      onDiscard={onDiscard}
      onEdit={onEditToggle}
    >
      {state.status === 'ready' ? (
        state.editing ? (
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={Math.max(3, state.orderedTitles.length)}
            aria-label={t('personal.ai.planSprint.editAria')}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <ol className="flex flex-col gap-1.5">
              {state.orderedTitles.map((title, i) => (
                <li key={i} className="flex items-start gap-2 text-body">
                  <span className="mt-0.5 shrink-0 text-caption tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span className={title === state.focusTitle ? 'font-medium text-foreground' : ''}>
                    {title}
                  </span>
                  {title === state.focusTitle ? (
                    <Badge tone="attention">{t('personal.ai.planSprint.focusBadge')}</Badge>
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="text-small text-muted-foreground">{state.note}</p>
          </div>
        )
      ) : null}
    </AiPreviewPanel>
  )
}

export function SprintsView() {
  const t = useT()
  const locale = useLocale()
  const sprintsQuery = useSprintsQuery()
  const tasksQuery = useTasksQuery()
  const createSprint = useCreateSprintMutation()
  const patchSprint = usePatchSprintMutation()
  const rollover = useRolloverSprintMutation()
  const reorderTasks = useReorderTasksMutation()
  const createNote = useCreateNoteMutation()
  const planSprint = useRunAiFeatureMutation('plan_sprint')
  const weeklySummary = useRunAiFeatureMutation('weekly_summary')

  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<SprintKind>('week')
  const [goal, setGoal] = React.useState('')
  const [planAi, setPlanAi] = React.useState<PlanAiState | null>(null)
  const [planDraft, setPlanDraft] = React.useState('')
  const [weeklyAi, setWeeklyAi] = React.useState<WeeklyAiState | null>(null)
  const [weeklyDraft, setWeeklyDraft] = React.useState('')

  if (sprintsQuery.isPending || tasksQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (sprintsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => sprintsQuery.refetch() }}
      />
    )
  }

  const sprints = sprintsQuery.data
  const tasks: Task[] = tasksQuery.data ?? []
  const active = sprints.filter((s) => s.status === 'active')
  const past = sprints.filter((s) => s.status !== 'active')

  function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    const range = defaultSprintRange(kind)
    createSprint.mutate(
      { kind, goal: goal.trim() || null, ...range },
      {
        onSuccess: () => {
          setOpen(false)
          setGoal('')
        },
        onError: () => toast(t('toast.saveError')),
      },
    )
  }

  function doRollover(sprint: Sprint) {
    const range = defaultSprintRange(sprint.kind)
    rollover.mutate(
      { id: sprint.id, input: { ...range, goal: sprint.goal } },
      {
        onSuccess: (result) =>
          toast(t('personal.sprints.rollover.toast', { count: result.movedTaskCount })),
        onError: () => toast(t('toast.saveError')),
      },
    )
  }

  function openTopLevelTasks(sprintId: string): Task[] {
    return tasks
      .filter((tk) => tk.sprintId === sprintId && tk.parentId === null && tk.doneAt === null)
      .sort((a, b) => a.sort - b.sort)
  }

  function runPlanAi(sprint: Sprint) {
    const bucket = openTopLevelTasks(sprint.id)
    if (bucket.length === 0) {
      toast(t('personal.ai.planSprint.emptyBucket'))
      return
    }
    setPlanAi({ sprintId: sprint.id, status: 'pending' })
    planSprint.mutate(
      {
        locale,
        sprintKind: sprint.kind,
        goal: sprint.goal,
        tasks: bucket.map((tk) => ({ title: tk.title, estimateMin: tk.estimateMin })),
      },
      {
        onSuccess: (res) => {
          const orderedTitles = Array.isArray(res.data['orderedTaskTitles'])
            ? (res.data['orderedTaskTitles'] as unknown[]).map(String)
            : bucket.map((tk) => tk.title)
          const focusTitle =
            typeof res.data['focusTaskTitle'] === 'string' ? res.data['focusTaskTitle'] : null
          const note = typeof res.data['scheduleNote'] === 'string' ? res.data['scheduleNote'] : ''
          setPlanAi({
            sprintId: sprint.id,
            status: 'ready',
            orderedTitles,
            focusTitle,
            note,
            costLine: aiCostLine(t, res.meta),
            editing: false,
          })
          setPlanDraft(orderedTitles.join('\n'))
        },
        onError: (err) =>
          setPlanAi({ sprintId: sprint.id, status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  function acceptPlanAi(sprint: Sprint) {
    if (planAi?.sprintId !== sprint.id || planAi.status !== 'ready') return
    const titles = planAi.editing
      ? planDraft
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : planAi.orderedTitles
    const pool = openTopLevelTasks(sprint.id)
    const used = new Set<string>()
    const orderedIds: string[] = []
    for (const title of titles) {
      const match = pool.find((tk) => !used.has(tk.id) && tk.title === title)
      if (match) {
        used.add(match.id)
        orderedIds.push(match.id)
      }
    }
    for (const tk of pool) if (!used.has(tk.id)) orderedIds.push(tk.id)
    reorderTasks.mutate(
      { items: orderedIds.map((id, sort) => ({ id, sort })) },
      { onError: () => toast(t('toast.saveError')) },
    )
    setPlanAi(null)
  }

  function runWeeklyAi() {
    const now = Date.now()
    const weekAgo = now - WEEK_MS
    const doneCards = tasks
      .filter((tk) => tk.doneAt !== null && new Date(tk.doneAt).getTime() >= weekAgo)
      .map((tk) => ({ id: tk.id, title: tk.title }))
    const newCards = tasks
      .filter((tk) => new Date(tk.createdAt).getTime() >= weekAgo)
      .map((tk) => ({ id: tk.id, title: tk.title }))
    const overdueCards = active
      .filter((s) => sprintHasEnded(s))
      .flatMap((s) => openTopLevelTasks(s.id))
      .map((tk) => ({ id: tk.id, title: tk.title }))

    setWeeklyAi({ status: 'pending' })
    weeklySummary.mutate(
      {
        locale,
        scope: 'person',
        subjectName: t('personal.ai.weeklySummary.subjectSelf'),
        periodLabel: t('personal.ai.weeklySummary.periodLabel'),
        doneCards,
        overdueCards,
        newCards,
      },
      {
        onSuccess: (res) => {
          const narrative = typeof res.data['narrative'] === 'string' ? res.data['narrative'] : ''
          setWeeklyAi({
            status: 'ready',
            narrative,
            costLine: aiCostLine(t, res.meta),
            editing: false,
          })
          setWeeklyDraft(narrative)
        },
        onError: (err) => setWeeklyAi({ status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  function acceptWeeklyAi() {
    if (weeklyAi?.status !== 'ready') return
    const text = weeklyAi.editing ? weeklyDraft.trim() : weeklyAi.narrative
    if (!text) {
      setWeeklyAi(null)
      return
    }
    createNote.mutate(
      { title: t('personal.ai.weeklySummary.noteTitle'), body: { text } },
      {
        onSuccess: () => toast(t('personal.ai.weeklySummary.savedToast')),
        onError: () => toast(t('toast.saveError')),
      },
    )
    setWeeklyAi(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-h3 text-foreground">{t('personal.sprints.active.title')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <SparkleButton
            aria-label={t('personal.ai.weeklySummary.action')}
            label={t('personal.ai.weeklySummary.action')}
            size="sm"
            loading={weeklyAi?.status === 'pending'}
            onClick={runWeeklyAi}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" aria-hidden="true" />
                {t('personal.sprints.create.action')}
              </Button>
            </DialogTrigger>
            <DialogContent title={t('personal.sprints.create.title')}>
              <form className="mt-4 flex flex-col gap-4" onSubmit={submitCreate}>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(SPRINT_KIND_LABEL_KEYS) as SprintKind[]).map((k) => (
                    <Button
                      key={k}
                      type="button"
                      size="sm"
                      variant={kind === k ? 'primary' : 'secondary'}
                      onClick={() => setKind(k)}
                    >
                      {t(SPRINT_KIND_LABEL_KEYS[k])}
                    </Button>
                  ))}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-small font-medium text-foreground">
                    {t('personal.sprints.goal')}
                  </span>
                  <Input
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder={t('personal.sprints.goalPlaceholder')}
                    maxLength={2000}
                  />
                </label>
                <Button type="submit" loading={createSprint.isPending}>
                  {t('personal.sprints.create.submit')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {weeklyAi ? (
        <Reveal>
          <AiPreviewPanel
            title={t('personal.ai.weeklySummary.title')}
            status={weeklyAi.status}
            pendingLabel={t('personal.ai.pending')}
            acceptLabel={t('personal.ai.weeklySummary.acceptLabel')}
            editLabel={t('personal.ai.edit')}
            discardLabel={t('personal.ai.discard')}
            {...(weeklyAi.status === 'error' ? { errorMessage: weeklyAi.message } : {})}
            {...(weeklyAi.status === 'ready' ? { costLine: weeklyAi.costLine } : {})}
            onAccept={acceptWeeklyAi}
            onDiscard={() => setWeeklyAi(null)}
            onEdit={() =>
              setWeeklyAi((prev) =>
                prev && prev.status === 'ready' ? { ...prev, editing: !prev.editing } : prev,
              )
            }
          >
            {weeklyAi.status === 'ready' ? (
              weeklyAi.editing ? (
                <Textarea
                  value={weeklyDraft}
                  onChange={(e) => setWeeklyDraft(e.target.value)}
                  rows={4}
                  aria-label={t('personal.ai.weeklySummary.editAria')}
                />
              ) : (
                <p>{weeklyAi.narrative}</p>
              )
            ) : null}
          </AiPreviewPanel>
        </Reveal>
      ) : null}

      {active.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="personal.sprints.empty.title"
          bodyKey="personal.sprints.empty.body"
          illustration={<EmptyPersonalIllustration />}
          action={{ labelKey: 'personal.sprints.create.action', onAction: () => setOpen(true) }}
        />
      ) : (
        <Stagger className="flex flex-col gap-3" as="ul">
          {active.map((sprint) => {
            const remainingMs = Math.max(0, new Date(sprint.endsAt).getTime() - Date.now())
            const ended = sprintHasEnded(sprint)
            const openCount = openTopLevelTasks(sprint.id).length
            return (
              <StaggerItem key={sprint.id} as="li">
                <Card padding="md" className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProgressRing
                        value={sprintElapsedPct(sprint)}
                        size={48}
                        strokeWidth={4}
                        label={t('personal.today.period.progressAria')}
                        toneClassName={ended ? 'text-attention' : 'text-primary'}
                      >
                        <Target className="size-4 text-primary" aria-hidden="true" />
                      </ProgressRing>
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="info">{t(SPRINT_KIND_LABEL_KEYS[sprint.kind])}</Badge>
                          <span className="text-caption tabular-nums text-muted-foreground">
                            {ended
                              ? t('personal.sprints.ended')
                              : t('personal.today.period.timeLeft', {
                                  value: formatTimeLeft(t, remainingMs),
                                })}
                          </span>
                        </div>
                        {sprint.goal ? (
                          <p className="truncate text-body text-foreground">{sprint.goal}</p>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-caption tabular-nums text-muted-foreground">
                      {t('personal.tasks.openCount', { count: openCount })}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <SparkleButton
                      aria-label={t('personal.ai.planSprint.action')}
                      label={t('personal.ai.planSprint.action')}
                      size="sm"
                      loading={planAi?.sprintId === sprint.id && planAi.status === 'pending'}
                      onClick={() => runPlanAi(sprint)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => doRollover(sprint)}
                      loading={rollover.isPending}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {t('personal.sprints.rollover.action')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        patchSprint.mutate({
                          id: sprint.id,
                          input: { status: 'completed', version: sprint.version },
                        })
                      }
                    >
                      {t('personal.sprints.complete.action')}
                    </Button>
                  </div>

                  {planAi?.sprintId === sprint.id ? (
                    <SprintPlanPanel
                      state={planAi}
                      draft={planDraft}
                      onDraftChange={setPlanDraft}
                      onAccept={() => acceptPlanAi(sprint)}
                      onDiscard={() => setPlanAi(null)}
                      onEditToggle={() =>
                        setPlanAi((prev) =>
                          prev && prev.status === 'ready'
                            ? { ...prev, editing: !prev.editing }
                            : prev,
                        )
                      }
                    />
                  ) : null}
                </Card>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}

      {past.length > 0 ? (
        <details className="text-body text-foreground">
          <summary className="cursor-pointer text-small font-medium text-muted-foreground">
            {t('personal.sprints.history.title', { count: past.length })}
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {past.map((sprint) => (
              <li
                key={sprint.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-small"
              >
                <span className="text-muted-foreground">
                  {t(SPRINT_KIND_LABEL_KEYS[sprint.kind])}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {sprint.goal ?? '—'}
                </span>
                <Badge tone={sprint.status === 'archived' ? 'neutral' : 'success'}>
                  {t(`personal.sprints.status.${sprint.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        {t('personal.ai.disclaimer')}
      </p>
    </div>
  )
}
