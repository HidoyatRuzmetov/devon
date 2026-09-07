// Today / focus view (TECH-SPEC §3.3): the sprint header (goal, progress ring, time left) for every
// active sprint, a rollover banner for one whose time has run out, then every not-done to-do across
// active sprints and the sprint-less "Inbox" in one flat, fast list -- quick-add (with an AI
// clean-up pass) and picking a to-do as the Pomodoro's linked task are both one step away.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Lock, Play, Plus, RotateCcw, Target, X } from 'lucide-react'
import {
  AiPreviewPanel,
  AllDoneIllustration,
  AnimatePresence,
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  EmptyPersonalIllustration,
  IconButton,
  Input,
  ProgressRing,
  Reveal,
  SparkleButton,
  Stagger,
  StaggerItem,
  StateView,
  toast,
  toastWithUndo,
  useReducedMotion,
} from '@devon/ui'
import { useQuickAddAi } from './lib/use-quick-add-ai.js'
import {
  SPRINT_KIND_LABEL_KEYS,
  defaultSprintRange,
  formatTimeLeft,
  sprintElapsedPct,
  sprintHasEnded,
} from './lib/sprint-labels.js'
import {
  useCreateTaskMutation,
  useDelayedDelete,
  usePatchTaskMutation,
  useRolloverSprintMutation,
  useSprintsQuery,
  useTasksQuery,
} from './use-personal.js'
import type { Sprint, Task } from './types.js'

const PRIVACY_NOTE_KEY = 'devon.personal.privacyNoteDismissed'

function PrivacyNote() {
  const t = useT()
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return window.localStorage.getItem(PRIVACY_NOTE_KEY) === '1'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  return (
    <Reveal>
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-4 py-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-small text-muted-foreground">
          {t('personal.privacy.note')}
        </p>
        <IconButton
          aria-label={t('personal.privacy.dismiss')}
          size="md"
          onClick={() => {
            setDismissed(true)
            try {
              window.localStorage.setItem(PRIVACY_NOTE_KEY, '1')
            } catch {
              // Storage disabled -- the note simply reappears next visit, which is harmless.
            }
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    </Reveal>
  )
}

function RolloverBanner({ sprint }: { sprint: Sprint }) {
  const t = useT()
  const rollover = useRolloverSprintMutation()
  return (
    <Reveal>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-attention/40 bg-attention/10 px-4 py-3">
        <Badge tone="warning">{t(SPRINT_KIND_LABEL_KEYS[sprint.kind])}</Badge>
        <p className="min-w-0 flex-1 text-small text-foreground">
          {sprint.goal
            ? t('personal.today.rollover.bannerGoal', { goal: sprint.goal })
            : t('personal.today.rollover.banner')}
        </p>
        <Button
          size="sm"
          loading={rollover.isPending}
          onClick={() => {
            const range = defaultSprintRange(sprint.kind)
            rollover.mutate(
              { id: sprint.id, input: { ...range, goal: sprint.goal } },
              {
                onSuccess: (result) =>
                  toast(t('personal.sprints.rollover.toast', { count: result.movedTaskCount })),
                onError: () => toast(t('toast.saveError')),
              },
            )
          }}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          {t('personal.sprints.rollover.action')}
        </Button>
      </div>
    </Reveal>
  )
}

function SprintHero({ sprint, taskCount }: { sprint: Sprint; taskCount: number }) {
  const t = useT()
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const pct = sprintElapsedPct(sprint)
  const remainingMs = Math.max(0, new Date(sprint.endsAt).getTime() - Date.now())

  return (
    <Card padding="md" className="flex items-center gap-4">
      <ProgressRing
        value={pct}
        size={56}
        strokeWidth={5}
        label={t('personal.today.period.progressAria')}
      >
        <Target className="size-4 text-primary" aria-hidden="true" />
      </ProgressRing>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* DESIGN.md §9.2: a tinted badge, not a solid one -- same treatment as the identical
              per-sprint chip in sprints-view.tsx and the "Hafta"/"Inbox" chips further down this
              same screen; a solid `info` fill on the one chip that repeats on every visit read as
              alarmingly loud next to everything else here. */}
          <Badge tone="neutral" className="bg-info/10 text-info">
            {t(SPRINT_KIND_LABEL_KEYS[sprint.kind])}
          </Badge>
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('personal.today.period.timeLeft', { value: formatTimeLeft(t, remainingMs) })}
          </span>
        </div>
        {sprint.goal ? (
          // DESIGN.md §5: nothing in the shell is ever ellipsized -- at 390 this used to `truncate`
          // to one line ("Bo'lim hisobo…"), and round1's `line-clamp-2` fix still cut a longer goal
          // after two lines ("Boʻlim hisobotlarini yakunlash va jam…", round2 SEV2). It now wraps in
          // full, at a smaller display size so it stays readable on a phone; the full `text-h3` size
          // returns once there is room for it (`sm:` breakpoint, 640px+).
          <p className="font-display text-lead text-foreground sm:text-h3">{sprint.goal}</p>
        ) : (
          <p className="text-body text-muted-foreground">{t('personal.today.period.noGoal')}</p>
        )}
      </div>
      <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-caption tabular-nums text-muted-foreground">
        {t('personal.tasks.openCount', { count: taskCount })}
      </span>
    </Card>
  )
}

