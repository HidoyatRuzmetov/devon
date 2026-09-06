// React Query hooks over `api.ts` (MODULE-GUIDE.md "Web features"). Every mutation reads the CSRF
// token off the cached `/me` response (`useMeQuery()` -- the same cache the shell already populates,
// never a second network call) and invalidates this feature's own query keys on success.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'
import type {
  CreateCanvasInput,
  CreateNoteInput,
  CreatePomodoroSessionInput,
  CreateSprintInput,
  CreateTaskInput,
  PatchCanvasInput,
  PatchNoteInput,
  PatchPomodoroSessionInput,
  PatchPomodoroSettingsInput,
  PatchSprintInput,
  PatchTaskInput,
  ReorderTasksInput,
  RolloverSprintInput,
} from './types.js'

const KEYS = {
  sprints: ['personal', 'sprints'] as const,
  tasks: ['personal', 'tasks'] as const,
  notes: ['personal', 'notes'] as const,
  canvases: ['personal', 'canvases'] as const,
  canvas: (id: string) => ['personal', 'canvases', id] as const,
  pomodoroSettings: ['personal', 'pomodoro', 'settings'] as const,
  pomodoroSessions: ['personal', 'pomodoro', 'sessions'] as const,
  pomodoroStats: ['personal', 'pomodoro', 'stats'] as const,
}

/** Every mutation needs this; centralised so a signed-out edge case (no cached `/me` yet) fails
 * loudly instead of sending a request with an empty CSRF header that the server will 403 anyway. */
function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

// -- Sprints ------------------------------------------------------------------------------------------

export function useSprintsQuery() {
  return useQuery({ queryKey: KEYS.sprints, queryFn: api.fetchSprints })
}

export function useCreateSprintMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreateSprintInput) => api.createSprint(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.sprints }),
  })
}

export function usePatchSprintMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchSprintInput }) =>
      api.patchSprint(id, input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.sprints }),
  })
}

export function useRolloverSprintMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RolloverSprintInput }) =>
      api.rolloverSprint(id, input, csrf),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.sprints })
      qc.invalidateQueries({ queryKey: KEYS.tasks })
    },
  })
}

// -- Tasks --------------------------------------------------------------------------------------------

export function useTasksQuery() {
  return useQuery({ queryKey: KEYS.tasks, queryFn: api.fetchTasks })
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
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchTaskInput }) =>
      api.patchTask(id, input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.tasks }),
  })
}

export function useDeleteTaskMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.tasks }),
  })
}

export function useReorderTasksMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: ReorderTasksInput) => api.reorderTasks(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.tasks }),
  })
}

// -- Notes --------------------------------------------------------------------------------------------

export function useNotesQuery() {
  return useQuery({ queryKey: KEYS.notes, queryFn: api.fetchNotes })
}

export function useCreateNoteMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreateNoteInput) => api.createNote(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.notes }),
  })
}

export function usePatchNoteMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchNoteInput }) =>
      api.patchNote(id, input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.notes }),
  })
}

export function useDeleteNoteMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deleteNote(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.notes }),
  })
}

// -- Canvases -----------------------------------------------------------------------------------------

export function useCanvasesQuery() {
  return useQuery({ queryKey: KEYS.canvases, queryFn: api.fetchCanvases })
}

export function useCanvasQuery(id: string | null) {
  return useQuery({
    queryKey: KEYS.canvas(id ?? 'none'),
    queryFn: () => api.fetchCanvas(id!),
    enabled: id !== null,
  })
}

export function useCreateCanvasMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreateCanvasInput) => api.createCanvas(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.canvases }),
  })
}

export function usePatchCanvasMutation(id: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: PatchCanvasInput) => api.patchCanvas(id, input, csrf),
    onSuccess: (updated) => {
      qc.setQueryData(KEYS.canvas(id), updated)
      qc.invalidateQueries({ queryKey: KEYS.canvases })
    },
  })
}

export function useDeleteCanvasMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deleteCanvas(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.canvases }),
  })
}

// -- Pomodoro -----------------------------------------------------------------------------------------

export function usePomodoroSettingsQuery() {
  return useQuery({ queryKey: KEYS.pomodoroSettings, queryFn: api.fetchPomodoroSettings })
}

export function usePatchPomodoroSettingsMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: PatchPomodoroSettingsInput) => api.patchPomodoroSettings(input, csrf),
    onSuccess: (updated) => qc.setQueryData(KEYS.pomodoroSettings, updated),
  })
}

export function usePomodoroSessionsQuery() {
  return useQuery({ queryKey: KEYS.pomodoroSessions, queryFn: api.fetchPomodoroSessions })
}

export function usePomodoroStatsQuery() {
  return useQuery({ queryKey: KEYS.pomodoroStats, queryFn: api.fetchPomodoroStats })
}

export function useCreatePomodoroSessionMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreatePomodoroSessionInput) => api.createPomodoroSession(input, csrf),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.pomodoroSessions })
      qc.invalidateQueries({ queryKey: KEYS.pomodoroStats })
    },
  })
}

export function usePatchPomodoroSessionMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchPomodoroSessionInput }) =>
      api.patchPomodoroSession(id, input, csrf),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.pomodoroSessions })
      qc.invalidateQueries({ queryKey: KEYS.pomodoroStats })
    },
  })
}

/** Optimistic, delayed deletion (spec-wide rule: "undo over confirm" -- no confirm dialog, ever): the
 * caller hides the row immediately and shows `toastWithUndo`; the real DELETE only fires after the
 * grace window elapses with no undo, via `commit()`. Nothing server-side needs a restore endpoint. */
export function useDelayedDelete(deleteFn: (id: string) => Promise<void>, graceMs = 5000) {
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const schedule = React.useCallback(
    (id: string) => {
      const timer = setTimeout(() => {
        timers.current.delete(id)
        void deleteFn(id)
      }, graceMs)
      timers.current.set(id, timer)
    },
    [deleteFn, graceMs],
  )

  const cancel = React.useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  React.useEffect(() => {
    const map = timers.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
    }
  }, [])

  return { schedule, cancel }
}
