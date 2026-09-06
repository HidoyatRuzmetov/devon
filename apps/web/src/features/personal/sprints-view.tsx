// Sprints (TECH-SPEC §3.3: "3h/day/week/custom, goal and rollover").
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Plus, RotateCcw } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  Input,
  StateView,
  toast,
} from '@devon/ui'
import {
  useCreateSprintMutation,
  usePatchSprintMutation,
  useRolloverSprintMutation,
  useSprintsQuery,
} from './use-personal.js'
import type { Sprint, SprintKind } from './types.js'

const KIND_KEYS: Record<SprintKind, string> = {
  '3h': 'personal.sprints.kind.threeHour',
  day: 'personal.sprints.kind.day',
  week: 'personal.sprints.kind.week',
  custom: 'personal.sprints.kind.custom',
}

function durationHours(kind: SprintKind): number {
  return kind === '3h' ? 3 : kind === 'day' ? 24 : kind === 'week' ? 24 * 7 : 24
}

function defaultRange(kind: SprintKind): { startsAt: string; endsAt: string } {
  const start = new Date()
  const end = new Date(start.getTime() + durationHours(kind) * 3_600_000)
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

export function SprintsView() {
  const t = useT()
  const sprintsQuery = useSprintsQuery()
  const createSprint = useCreateSprintMutation()
  const patchSprint = usePatchSprintMutation()
  const rollover = useRolloverSprintMutation()
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<SprintKind>('week')
  const [goal, setGoal] = React.useState('')

  if (sprintsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
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
  const active = sprints.filter((s) => s.status === 'active')
  const past = sprints.filter((s) => s.status !== 'active')

  function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    const range = defaultRange(kind)
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
    const range = defaultRange(sprint.kind)
    rollover.mutate(
      { id: sprint.id, input: { ...range, goal: sprint.goal } },
      {
        onSuccess: (result) =>
          toast(t('personal.sprints.rollover.toast', { count: result.movedTaskCount })),
        onError: () => toast(t('toast.saveError')),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-h3 text-foreground">{t('personal.sprints.active.title')}</h3>
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
                {(Object.keys(KIND_KEYS) as SprintKind[]).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={kind === k ? 'primary' : 'secondary'}
                    onClick={() => setKind(k)}
                  >
                    {t(KIND_KEYS[k])}
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

      {active.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="personal.sprints.empty.title"
          bodyKey="personal.sprints.empty.body"
          action={{ labelKey: 'personal.sprints.create.action', onAction: () => setOpen(true) }}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((sprint) => (
            <li key={sprint.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge>{t(KIND_KEYS[sprint.kind])}</Badge>
                    <span className="text-caption text-muted-foreground">
                      {new Date(sprint.startsAt).toLocaleDateString()} –{' '}
                      {new Date(sprint.endsAt).toLocaleDateString()}
                    </span>
                  </div>
                  {sprint.goal ? <p className="text-body text-foreground">{sprint.goal}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
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
              </div>
            </li>
          ))}
        </ul>
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
                <span className="text-muted-foreground">{t(KIND_KEYS[sprint.kind])}</span>
                <span className="text-foreground">{sprint.goal ?? '—'}</span>
                <Badge tone={sprint.status === 'archived' ? 'neutral' : 'success'}>
                  {t(`personal.sprints.status.${sprint.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
