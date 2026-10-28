// React Query hooks over `api.ts` (MODULE-GUIDE.md "Web features"). Every mutation reads the CSRF
// token off the cached `/me` response (`useMeQuery()` -- the same cache the shell already populates,
// never a second network call) and invalidates this feature's own query keys on success.
import { type PersonalDeleteReceipt } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { toast, toastWithUndo } from '@devon/ui'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'
import type { CreateTaskInput, PatchTaskInput, ReorderTasksInput, Task } from './types.js'

const KEYS = {
  tasks: ['personal', 'tasks'] as const,
  pomodoroSettings: ['personal', 'pomodoro', 'settings'] as const,
}

/** Every mutation needs this; centralised so a signed-out edge case (no cached `/me` yet) fails
 * loudly instead of sending a request with an empty CSRF header that the server will 403 anyway. */
function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

// -- Tasks --------------------------------------------------------------------------------------------

export function useTasksQuery() {
  return useQuery({ queryKey: KEYS.tasks, queryFn: api.fetchTasks })
}

// H5.1 ("optimistic updates for ... personal tasks; rollback on failure with toast"): this list is
// the checklist/nested-task tree `task-row.tsx` renders in `sprints-view.tsx`, `tasks-view.tsx` and
// `today-view.tsx` -- toggling a task done, renaming it, and Tab/Shift+Tab indent-reorder are the
// single most frequent interactions in the whole personal workspace, and every one of them used to
// wait a full round trip before the checkbox/strikethrough/indent visibly changed. Same
// snapshot-and-`rollback()` shape as `work/hooks.ts`'s `patchCardInCaches` (this feature's own
// established pattern for the identical problem).
const TASK_WRITE_KEY = ['personal', 'task-write'] as const
const taskVersions = new WeakMap<QueryClient, Map<string, { from: number; to: number }>>()
const taskFields = new WeakMap<QueryClient, Map<string, number>>()
let nextTaskField = 0

function rememberTaskVersion(qc: QueryClient, id: string, from: number, to: number) {
  let versions = taskVersions.get(qc)
  if (!versions) {
    versions = new Map()
    taskVersions.set(qc, versions)
  }
  const previous = versions.get(id)
  versions.set(id, { from: previous?.to === from ? previous.from : from, to })
  qc.setQueryData<Task[]>(KEYS.tasks, (tasks) =>
    tasks?.map((task) =>
      task.id === id ? { ...task, version: Math.max(task.version, to) } : task,
    ),
  )
}

function acknowledgedTaskVersion(qc: QueryClient, id: string, version: number) {
  const own = taskVersions.get(qc)?.get(id)
  return own && version >= own.from && version <= own.to ? own.to : version
}

/** Roll back only fields still owned by this write; a failed older edit cannot erase a newer one. */
function optimisticallyPatchTasks(qc: QueryClient, patches: ReadonlyMap<string, Partial<Task>>) {
  const previous = qc.getQueryData<Task[]>(KEYS.tasks)
  const previousById = new Map(previous?.map((task) => [task.id, task]))
  let generations = taskFields.get(qc)
  if (!generations) {
    generations = new Map()
    taskFields.set(qc, generations)
  }
  const own = new Map<string, number>()
  for (const [id, patch] of patches)
    for (const field of Object.keys(patch)) {
      const key = `${id}:${field}`
      const generation = ++nextTaskField
      generations.set(key, generation)
      own.set(key, generation)
    }
  qc.setQueryData<Task[]>(KEYS.tasks, (tasks) =>
    tasks?.map((task) => ({ ...task, ...patches.get(task.id) })),
  )
  return {
    rollback: () =>
      qc.setQueryData<Task[]>(KEYS.tasks, (tasks) =>
        tasks?.map((task) => {
          const before = previousById.get(task.id)
          const patch = patches.get(task.id)
          if (!before || !patch) return task
          const restored: Partial<Task> = {}
          for (const field of Object.keys(patch) as (keyof Task)[]) {
            const key = `${task.id}:${field}`
            if (generations.get(key) === own.get(key) && Object.is(task[field], patch[field]))
              Object.assign(restored, { [field]: before[field] })
          }
          return { ...task, ...restored }
        }),
      ),
  }
}

