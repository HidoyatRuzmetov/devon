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
import { AlertTriangle, ArrowUpRight, Loader2, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import type { GoalMetric } from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Button,
  Celebrate,
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
  StatNumber,
  Textarea,
  toast,
  toastWithUndo,
  useCelebrate,
} from '@devon/ui'
import { useDepartment } from '../../../lib/session.js'
import { navigate } from '../../../lib/router.js'
import {
  useCreateGoalMutation,
  useDeleteGoalMutation,
  useGoalsQuery,
  usePatchGoalMutation,
} from '../hooks-plus.js'
import {
  GOAL_METRIC_LABEL_KEYS,
  goalBarFill,
  goalCardsHref,
  goalProgress,
  goalProgressTone,
  isCeilingMetric,
  isPercentMetric,
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

/**
 * v1.1 critique SEV2 #8 -- "goals are posters, not targets, and two of the three render wrong".
 *
 * Four things changed, and they are four different bugs that happened to share a card:
 *
 *   1. **A percentage is not a fraction.** `on_time_rate` rendered as "98 / 85". It now reads
 *      "98% (maqsad: 85%)" -- the value, then what it is being measured against, both as percentages.
 *   2. **A cap is not a countdown.** `open_cards_max` drew a red bar at 22%, because the achievement
 *      ratio of a ceiling goal is inverted (1 - 78/100). The bar now fills *towards* the cap and is
 *      green while there is room -- see `goal-format.ts`'s `goalBarFill`.
 *   3. **The only control was a trash icon.** A head could delete a goal they had written and retype
 *      it, and nothing else. There is now Edit, and a click-through to the cards the goal actually
 *      counts (`/work/table` narrowed by the goal's own filter), which is the question a head asks
 *      the moment a bar looks wrong.
 *   4. **Titles truncated mid-word** ("…dan past tus…") above an empty row. They wrap now, and the
 *      card grows to fit.
 *
 * SEV2 #12 as well: `NumberFlow` on the figure, so a goal that moves is visibly a goal that moved.
 */
export function GoalCard({
  goal,
  canManage,
  onDelete,
  onEdit,
  busy,
}: {
  goal: Goal
  canManage: boolean
  onDelete: () => void
  onEdit?: (() => void) | undefined
  busy: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const ratio = goalProgress(goal.metric, goal.currentValue, goal.targetValue)
  const fill = goalBarFill(goal.metric, goal.currentValue, goal.targetValue)
  // A goal's progress is recomputed from the department's own cards on every read, so "reached"
  // arrives on a refetch rather than on a click -- which is exactly why it needs a moment of its
  // own: without one, the single most satisfying number in the product changes while nobody is
  // looking at it. The burst fires on the *crossing* only, never on a card that was already
  // complete when it mounted.
  const reached = ratio >= 1
  const reachedCelebrate = useCelebrate()
  const wasReached = React.useRef<boolean | null>(null)
  React.useEffect(() => {
    if (wasReached.current !== null && reached && !wasReached.current) reachedCelebrate.fire()
    wasReached.current = reached
  }, [reached, reachedCelebrate])
  const ceiling = isCeilingMetric(goal.metric)
  const percent = isPercentMetric(goal.metric)
  const overCap = ceiling && goal.targetValue > 0 && goal.currentValue > goal.targetValue

  return (
    <article className="flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {/* SEV2 #8: wraps rather than truncating. DESIGN.md §3.5's anti-truncation contract --
              the fix for a long label is a taller card, never a clipped word. */}
          <h3 className="text-pretty break-words text-body font-medium text-foreground">
            {goal.title}
          </h3>
          <p className="text-caption text-muted-foreground">
            {t(GOAL_METRIC_LABEL_KEYS[goal.metric])}
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {onEdit ? (
              <IconButton aria-label={t('work.goals.edit', { title: goal.title })} onClick={onEdit}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            <IconButton
              aria-label={t('work.goals.delete', { title: goal.title })}
              onClick={onDelete}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
            </IconButton>
          </div>
        ) : null}
      </div>

      {goal.description ? (
        <p className="text-small text-muted-foreground">{goal.description}</p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <span className="text-h4 font-semibold tabular-nums text-foreground">
            {/* Three different sentences, because these are three different kinds of target.
                A percentage: "98% (maqsad: 85%)". A ceiling: "100 dan 78 ta". A count: "82 / 120". */}
            {percent ? (
              <>
                <StatNumber value={goal.currentValue} locale={locale} suffix="%" />
                <span className="ml-1.5 text-small font-normal text-muted-foreground">
                  {t('work.goals.percentTarget', { target: goal.targetValue })}
                </span>
              </>
            ) : ceiling ? (
              t('work.goals.ceilingValue', {
                current: goal.currentValue,
                target: goal.targetValue,
              })
            ) : (
              t('work.goals.value', { current: goal.currentValue, target: goal.targetValue })
            )}
          </span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {/* For a ceiling goal the honest caption is how much of the cap is used, which is what
                the bar shows; the achievement ratio (`ratio`) would say 22% next to a 78% bar. */}
            {ceiling
              ? t('work.goals.capUsed', { pct: Math.round(fill * 100) })
              : `${Math.round(ratio * 100)}%`}
          </span>
        </div>
        <span className="relative block">
          <Progress
            value={Math.round(fill * 100)}
            label={t('work.goals.progressLabel', { title: goal.title })}
            tone={goalProgressTone(goal.metric, goal.currentValue, goal.targetValue)}
          />
          <Celebrate play={reachedCelebrate.play} onDone={reachedCelebrate.onDone} />
        </span>
        {overCap ? (
          <p className="flex items-center gap-1.5 text-caption text-destructive">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            {t('work.goals.overCap', { over: goal.currentValue - goal.targetValue })}
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {goal.filter ? <Chip tone="outline">{goal.filter}</Chip> : null}
        {/* A goal with nothing behind it says so, instead of showing a confident flat 0 %. */}
        {goal.matchedCards === 0 ? (
          <Chip tone="attention">{t('work.goals.noMatchingWork')}</Chip>
        ) : (
          // SEV2 #8's click-through: the cards this goal is counted from, in the table, narrowed by
          // the goal's own filter. "Why is this number what it is" is one click, not a re-typed
          // query.
          <a
            href={goalCardsHref(goal.filter)}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
              event.preventDefault()
              navigate(goalCardsHref(goal.filter))
            }}
            className="inline-flex items-center gap-1 rounded-sm text-caption text-primary transition-colors duration-(--dur-micro) hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('work.goals.matchedCards', { count: goal.matchedCards })}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
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

/**
 * v1.1 critique SEV2 #8: "you cannot change a rule you wrote, only delete it and retype it" applied
 * to goals as well -- the only control on a card was a trash icon. One dialog does both jobs,
 * because the fields are identical and a second near-copy is a second chance for the two to drift.
 * `goal === null` is the create case; anything else is the edit case, and the form is seeded from
 * that goal every time it opens.
 */
function GoalDialog({
  open,
  goal,
  onOpenChange,
}: {
  open: boolean
  goal: Goal | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const createGoal = useCreateGoalMutation()
  const patchGoal = usePatchGoalMutation()
  const editing = goal !== null
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

  // Seeded on open, not on every render: a head halfway through editing a target must not have it
  // overwritten by a background refetch of the goals list.
  React.useEffect(() => {
    if (!open) return
    if (goal === null) {
      reset()
      return
    }
    setTitle(goal.title)
    setDescription(goal.description ?? '')
    setMetric(goal.metric)
    setFilter(goal.filter ?? '')
    setTarget(String(goal.targetValue))
    setDueOn(goal.dueOn ?? '')
    // `goal.id` rather than `goal`: the object identity changes on every refetch, the goal does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id])

  const targetValue = Number(target)
  const valid = title.trim().length > 0 && Number.isFinite(targetValue) && targetValue >= 0

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    if (!valid) return
    const draft = {
      title: title.trim(),
      metric,
      targetValue,
      description: description.trim() ? description.trim() : null,
      // `''` rather than `null`: an emptied filter means "count every card", which is a value the
      // server understands, not an absent field.
      filter: filter.trim(),
      dueOn: dueOn ? dueOn : null,
    }
    if (editing) {
      patchGoal.mutate(
        { id: goal.id, patch: draft },
        {
          onSuccess: () => {
            toast.success(t('work.goals.saved'))
            onOpenChange(false)
          },
          onError: () => toast.error(t('work.goals.saveFailed')),
        },
      )
      return
    }
    createGoal.mutate(
      {
        title: draft.title,
        metric,
        targetValue,
        ...(draft.description ? { description: draft.description } : {}),
        ...(draft.filter ? { filter: draft.filter } : {}),
        ...(draft.dueOn ? { dueOn: draft.dueOn } : {}),
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
      <DialogContent
        title={editing ? t('work.goals.editTitle') : t('work.goals.newTitle')}
        className="max-w-lg"
      >
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
            <Button
              type="submit"
              disabled={!valid}
              loading={editing ? patchGoal.isPending : createGoal.isPending}
            >
              {editing ? t('work.goals.save') : t('work.goals.create')}
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
  // SEV2 #8: `null` opens the dialog on "create", a goal opens it on "edit".
  const [editingGoal, setEditingGoal] = React.useState<Goal | null>(null)
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
    // v1.1 critique SEV2 #17: four different shapes of no-permission across the head's screens.
    // This is the /people/table treatment -- what the page is, who to ask, and exactly one
    // alternative action worth taking -- applied here, where a member used to get a page header
    // followed by an inline sentence and nowhere to go.
    body = (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="work.goals.forbiddenBody"
        action={{ labelKey: 'work.goals.forbiddenAction', onAction: () => navigate('/work') }}
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
        action={{
          labelKey: 'work.goals.create',
          onAction: () => {
            setEditingGoal(null)
            setDialogOpen(true)
          },
        }}
      />
    )
  } else {
    body = (
      <Stagger
        presence
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        animateKey={`goals-${goals.length}`}
      >
        {goals.map((goal) => (
          <StaggerItem key={goal.id} exit="hidden" layout className="h-full min-w-0">
            <GoalCard
              goal={goal}
              canManage={isHead}
              busy={pending === goal.id}
              onDelete={() => remove(goal)}
              onEdit={() => {
                setEditingGoal(goal)
                setDialogOpen(true)
              }}
            />
          </StaggerItem>
        ))}
      </Stagger>
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
            <Button
              onClick={() => {
                setEditingGoal(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('work.goals.create')}
            </Button>
          ) : null
        }
      />
      {body}
      {isHead ? (
        <GoalDialog
          open={dialogOpen}
          goal={editingGoal}
          onOpenChange={(next) => {
            setDialogOpen(next)
            if (!next) setEditingGoal(null)
          }}
        />
      ) : null}
    </div>
  )
}
