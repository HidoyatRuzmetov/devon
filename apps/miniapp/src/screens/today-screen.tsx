// "Bugun" -- the tab the app opens on. The personal today list (I-1: the viewer's own rows, owner
// only, no head lens and no super-admin lens ever), plus the two shortcuts that only appear when
// they mean something: "Maʼlumotlarim" once the department has person fields, and the head's
// Telegram setup checklist.
import * as React from 'react'
import { ChevronRight, IdCard, Plus, Settings2 } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button, Checkbox, Input, cn, toast } from '@devon/ui'
import {
  createPersonalTask,
  listPersonalTasks,
  setPersonalTaskDone,
  type PersonalTask,
} from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { useIsHead, useSession } from '../lib/session.js'
import { navigate } from '../lib/router.js'
import { tg } from '../lib/telegram.js'
import {
  ListSkeleton,
  QueryState,
  ScreenBody,
  ScreenHeader,
  ScreenList,
} from '../components/screen.js'
import { SectionLabel, rowSurface } from '../components/bits.js'

function greetingKey(now: Date): string {
  const hour = now.getHours()
  if (hour < 6) return 'miniapp.greeting.night'
  if (hour < 12) return 'miniapp.greeting.morning'
  if (hour < 18) return 'miniapp.greeting.afternoon'
  return 'miniapp.greeting.evening'
}

function TaskRow({
  task,
  onToggle,
}: {
  task: PersonalTask
  onToggle: (task: PersonalTask, done: boolean) => void
}): React.ReactElement {
  const done = task.doneAt !== null
  const inputId = `task-${task.id}`
  return (
    <div className={cn(rowSurface, 'flex items-start gap-3 py-2.5')}>
      <Checkbox
        id={inputId}
        checked={done}
        celebrate
        onCheckedChange={(next) => onToggle(task, next === true)}
        className="mt-0.5"
      />
      <label
        htmlFor={inputId}
        className={cn(
          'min-w-0 flex-1 cursor-pointer text-[14px] leading-5',
          // The catalogue's "text strikes through" half of the done moment.
          done ? 'text-muted-foreground line-through' : 'text-foreground',
        )}
      >
        {task.title}
      </label>
    </div>
  )
}

export function TodayScreen(): React.ReactElement {
  const t = useT()
  const session = useSession()
  const isHead = useIsHead()
  const tasks = useQuery(() => listPersonalTasks(), [])
  const [draft, setDraft] = React.useState('')
  const [adding, setAdding] = React.useState(false)

  const onToggle = React.useCallback(
    (task: PersonalTask, done: boolean) => {
      const list = tasks.data ?? []
      // Optimistic: a checkbox that waits for a round trip on a mobile network feels broken. The
      // catch below puts the row back exactly as it was and says so.
      tasks.set(
        list.map((row) =>
          row.id === task.id ? { ...row, doneAt: done ? new Date().toISOString() : null } : row,
        ),
      )
      if (done) tg.haptic.success()
      setPersonalTaskDone(task.id, done, task.version)
        .then((updated) => {
          tasks.set((tasks.data ?? list).map((row) => (row.id === updated.id ? updated : row)))
        })
        .catch(() => {
          tasks.set(list)
          toast.error(t('miniapp.today.toggleFailed'))
        })
    },
    [tasks, t],
  )

  const onAdd = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      const title = draft.trim()
      if (title === '' || adding) return
      setAdding(true)
      createPersonalTask(title)
        .then((created) => {
          tasks.set([...(tasks.data ?? []), created])
          setDraft('')
          tg.haptic.tap()
        })
        .catch(() => toast.error(t('miniapp.today.addFailed')))
        .finally(() => setAdding(false))
    },
    [draft, adding, tasks, t],
  )

  const open = (tasks.data ?? []).filter((task) => task.doneAt === null)
  const done = (tasks.data ?? []).filter((task) => task.doneAt !== null)

  return (
    <>
      <ScreenHeader
        eyebrow={session.department?.name ?? t('miniapp.noDepartment')}
        title={t(greetingKey(new Date()), { name: session.user.givenName })}
      />
      <ScreenBody>
        <form onSubmit={onAdd} className="mb-3 flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('miniapp.today.addPlaceholder')}
            aria-label={t('miniapp.today.addPlaceholder')}
            maxLength={500}
            className="flex-1"
          />
          <Button type="submit" size="md" loading={adding} disabled={draft.trim() === ''}>
            <Plus className="size-4" aria-hidden />
            <span className="sr-only">{t('miniapp.today.add')}</span>
          </Button>
        </form>

        {tasks.status === 'loading' && tasks.data === null ? (
          <ListSkeleton rows={4} />
        ) : tasks.status === 'error' && tasks.data === null ? (
          <QueryState error={tasks.error} onRetry={tasks.refetch} />
        ) : open.length === 0 && done.length === 0 ? (
          <QueryState
            error={null}
            emptyTitleKey="miniapp.today.empty.title"
            emptyBodyKey="miniapp.today.empty.body"
            onRetry={tasks.refetch}
          />
        ) : (
          <>
            {open.length > 0 ? (
              <>
                <SectionLabel count={open.length}>{t('miniapp.today.open')}</SectionLabel>
                <ScreenList>
                  {open.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={onToggle} />
                  ))}
                </ScreenList>
              </>
            ) : null}
            {done.length > 0 ? (
              <>
                <SectionLabel count={done.length}>{t('miniapp.today.done')}</SectionLabel>
                <ScreenList>
                  {done.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={onToggle} />
                  ))}
                </ScreenList>
              </>
            ) : null}
          </>
        )}

        {session.fieldsAvailable || isHead ? (
          <>
            <SectionLabel>{t('miniapp.today.more')}</SectionLabel>
            <div className="flex flex-col gap-2">
              {session.fieldsAvailable ? (
                <button
                  type="button"
                  className={cn(rowSurface, 'flex items-center gap-3')}
                  onClick={() => navigate({ name: 'fields' })}
                >
                  <IdCard className="text-muted-foreground size-5" aria-hidden />
                  <span className="flex-1 text-[14px] leading-5">{t('miniapp.fields.title')}</span>
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                </button>
              ) : null}
              {isHead ? (
                <button
                  type="button"
                  className={cn(rowSurface, 'flex items-center gap-3')}
                  onClick={() => navigate({ name: 'setup' })}
                >
                  <Settings2 className="text-muted-foreground size-5" aria-hidden />
                  <span className="flex-1 text-[14px] leading-5">{t('miniapp.setup.title')}</span>
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </ScreenBody>
    </>
  )
}
