// Today / focus view (TECH-SPEC §3.3): active sprint goals plus every not-done task across active
// sprints and the sprint-less "Inbox", in one flat, fast list -- picking a task as the Pomodoro's
// linked task is one click away.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Play, Target } from 'lucide-react'
import { Button, StateView } from '@devon/ui'
import { usePatchTaskMutation, useSprintsQuery, useTasksQuery } from './use-personal.js'

export function TodayView({
  focusedTaskId,
  onFocusTask,
}: {
  focusedTaskId: string | null
  onFocusTask: (id: string | null) => void
}) {
  const t = useT()
  const sprintsQuery = useSprintsQuery()
  const tasksQuery = useTasksQuery()
  const patchTask = usePatchTaskMutation()

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
  const activeSprintIds = new Set(activeSprints.map((s) => s.id))
  const todaysTasks = tasksQuery.data
    .filter(
      (task) =>
        task.doneAt === null && (task.sprintId === null || activeSprintIds.has(task.sprintId)),
    )
    .sort((a, b) => a.sort - b.sort)

  return (
    <div className="flex flex-col gap-6">
      {activeSprints.length > 0 ? (
        <section className="flex flex-col gap-2">
          {activeSprints
            .filter((s) => s.goal)
            .map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-2 rounded-md border border-border bg-card p-3"
              >
                <Target className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-body text-foreground">{s.goal}</p>
              </div>
            ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <h3 className="mb-1 text-h3 text-foreground">{t('personal.today.tasks.title')}</h3>
        {todaysTasks.length === 0 ? (
          <StateView
            kind="empty"
            titleKey="personal.today.empty.title"
            bodyKey="personal.today.empty.body"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {todaysTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={task.doneAt !== null}
                  onChange={() =>
                    patchTask.mutate({ id: task.id, input: { done: true, version: task.version } })
                  }
                  aria-label={t('personal.tasks.toggleDone')}
                  className="size-4 shrink-0 rounded-sm border-border"
                />
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {task.title}
                </span>
                {task.estimateMin ? (
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {task.estimateMin}′
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant={focusedTaskId === task.id ? 'primary' : 'ghost'}
                  onClick={() => onFocusTask(focusedTaskId === task.id ? null : task.id)}
                >
                  <Play className="size-3.5" aria-hidden="true" />
                  {t('personal.today.focus')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
