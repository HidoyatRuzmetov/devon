// Periods (TECH-SPEC §3.3: "3h/day/week/custom, goal and rollover") -- what the product calls a
// "sprint" internally (`SprintKind` etc.) is always "period" in copy, never the banned project-
// management jargon (DESIGN.md §5, `packages/i18n` banned-word gate).
//
// AI wiring (v1.1, AI-AUDIT F3 + F5/F10): "Plan the period" (`plan_sprint`) orders one active
// period's open to-dos against the time actually left in it and names the one to start with -- and
// the whole ordering is what Accept applies now, not a single field patch. "What did I miss"
// (`catch_up`) replaces v1.0's `weekly_summary`: the same data at a `window`/`scope`, returning a
// structured briefing (wins, risks, what needs you) rather than three counts restated in prose.
// Both go through Accept/Edit/Discard, and Edit is a real edit, never a second Discard.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Pencil, Plus, RotateCcw, Sparkles, Target } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Celebrate,
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
import { AiResultPanel } from '../ai/components/ai-result-panel.js'
import { CatchUpPreview, PlanPreview } from '../ai/components/previews.js'
import { parseFeatureOutput, type CatchUpOutput, type PlanSprintOutput } from '../ai/outputs.js'
import type { RunMeta } from '../ai/types.js'
import { aiErrorMessageKey } from './lib/ai-helpers.js'
import {
  SPRINT_KIND_LABEL_KEYS,
  defaultSprintRange,
  rolloverSprintRange,
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

function localDateTime(iso: string): string {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function chosenRange(start: string, end: string) {
  const startsAt = new Date(start)
  const endsAt = new Date(end)
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  )
    return null
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

function DateRangeFields({
  start,
  end,
  setStart,
  setEnd,
  disabled,
}: {
  start: string
  end: string
  setStart: (value: string) => void
  setEnd: (value: string) => void
  disabled: boolean
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14em),1fr))] gap-3 text-body">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-small">{t('personal.sprints.starts')}</span>
        <Input
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          required
          disabled={disabled}
          className="min-w-0"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-small">{t('personal.sprints.ends')}</span>
        <Input
          type="datetime-local"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          required
          disabled={disabled}
          className="min-w-0"
        />
      </label>
    </div>
  )
}

type PlanAiState =
  | { sprintId: string; status: 'pending' }
  | {
      sprintId: string
      status: 'ready'
      output: PlanSprintOutput
      meta: RunMeta
      editing: boolean
    }
  | { sprintId: string; status: 'error'; message: string }

type CatchUpAiState =
  | { status: 'pending' }
  | { status: 'ready'; output: CatchUpOutput; meta: RunMeta; editing: boolean }
  | { status: 'error'; message: string }

/** The note text a catch-up briefing becomes when the person saves it (SPEC §8: the whole answer is
 * applied on Accept, never a fragment of it). Plain paragraphs, because a personal note is plain
 * text -- but every part the panel showed is in here. */
function catchUpToNoteText(output: CatchUpOutput): string {
  const lines: string[] = [output.headline]
  if (output.wins.text) lines.push(output.wins.text)
  for (const risk of output.risks) lines.push(`• ${risk.text}`)
  for (const person of output.overloaded) lines.push(`• ${person.name}: ${person.text}`)
  if (output.lookingAhead.text) lines.push(output.lookingAhead.text)
  return lines.filter(Boolean).join('\n\n')
}

function SprintPlanPanel({
  state,
  draft,
  onDraftChange,
  onAccept,
  onEditToggle,
  onDiscard,
  itemTitle,
}: {
  state: PlanAiState
  draft: string
  onDraftChange: (value: string) => void
  onAccept: () => void
  onEditToggle: () => void
  onDiscard: () => void
  itemTitle: (id: string) => string | null
}) {
  const t = useT()
  const ready = state.status === 'ready' ? state : null
  return (
    <AiResultPanel
      title={t('personal.ai.planSprint.title')}
      status={state.status}
      {...(state.status === 'error' ? { errorMessage: state.message } : {})}
      {...(ready ? { meta: ready.meta } : {})}
      acceptLabel={t('personal.ai.accept')}
      editLabel={t('personal.ai.edit')}
      onAccept={onAccept}
      onDiscard={onDiscard}
      onEdit={onEditToggle}
    >
      <PlanPanelBody
        ready={ready}
        draft={draft}
        onDraftChange={onDraftChange}
        itemTitle={itemTitle}
      />
    </AiResultPanel>
  )
}