function finishTaskWrite(qc: QueryClient) {
  if (qc.isMutating({ mutationKey: TASK_WRITE_KEY }) <= 1)
    return qc.invalidateQueries({ queryKey: KEYS.tasks })
  return Promise.resolve()
}

export function useCreateTaskMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.tasks }),
  })
}

export function usePatchTaskMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const t = useT()
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    scope: { id: 'personal-task-writes' },
    mutationFn: async ({ id, input }: { id: string; input: PatchTaskInput }) => {
      // Rebase only over versions minted by preceding writes in this client. A remote version
      // advance still fails the API's concurrency check rather than silently overwriting it.
      const version = acknowledgedTaskVersion(qc, id, input.version)
      const updated = await api.patchTask(id, { ...input, version }, csrf)
      for (const row of updated.affectedVersions)
        rememberTaskVersion(qc, row.id, row.beforeVersion, row.afterVersion)
      return updated.task
    },
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: KEYS.tasks })
      const { version: _version, done, ...fields } = input
      return optimisticallyPatchTasks(
        qc,
        new Map([
          [
            id,
            {
              ...fields,
              ...(done !== undefined ? { doneAt: done ? new Date().toISOString() : null } : {}),
            },
          ],
        ]),
      )
    },
    onError: (_err, _vars, context) => {
      context?.rollback()
      toast.error(t('toast.saveError'))
    },
    onSettled: () => finishTaskWrite(qc),
  })
}

export function useDeleteTaskMutation() {
  return usePersonalDeletion(
    KEYS.tasks,
    api.deleteTask,
    api.restoreTask,
    'personal.tasks.deleted.toast',
  )
}

export function useReorderTasksMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const t = useT()
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    scope: { id: 'personal-task-writes' },
    mutationFn: async (input: ReorderTasksInput) => {
      const updated = await api.reorderTasks(input, csrf)
      for (const row of updated.affectedVersions)
        rememberTaskVersion(qc, row.id, row.beforeVersion, row.afterVersion)
      return updated
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: KEYS.tasks })
      const patches = new Map(input.items.map(({ id, ...patch }) => [id, patch]))
      return optimisticallyPatchTasks(qc, patches)
    },
    onError: (_err, _vars, context) => {
      context?.rollback()
      toast.error(t('toast.saveError'))
    },
    onSettled: () => finishTaskWrite(qc),
  })
}

// -- Pomodoro -----------------------------------------------------------------------------------------

export function usePomodoroSettingsQuery() {
  return useQuery({ queryKey: KEYS.pomodoroSettings, queryFn: api.fetchPomodoroSettings })
}

/** Persist before announcing success. Mutation callbacks survive tab unmount; Undo uses the
 * operation receipt so an older toast cannot restore a later deletion of the same item. */
function usePersonalDeletion(
  queryKey: readonly string[],
  deleteItem: (id: string, csrf: string) => Promise<PersonalDeleteReceipt>,
  restoreItem: (id: string, receipt: PersonalDeleteReceipt, csrf: string) => Promise<unknown>,
  messageKey: string,
) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const t = useT()
  return useMutation({
    mutationFn: (id: string) => deleteItem(id, csrf),
    onSuccess: async (receipt, id) => {
      await qc.invalidateQueries({ queryKey })
      toastWithUndo({
        message: t(messageKey),
        undoLabel: t('action.undo'),
        onUndo: () => {
          void restoreItem(id, receipt, csrf)
            .then(() => qc.invalidateQueries({ queryKey }))
            .catch(() => toast.error(t('toast.saveError')))
        },
      })
    },
    onError: () => toast.error(t('toast.saveError')),
  })
}