export function TodayView({
  focusedTaskId,
  onFocusTask,
}: {
  focusedTaskId: string | null
  onFocusTask: (id: string | null) => void
}) {
  const t = useT()
  const locale = useLocale()
  const sprintsQuery = useSprintsQuery()
  const tasksQuery = useTasksQuery()
  const patchTask = usePatchTaskMutation()
  const createTask = useCreateTaskMutation()
  const quickAddAi = useQuickAddAi(t, locale)
  const reduced = useReducedMotion()

  // Completing a to-do used to remove its row on the very same tick the checkbox's own `celebrate`
  // animation (the check draw-in, the 12-particle burst) started -- verified live, the count went
  // 4 -> 3 and the row simply vanished, so the one designed moment of delight in this workspace was
  // never actually reachable, and the completion itself was irreversible. `justDoneIds` holds a task
  // checked but not yet removed, for exactly --dur-celebration (480ms, 0 under reduced motion) with
  // the strike-through applied; once that beat is up the row moves to `hiddenIds` (removed from view,
  // AnimatePresence animates it out) and the real mutation is *scheduled*, not sent -- `cancel()` from
  // the undo toast means the task was never actually touched, not un-done after the fact.
  const [justDoneIds, setJustDoneIds] = React.useState<ReadonlySet<string>>(new Set())
  const [hiddenIds, setHiddenIds] = React.useState<ReadonlySet<string>>(new Set())
  const tasksRef = React.useRef<readonly Task[]>([])
  const { schedule: scheduleCompletion, cancel: cancelCompletion } = useDelayedDelete(
    async (id) => {
      const task = tasksRef.current.find((tk) => tk.id === id)
      if (task) await patchTask.mutateAsync({ id, input: { done: true, version: task.version } })
    },
  )

  function toggleTaskDone(task: Task) {
    if (task.doneAt !== null) {
      // Un-checking an already-done task -- immediate, nothing to celebrate or undo here.
      patchTask.mutate({ id: task.id, input: { done: false, version: task.version } })
      return
    }
    setJustDoneIds((prev) => new Set(prev).add(task.id))
    window.setTimeout(
      () => {
        setJustDoneIds((prev) => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
        setHiddenIds((prev) => new Set(prev).add(task.id))
        scheduleCompletion(task.id)
        toastWithUndo({
          message: t('personal.today.tasks.completedToast'),
          undoLabel: t('action.undo'),
          onUndo: () => {
            cancelCompletion(task.id)
            setHiddenIds((prev) => {
              const next = new Set(prev)
              next.delete(task.id)
              return next
            })
          },
        })
      },
      reduced ? 0 : 480,
    )
  }

  const [quickAddText, setQuickAddText] = React.useState('')
  const quickAddInputRef = React.useRef<HTMLInputElement>(null)

  if (sprintsQuery.isPending || tasksQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (sprintsQuery.isError || tasksQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => {
            void sprintsQuery.refetch()
            void tasksQuery.refetch()
          },
        }}
      />
    )
  }

  const activeSprints = sprintsQuery.data.filter((s) => s.status === 'active')
  const ongoingSprints = activeSprints.filter((s) => !sprintHasEnded(s))
  const endedSprints = activeSprints.filter((s) => sprintHasEnded(s))
  const activeSprintIds = new Set(activeSprints.map((s) => s.id))
  const allTasks = tasksQuery.data
  tasksRef.current = allTasks
  const inScope = (task: Task) => task.sprintId === null || activeSprintIds.has(task.sprintId)
  const totalTasksInScope = allTasks.filter(inScope)
  const todaysTasks = totalTasksInScope
    .filter((task) => (task.doneAt === null && !hiddenIds.has(task.id)) || justDoneIds.has(task.id))
    .sort((a, b) => a.sort - b.sort)
  const targetSprintId = ongoingSprints[0]?.id ?? null

  function submitQuickAdd(title: string) {
    const trimmed = title.trim()
    if (!trimmed) return
    const siblingCount = allTasks.filter(
      (tk) => tk.sprintId === targetSprintId && tk.parentId === null,
    ).length
    createTask.mutate(
      { title: trimmed, sprintId: targetSprintId, sort: siblingCount },
      {
        onSuccess: () => {
          setQuickAddText('')
          quickAddAi.discard()
        },
        onError: () => toast(t('toast.saveError')),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PrivacyNote />

      {endedSprints.map((sprint) => (
        <RolloverBanner key={sprint.id} sprint={sprint} />
      ))}

      {ongoingSprints.length > 0 ? (
        <Stagger className="flex flex-col gap-3" as="section">
          {ongoingSprints.map((sprint) => (
            <StaggerItem key={sprint.id}>
              <SprintHero
                sprint={sprint}
                taskCount={
                  allTasks.filter((tk) => tk.sprintId === sprint.id && tk.doneAt === null).length
                }
              />
            </StaggerItem>
          ))}
        </Stagger>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-h3 text-foreground">{t('personal.today.tasks.title')}</h3>
          {totalTasksInScope.length > 0 ? (
            <span className="text-caption tabular-nums text-muted-foreground">
              {t('personal.today.tasks.remaining', { count: todaysTasks.length })}
            </span>
          ) : null}
        </div>

        {todaysTasks.length === 0 ? (
          totalTasksInScope.length > 0 ? (
            <Reveal className="flex flex-col items-center gap-3 rounded-md border border-border bg-card px-6 py-10 text-center">
              <AllDoneIllustration className="w-40 max-w-full text-illustration-ink" />
              <h3 className="font-display text-h3 text-foreground">
                {t('personal.today.allDone.title')}
              </h3>
              <p className="max-w-100 text-body text-muted-foreground">
                {t('personal.today.allDone.body')}
              </p>
            </Reveal>
          ) : (
            <StateView
              kind="empty"
              titleKey="personal.today.empty.title"
              bodyKey="personal.today.empty.body"
              illustration={<EmptyPersonalIllustration />}
            />
          )
        ) : (
          <Stagger
            as="ul"
            className="flex flex-col divide-y divide-border rounded-md border border-border"
          >
            {/* AnimatePresence, nested inside Stagger's own entrance orchestration: a completed row
                needs to hold, strike through, then animate *out* when it leaves this array -- without
                this, React just yanks it from the DOM the instant `todaysTasks` no longer includes
                it, which is exactly why the checkbox's own celebrate burst was never reachable. */}
            <AnimatePresence initial={false}>
              {todaysTasks.map((task) => {
                const sourceSprint = activeSprints.find((s) => s.id === task.sprintId)
                const justDone = justDoneIds.has(task.id)
                return (
                  <StaggerItem key={task.id} as="li" exit="hidden" layout>
                    {/* round2 SEV2: below 768 the title used to lose to the chips (`truncate` on a
                        flex item that also had to share the row with "Hafta"/estimate/Fokus) -- the
                        title is the content in a task list, so DESIGN.md §5 forbids ellipsizing it.
                        The row stacks (title, then its chips on their own line) below `md`, and stays
                        the single row it always was at `md` and up. */}
                    <div className="flex flex-col gap-1.5 px-3 py-2 transition-colors duration-(--dur-micro) hover:bg-accent/40 md:flex-row md:items-center md:gap-2">
                      <div className="flex items-start gap-2 md:min-w-0 md:flex-1 md:items-center">
                        <Checkbox
                          celebrate
                          checked={task.doneAt !== null || justDone}
                          onCheckedChange={() => toggleTaskDone(task)}
                          aria-label={t('personal.tasks.toggleDone')}
                          size="sm"
                          className="relative mt-0.5 shrink-0 md:mt-0"
                        />
                        <span
                          className={cn(
                            'min-w-0 flex-1 line-clamp-2 text-body text-foreground md:truncate md:line-clamp-none',
                            justDone && 'text-muted-foreground line-through',
                          )}
                        >
                          {task.title}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pl-7 md:shrink-0 md:pl-0">
                        {task.sprintId === null && (
                          <Badge tone="neutral">{t('personal.tasks.inbox')}</Badge>
                        )}
                        {task.sprintId !== null && sourceSprint && (
                          <Badge tone="neutral" className="bg-info/10 text-info">
                            {t(SPRINT_KIND_LABEL_KEYS[sourceSprint.kind])}
                          </Badge>
                        )}
                        {task.estimateMin ? (
                          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                            {task.estimateMin}′
                          </span>
                        ) : null}
                        <Button
                          size="sm"
                          variant={focusedTaskId === task.id ? 'primary' : 'ghost'}
                          disabled={justDone}
                          onClick={() => onFocusTask(focusedTaskId === task.id ? null : task.id)}
                        >
                          <Play className="size-3.5" aria-hidden="true" />
                          {t('personal.today.focus')}
                        </Button>
                      </div>
                    </div>
                  </StaggerItem>
                )
              })}
            </AnimatePresence>
          </Stagger>
        )}

        <form
          className="mt-1 flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault()
            submitQuickAdd(quickAddText)
          }}
        >
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={quickAddInputRef}
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            placeholder={t('personal.today.addPlaceholder')}
            className="h-8 border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
          />
          <SparkleButton
            aria-label={t('personal.ai.quickAdd.action')}
            size="sm"
            loading={quickAddAi.state?.status === 'pending'}
            disabled={!quickAddText.trim()}
            onClick={() => quickAddAi.run(quickAddText)}
          />
        </form>

        {quickAddAi.state ? (
          <Reveal>
            <AiPreviewPanel
              title={t('personal.ai.quickAdd.title')}
              status={quickAddAi.state.status}
              pendingLabel={t('personal.ai.pending')}
              acceptLabel={t('personal.ai.accept')}
              editLabel={t('personal.ai.edit')}
              discardLabel={t('personal.ai.discard')}
              {...(quickAddAi.state.status === 'error'
                ? { errorMessage: quickAddAi.state.message }
                : {})}
              {...(quickAddAi.state.status === 'ready'
                ? { costLine: quickAddAi.state.costLine }
                : {})}
              onAccept={() =>
                quickAddAi.state?.status === 'ready' && submitQuickAdd(quickAddAi.state.title)
              }
              onDiscard={quickAddAi.discard}
              onEdit={() => {
                if (quickAddAi.state?.status === 'ready') setQuickAddText(quickAddAi.state.title)
                quickAddAi.discard()
                requestAnimationFrame(() => quickAddInputRef.current?.focus())
              }}
            >
              {quickAddAi.state.status === 'ready' ? <p>{quickAddAi.state.title}</p> : null}
            </AiPreviewPanel>
          </Reveal>
        ) : null}
      </section>
    </div>
  )
}
