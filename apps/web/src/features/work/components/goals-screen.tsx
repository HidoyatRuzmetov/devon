// v1.1 SPEC §7 (A11) -- department goals.
//
// A goal here never asks anybody to report a number by hand. Its target is bound to a filter over
// cards the department already has, and its progress is recomputed on every read from those cards --
// which is precisely why ClickUp's own Goals get abandoned (CLICKUP-RESEARCH §5: a goal that needs
// weekly manual updating stops being updated, and then lies). `currentValue`, `progress` and
// `matchedCards` all arrive computed; this screen renders them and never does the arithmetic itself.
//
// Head-only throughout. SPEC §2.2 puts `goals.read` on `department_managed` and migration 0905's
// `goals_read` policy agrees, so a member is refused at both boundaries -- which means this screen
// must show them the designed no-permission state rather than firing a request that comes back 403
// and rendering "Maʼlumotlarni yuklab boʻlmadi" (seen live as demo.xodim before this guard).
import * as React from 'react'
import { AnimatePresence } from 'motion/react'
import { Loader2, Plus, Target, Trash2 } from 'lucide-react'
import type { GoalMetric } from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Button,
  Chip,
  Dialog,
  DialogContent,
  Field,
  IconButton,
  Input,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  Textarea,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { useDepartment } from '../../../lib/session.js'
import { useCreateGoalMutation, useDeleteGoalMutation, useGoalsQuery } from '../hooks-plus.js'
import {
  GOAL_METRIC_LABEL_KEYS,
  goalProgress,
  goalProgressTone,
  isCeilingMetric,
} from '../lib/goal-format.js'
import type { Goal } from '../api-plus.js'

const METRICS: readonly GoalMetric[] = [
  'cards_done',
  'on_time_rate',
  'estimate_hours',
  'open_cards_max',
]

const METRIC_HINT_KEY: Record<GoalMetric, string> = {
  cards_done: 'work.goals.metricHint.cardsDone',
  on_time_rate: 'work.goals.metricHint.onTimeRate',
  estimate_hours: 'work.goals.metricHint.estimateHours',
  open_cards_max: 'work.goals.metricHint.openCardsMax',
}