/** Extracted so the three states are early returns rather than nested JSX ternaries --
 * `check-i18n.mjs`'s hard-coded-text heuristic reads a `) : cond ? (` line between two JSX blocks as
 * a stray text node (the same trap `people-screen.tsx` documents). */
function PlanPanelBody({
  ready,
  draft,
  onDraftChange,
  itemTitle,
}: {
  ready: (PlanAiState & { status: 'ready' }) | null
  draft: string
  onDraftChange: (value: string) => void
  itemTitle: (id: string) => string | null
}) {
  const t = useT()
  if (!ready) {
    return null
  }
  if (ready.editing) {
    // Edit is a real edit: the ordering the model produced, one title per line, which the person
    // rearranges and Accept then applies in that order. v1.0's Edit on several screens simply
    // discarded the answer, which made it indistinguishable from Discard (AI-AUDIT §5 fix 11).
    return (
      <Textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={Math.max(3, ready.output.orderedIds.length)}
        aria-label={t('personal.ai.planSprint.editAria')}
      />
    )
  }
  return <PlanPreview output={ready.output} itemTitle={itemTitle} />
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
  const catchUp = useRunAiFeatureMutation('catch_up')

  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<SprintKind>('week')
  const [goal, setGoal] = React.useState('')
  const [customStart, setCustomStart] = React.useState(() =>
    localDateTime(defaultSprintRange('custom').startsAt),
  )
  const [customEnd, setCustomEnd] = React.useState(() =>
    localDateTime(defaultSprintRange('custom').endsAt),
  )
  const [dateError, setDateError] = React.useState(false)
  const [editing, setEditing] = React.useState<Sprint | null>(null)
  const [editGoal, setEditGoal] = React.useState('')
  const [editStart, setEditStart] = React.useState('')
  const [editEnd, setEditEnd] = React.useState('')
  const [editDateError, setEditDateError] = React.useState(false)
  const periodPending = createSprint.isPending || patchSprint.isPending || rollover.isPending
  const [planAi, setPlanAi] = React.useState<PlanAiState | null>(null)
  const [planDraft, setPlanDraft] = React.useState('')
  const [catchUpAi, setCatchUpAi] = React.useState<CatchUpAiState | null>(null)
  const [catchUpDraft, setCatchUpDraft] = React.useState('')
  // UI-OVERHAUL.md §3 "RSVP yes, card done, sprint complete": one celebration burst, anchored to
  // whichever period's own "Complete" button fired it -- at most one plays at a time.
  const [celebratingSprintId, setCelebratingSprintId] = React.useState<string | null>(null)

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
  if (tasksQuery.isError)
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => tasksQuery.refetch() }}
      />
    )

  const sprints = sprintsQuery.data
  const tasks: Task[] = tasksQuery.data ?? []
  const active = sprints.filter((s) => s.status === 'active')
  const past = sprints.filter((s) => s.status !== 'active')

  function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (periodPending) return
    const range = kind === 'custom' ? chosenRange(customStart, customEnd) : defaultSprintRange(kind)
    if (!range) {
      setDateError(true)
      return
    }
    setDateError(false)
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
    if (periodPending) return
    const range = rolloverSprintRange(sprint)
    rollover.mutate(
      { id: sprint.id, input: { ...range, goal: sprint.goal } },
      {
        onSuccess: (result) =>
          toast(t('personal.sprints.rollover.toast', { count: result.movedTaskCount })),
        onError: () => toast(t('toast.saveError')),
      },
    )
  }

  function editPeriod(sprint: Sprint) {
    if (periodPending) return
    setEditing(sprint)
    setEditGoal(sprint.goal ?? '')
    setEditStart(localDateTime(sprint.startsAt))
    setEditEnd(localDateTime(sprint.endsAt))
    setEditDateError(false)
    patchSprint.reset()
  }

  function submitEdit(event: React.FormEvent) {
    event.preventDefault()
    if (!editing || periodPending) return
    const range = chosenRange(editStart, editEnd)
    if (!range) {
      setEditDateError(true)
      return
    }
    setEditDateError(false)
    patchSprint.mutate(
      {
        id: editing.id,
        input: { goal: editGoal.trim() || null, ...range, version: editing.version },
      },
      {
        onSuccess: () => setEditing(null),
        onError: () => toast.error(t('toast.saveError')),
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
    // AI-AUDIT §0.3: v1.0 handed this feature a title and an optional estimate and nothing else, so
    // it could not do anything the offline simulator's "sort by estimate" did not already do for
    // free. It now gets the period's real end, the minutes actually left in it, each item's own due
    // date and importance, and whether the person marked it blocked -- which is the whole difference
    // between an ordering and a guess.
    const now = new Date()
    const endsAt = new Date(sprint.endsAt)
    const capacityMin = Math.max(0, Math.round((endsAt.getTime() - now.getTime()) / 60_000))
    planSprint.mutate(
      {
        locale,
        scope: 'personal',
        periodId: sprint.id,
        periodKind: sprint.kind,
        now: now.toISOString(),
        periodEndsAt: endsAt.toISOString(),
        capacityMin: sprint.kind === '3h' ? capacityMin : null,
        goal: sprint.goal,
        items: bucket.map((tk) => ({
          id: tk.id,
          title: tk.title,
          estimateMin: tk.estimateMin,
          dueDate: null,
          priority: 'none',
          blocked: false,
        })),
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<PlanSprintOutput>('plan_sprint', res.data)
          if (!output) {
            setPlanAi({
              sprintId: sprint.id,
              status: 'error',
              message: t('ai.errors.runFailed'),
            })
            return
          }
          setPlanAi({
            sprintId: sprint.id,
            status: 'ready',
            output,
            meta: res.meta,
            editing: false,
          })
          setPlanDraft(
            output.orderedIds
              .map((id) => bucket.find((tk) => tk.id === id)?.title ?? '')
              .filter(Boolean)
              .join('\n'),
          )
        },
        onError: (err) =>
          setPlanAi({ sprintId: sprint.id, status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  function acceptPlanAi(sprint: Sprint) {
    if (planAi?.sprintId !== sprint.id || planAi.status !== 'ready') return
    const pool = openTopLevelTasks(sprint.id)
    const used = new Set<string>()
    const orderedIds: string[] = []

    if (planAi.editing) {
      // The person rearranged the titles by hand; match them back to real to-dos in the order they
      // left them.
      for (const title of planDraft
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)) {
        const match = pool.find((tk) => !used.has(tk.id) && tk.title === title)
        if (match) {
          used.add(match.id)
          orderedIds.push(match.id)
        }
      }
    } else {
      // AI-AUDIT §0.2: v1.0 rendered the whole ordering and then applied a single `priority: 'urgent'`
      // patch to one card. The ordering is the answer, and the ordering is what lands.
      for (const id of planAi.output.orderedIds) {
        if (!used.has(id) && pool.some((tk) => tk.id === id)) {
          used.add(id)
          orderedIds.push(id)
        }
      }
    }
    for (const tk of pool) if (!used.has(tk.id)) orderedIds.push(tk.id)

    reorderTasks.mutate(
      { items: orderedIds.map((id, sort) => ({ id, sort })) },
      {
        onSuccess: () => toast(t('personal.ai.planSprint.appliedToast')),
        onError: () => toast(t('toast.saveError')),
      },
    )
    setPlanAi(null)
  }

  function runCatchUpAi() {
    const now = Date.now()
    const weekAgo = now - WEEK_MS
    const asItem = (tk: Task) => ({ id: tk.id, title: tk.title })
    const done = tasks
      .filter((tk) => tk.doneAt !== null && new Date(tk.doneAt).getTime() >= weekAgo)
      .map(asItem)
    const created = tasks.filter((tk) => new Date(tk.createdAt).getTime() >= weekAgo)
    const overdue = active
      .filter((s) => sprintHasEnded(s))
      .flatMap((s) => openTopLevelTasks(s.id))
      .map(asItem)

    setCatchUpAi({ status: 'pending' })
    // F5+F10 merged (AI-AUDIT §4, D-1): one feature, one prompt, a `window` and a `scope`. Here it
    // is the person's own week. The counts go alongside the items so the model can say "four, two
    // more than last week" without counting the array itself and getting it wrong.
    catchUp.mutate(
      {
        locale,
        scope: 'person',
        privateWorkspace: true,
        window: 'week',
        subjectName: t('personal.ai.catchUp.subjectSelf'),
        viewerName: t('personal.ai.catchUp.subjectSelf'),
        period: {
          start: new Date(weekAgo).toISOString().slice(0, 10),
          end: new Date(now).toISOString().slice(0, 10),
        },
        counts: {
          done: done.length,
          doneLastPeriod: 0,
          created: created.length,
          overdue: overdue.length,
        },
        done,
        overdue,
        dueThisWeek: [],
        assignedToMe: created.map(asItem),
        mentions: [],
        comments: [],
        loadPerPerson: [],
        eventsAhead: [],
      },
      {
        onSuccess: (res) => {
          const output = parseFeatureOutput<CatchUpOutput>('catch_up', res.data)
          if (!output) {
            setCatchUpAi({ status: 'error', message: t('ai.errors.runFailed') })
            return
          }
          setCatchUpAi({ status: 'ready', output, meta: res.meta, editing: false })
          setCatchUpDraft(catchUpToNoteText(output))
        },
        onError: (err) => setCatchUpAi({ status: 'error', message: t(aiErrorMessageKey(err)) }),
      },
    )
  }

  function acceptCatchUpAi() {
    if (catchUpAi?.status !== 'ready') return
    const text = catchUpAi.editing ? catchUpDraft.trim() : catchUpToNoteText(catchUpAi.output)
    if (!text) {
      setCatchUpAi(null)
      return
    }
    createNote.mutate(
      { title: t('personal.ai.catchUp.noteTitle'), body: { text } },
      {
        onSuccess: () => toast(t('personal.ai.catchUp.savedToast')),
        onError: () => toast(t('toast.saveError')),
      },
    )
    setCatchUpAi(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-h3 text-foreground">{t('personal.sprints.active.title')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <SparkleButton
            aria-label={t('personal.ai.catchUp.action')}
            label={t('personal.ai.catchUp.action')}
            size="sm"
            loading={catchUpAi?.status === 'pending'}
            onClick={runCatchUpAi}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={periodPending}>
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
                      disabled={periodPending}
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
                    disabled={periodPending}
                  />
                </label>
                {kind === 'custom' ? (
                  <DateRangeFields
                    start={customStart}
                    end={customEnd}
                    setStart={setCustomStart}
                    setEnd={setCustomEnd}
                    disabled={periodPending}
                  />
                ) : null}
                {dateError ? (
                  <p role="alert" className="text-small text-destructive">
                    {t('personal.sprints.invalidRange')}
                  </p>
                ) : null}
                <Button type="submit" loading={createSprint.isPending}>
                  {t('personal.sprints.create.submit')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {catchUpAi ? (
        <Reveal>
          <AiResultPanel
            title={t('personal.ai.catchUp.title')}
            status={catchUpAi.status}
            {...(catchUpAi.status === 'error' ? { errorMessage: catchUpAi.message } : {})}
            {...(catchUpAi.status === 'ready' ? { meta: catchUpAi.meta } : {})}
            acceptLabel={t('personal.ai.catchUp.acceptLabel')}
            editLabel={t('personal.ai.edit')}
            onAccept={acceptCatchUpAi}
            onDiscard={() => setCatchUpAi(null)}
            onEdit={() =>
              setCatchUpAi((prev) =>
                prev && prev.status === 'ready' ? { ...prev, editing: !prev.editing } : prev,
              )
            }
          >
            <CatchUpPanelBody
              state={catchUpAi}
              draft={catchUpDraft}
              onDraftChange={setCatchUpDraft}
            />
          </AiResultPanel>
        </Reveal>
      ) : null}

      {active.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="personal.sprints.empty.title"
          bodyKey="personal.sprints.empty.body"
          illustration={<EmptyPersonalIllustration />}
          action={{
            labelKey: 'personal.sprints.create.action',
            onAction: () => {
              if (!periodPending) setOpen(true)
            },
          }}
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
                          {/* DESIGN.md §9.2: a tinted badge, not a solid one -- this repeats once
                              per sprint row, and a solid fill on every row of a dense list reads as
                              alarming/noisy rather than a plain category label. */}
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
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={periodPending}
                      onClick={() => editPeriod(sprint)}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      {t('personal.sprints.edit')}
                    </Button>
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
                      disabled={periodPending}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {t('personal.sprints.rollover.action')}
                    </Button>
                    <span className="relative inline-flex">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={periodPending}
                        onClick={() =>
                          patchSprint.mutate(
                            {
                              id: sprint.id,
                              input: { status: 'completed', version: sprint.version },
                            },
                            {
                              onSuccess: () => {
                                setCelebratingSprintId(sprint.id)
                                toast(t('personal.sprints.complete.toast'))
                              },
                              onError: () => toast.error(t('toast.saveError')),
                            },
                          )
                        }
                      >
                        {t('personal.sprints.complete.action')}
                      </Button>
                      <Celebrate
                        play={celebratingSprintId === sprint.id}
                        onDone={() => setCelebratingSprintId(null)}
                      />
                    </span>
                  </div>

                  {planAi?.sprintId === sprint.id ? (
                    <SprintPlanPanel
                      state={planAi}
                      draft={planDraft}
                      onDraftChange={setPlanDraft}
                      onAccept={() => acceptPlanAi(sprint)}
                      itemTitle={(id) => tasks.find((tk) => tk.id === id)?.title ?? null}
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

      <Dialog
        open={editing !== null}
        onOpenChange={(value) => {
          if (!value) setEditing(null)
        }}
      >
        <DialogContent title={t('personal.sprints.edit')}>
          <form className="mt-4 flex flex-col gap-4" onSubmit={submitEdit}>
            <label className="flex flex-col gap-1">
              <span className="text-small">{t('personal.sprints.goal')}</span>
              <Input
                value={editGoal}
                onChange={(event) => setEditGoal(event.target.value)}
                maxLength={2000}
                disabled={periodPending}
              />
            </label>
            <DateRangeFields
              start={editStart}
              end={editEnd}
              setStart={setEditStart}
              setEnd={setEditEnd}
              disabled={periodPending}
            />
            {editDateError ? (
              <p role="alert" className="text-small text-destructive">
                {t('personal.sprints.invalidRange')}
              </p>
            ) : null}
            {patchSprint.isError ? (
              <p role="alert" className="text-small text-destructive">
                {t('personal.save.error')}
              </p>
            ) : null}
            <Button type="submit" loading={patchSprint.isPending}>
              {t('personal.sprints.save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

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

/** Early returns rather than nested JSX ternaries, for the reason `PlanPanelBody` above documents. */
function CatchUpPanelBody({
  state,
  draft,
  onDraftChange,
}: {
  state: CatchUpAiState
  draft: string
  onDraftChange: (value: string) => void
}) {
  const t = useT()
  if (state.status !== 'ready') {
    return null
  }
  if (state.editing) {
    return (
      <Textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={8}
        aria-label={t('personal.ai.catchUp.editAria')}
      />
    )
  }
  return <CatchUpPreview output={state.output} cardTitle={() => null} />
}