export function GoalCard({
  goal,
  canManage,
  onDelete,
  busy,
}: {
  goal: Goal
  canManage: boolean
  onDelete: () => void
  busy: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const ratio = goalProgress(goal.metric, goal.currentValue, goal.targetValue)
  const ceiling = isCeilingMetric(goal.metric)

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-medium text-foreground">{goal.title}</h3>
          <p className="text-caption text-muted-foreground">{t(GOAL_METRIC_LABEL_KEYS[goal.metric])}</p>
        </div>
        {canManage ? (
          <IconButton
            aria-label={t('work.goals.delete', { title: goal.title })}
            onClick={onDelete}
            disabled={busy}
            className="shrink-0"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
          </IconButton>
        ) : null}
      </div>

      {goal.description ? (
        <p className="text-small text-muted-foreground">{goal.description}</p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-h4 font-semibold tabular-nums text-foreground">
            {/* A ceiling goal reads "10 dan 4 ta", not "4 / 10" -- the sentence is different because
                the direction is. */}
            {ceiling
              ? t('work.goals.ceilingValue', {
                  current: goal.currentValue,
                  target: goal.targetValue,
                })
              : t('work.goals.value', { current: goal.currentValue, target: goal.targetValue })}
          </span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {Math.round(ratio * 100)}%
          </span>
        </div>
        <Progress
          value={Math.round(ratio * 100)}
          label={t('work.goals.progressLabel', { title: goal.title })}
          tone={goalProgressTone(goal.metric, goal.currentValue, goal.targetValue)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {goal.filter ? <Chip tone="outline">{goal.filter}</Chip> : null}
        {/* A goal with nothing behind it says so, instead of showing a confident flat 0 %. */}
        {goal.matchedCards === 0 ? (
          <Chip tone="attention">{t('work.goals.noMatchingWork')}</Chip>
        ) : (
          <span className="text-caption text-muted-foreground">
            {t('work.goals.matchedCards', { count: goal.matchedCards })}
          </span>
        )}
        {goal.dueOn ? (
          <span className="ml-auto text-caption tabular-nums text-muted-foreground">
            {t('work.goals.dueOn', { date: formatDate(new Date(goal.dueOn), locale) })}
          </span>
        ) : null}
      </div>
    </article>
  )
}

function NewGoalDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const createGoal = useCreateGoalMutation()
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [metric, setMetric] = React.useState<GoalMetric>('cards_done')
  const [filter, setFilter] = React.useState('')
  const [target, setTarget] = React.useState('10')
  const [dueOn, setDueOn] = React.useState('')

  function reset(): void {
    setTitle('')
    setDescription('')
    setMetric('cards_done')
    setFilter('')
    setTarget('10')
    setDueOn('')
  }

  const targetValue = Number(target)
  const valid = title.trim().length > 0 && Number.isFinite(targetValue) && targetValue >= 0

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    if (!valid) return
    createGoal.mutate(
      {
        title: title.trim(),
        metric,
        targetValue,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(filter.trim() ? { filter: filter.trim() } : {}),
        ...(dueOn ? { dueOn } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t('work.goals.created'))
          reset()
          onOpenChange(false)
        },
        onError: () => toast.error(t('work.goals.createFailed')),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('work.goals.newTitle')} className="max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t('work.goals.fieldTitle')} htmlFor="goal-title">
            <Input
              id="goal-title"
              value={title}
              maxLength={160}
              required
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('work.goals.fieldTitlePlaceholder')}
            />
          </Field>

          <Field label={t('work.goals.fieldDescription')} htmlFor="goal-description">
            <Textarea
              id="goal-description"
              value={description}
              maxLength={1000}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field
            label={t('work.goals.fieldMetric')}
            htmlFor="goal-metric"
            hint={t(METRIC_HINT_KEY[metric])}
          >
            <Select
              id="goal-metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as GoalMetric)}
              options={METRICS.map((m) => ({ value: m, label: t(GOAL_METRIC_LABEL_KEYS[m]) }))}
            />
          </Field>

          <Field
            label={t('work.goals.fieldTarget')}
            htmlFor="goal-target"
            hint={t('work.goals.fieldTargetHint')}
          >
            <Input
              id="goal-target"
              type="number"
              min={0}
              inputMode="numeric"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>

          <Field
            label={t('work.goals.fieldFilter')}
            htmlFor="goal-filter"
            hint={t('work.goals.fieldFilterHint')}
          >
            <Input
              id="goal-filter"
              value={filter}
              maxLength={500}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('work.goals.fieldFilterPlaceholder')}
            />
          </Field>

          <Field label={t('work.goals.fieldDueOn')} htmlFor="goal-due">
            <Input
              id="goal-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!valid} loading={createGoal.isPending}>
              {t('work.goals.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function GoalsScreen(): React.JSX.Element {
  const t = useT()
  const { department } = useDepartment()
  const isHead = department?.role === 'head'
  // Gated on `isHead`, so a member issues no request at all.
  const query = useGoalsQuery(isHead)
  const deleteGoal = useDeleteGoalMutation()
  const createGoal = useCreateGoalMutation()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)

  const goals = (query.data ?? []).filter((goal) => goal.archivedAt === null)

  function remove(goal: Goal): void {
    setPending(goal.id)
    deleteGoal.mutate(goal.id, {
      onSettled: () => setPending(null),
      onSuccess: () => {
        // Undo over confirm: deleting recreates from the values we still hold, rather than asking
        // first. The recreated goal gets a new id, which is honest -- its progress is recomputed
        // from the same filter either way.
        toastWithUndo({
          message: t('work.goals.deleted', { title: goal.title }),
          undoLabel: t('action.undo'),
          onUndo: () =>
            createGoal.mutate({
              title: goal.title,
              metric: goal.metric,
              targetValue: goal.targetValue,
              ...(goal.description ? { description: goal.description } : {}),
              ...(goal.filter ? { filter: goal.filter } : {}),
              ...(goal.startsOn ? { startsOn: goal.startsOn } : {}),
              ...(goal.dueOn ? { dueOn: goal.dueOn } : {}),
            }),
        })
      },
      onError: () => toast.error(t('work.goals.deleteFailed')),
    })
  }

  let body: React.ReactNode
  if (!isHead) {
    body = (
      <StateView
        kind="forbidden"
        titleKey="work.goals.forbiddenTitle"
        bodyKey="work.goals.forbiddenBody"
      />
    )
  } else if (query.isPending) {
    body = (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    )
  } else if (query.isError) {
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  } else if (goals.length === 0) {
    body = (
      <StateView
        kind="empty"
        titleKey="work.goals.emptyTitle"
        bodyKey="work.goals.emptyBodyHead"
        action={{ labelKey: 'work.goals.create', onAction: () => setDialogOpen(true) }}
      />
    )
  } else {
    body = (
      <AnimatePresence initial={false}>
        <Stagger
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          animateKey={`goals-${goals.length}`}
        >
          {goals.map((goal) => (
            <StaggerItem key={goal.id} exit="hidden" layout className="h-full">
              <GoalCard
                goal={goal}
                canManage={isHead}
                busy={pending === goal.id}
                onDelete={() => remove(goal)}
              />
            </StaggerItem>
          ))}
        </Stagger>
      </AnimatePresence>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={t('work.eyebrow')}
        title={t('work.goals.title')}
        description={t('work.goals.description')}
        actions={
          isHead ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('work.goals.create')}
            </Button>
          ) : null
        }
      />
      {body}
      {isHead ? <NewGoalDialog open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
    </div>
  )
}
