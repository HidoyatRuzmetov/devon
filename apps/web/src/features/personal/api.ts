// Typed endpoint functions for the personal workspace (MODULE-GUIDE.md "Web features": "the typed
// API client every `src/features/<name>` module builds its own endpoint functions on"). `apiClient`
// itself (`src/lib/api-client.ts`) only wires up GET/POST/PATCH -- this module's `DELETE` routes need
// one more small, same-shaped helper, built locally rather than by editing that shared file.
import { z } from 'zod'
import { problemSchema } from '@devon/contracts'
import { ApiError, NetworkError, apiClient } from '../../lib/api-client.js'
import {
  canvasSchema,
  canvasSummaryListSchema,
  noteListSchema,
  noteSchema,
  pomodoroSessionListSchema,
  pomodoroSessionSchema,
  pomodoroSettingsSchema,
  pomodoroStatsSchema,
  sprintListSchema,
  sprintSchema,
  taskListSchema,
  taskSchema,
  type Canvas,
  type CanvasSummary,
  type CreateCanvasInput,
  type CreateNoteInput,
  type CreatePomodoroSessionInput,
  type CreateSprintInput,
  type CreateTaskInput,
  type Note,
  type PatchCanvasInput,
  type PatchNoteInput,
  type PatchPomodoroSessionInput,
  type PatchPomodoroSettingsInput,
  type PatchSprintInput,
  type PatchTaskInput,
  type PomodoroSession,
  type PomodoroSettings,
  type PomodoroStats,
  type ReorderTasksInput,
  type RolloverSprintInput,
  type Sprint,
  type Task,
} from './types.js'

const BASE = '/api/v1/personal'

async function del(path: string, csrfToken: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'DELETE',
      credentials: 'include',
      headers: { accept: 'application/json', 'x-csrf-token': csrfToken },
    })
  } catch (cause) {
    throw new NetworkError(cause)
  }
  if (res.ok) return
  const requestId = res.headers.get('x-request-id')
  let code = 'internal'
  try {
    const parsed = problemSchema.safeParse(await res.json())
    if (parsed.success) code = parsed.data.code
  } catch {
    // Not a Problem body -- fall back to 'internal', same as `api-client.ts`.
  }
  throw new ApiError(res.status, code, requestId)
}

// -- Sprints ------------------------------------------------------------------------------------------

export const fetchSprints = (): Promise<Sprint[]> =>
  apiClient.get(`${BASE}/sprints`, sprintListSchema)

export const createSprint = (input: CreateSprintInput, csrf: string): Promise<Sprint> =>
  apiClient.post(`${BASE}/sprints`, input, sprintSchema, csrf)

export const patchSprint = (id: string, input: PatchSprintInput, csrf: string): Promise<Sprint> =>
  apiClient.patch(`${BASE}/sprints/${id}`, input, sprintSchema, csrf)

const rolloverResultSchema = z.object({ sprint: sprintSchema, movedTaskCount: z.number().int() })

export const rolloverSprint = (
  id: string,
  input: RolloverSprintInput,
  csrf: string,
): Promise<{ sprint: Sprint; movedTaskCount: number }> =>
  apiClient.post(`${BASE}/sprints/${id}/rollover`, input, rolloverResultSchema, csrf)

// -- Tasks --------------------------------------------------------------------------------------------

export const fetchTasks = (): Promise<Task[]> => apiClient.get(`${BASE}/tasks`, taskListSchema)

export const createTask = (input: CreateTaskInput, csrf: string): Promise<Task> =>
  apiClient.post(`${BASE}/tasks`, input, taskSchema, csrf)

export const patchTask = (id: string, input: PatchTaskInput, csrf: string): Promise<Task> =>
  apiClient.patch(`${BASE}/tasks/${id}`, input, taskSchema, csrf)

export const deleteTask = (id: string, csrf: string): Promise<void> =>
  del(`${BASE}/tasks/${id}`, csrf)

const reorderResultSchema = z.object({ updated: z.number().int() })

export const reorderTasks = (
  input: ReorderTasksInput,
  csrf: string,
): Promise<{ updated: number }> =>
  apiClient.post(`${BASE}/tasks/reorder`, input, reorderResultSchema, csrf)

// -- Notes --------------------------------------------------------------------------------------------

export const fetchNotes = (): Promise<Note[]> => apiClient.get(`${BASE}/notes`, noteListSchema)

export const createNote = (input: CreateNoteInput, csrf: string): Promise<Note> =>
  apiClient.post(`${BASE}/notes`, input, noteSchema, csrf)

export const patchNote = (id: string, input: PatchNoteInput, csrf: string): Promise<Note> =>
  apiClient.patch(`${BASE}/notes/${id}`, input, noteSchema, csrf)

export const deleteNote = (id: string, csrf: string): Promise<void> =>
  del(`${BASE}/notes/${id}`, csrf)

// -- Canvases -----------------------------------------------------------------------------------------

export const fetchCanvases = (): Promise<CanvasSummary[]> =>
  apiClient.get(`${BASE}/canvases`, canvasSummaryListSchema)

export const fetchCanvas = (id: string): Promise<Canvas> =>
  apiClient.get(`${BASE}/canvases/${id}`, canvasSchema)

export const createCanvas = (input: CreateCanvasInput, csrf: string): Promise<Canvas> =>
  apiClient.post(`${BASE}/canvases`, input, canvasSchema, csrf)

export const patchCanvas = (id: string, input: PatchCanvasInput, csrf: string): Promise<Canvas> =>
  apiClient.patch(`${BASE}/canvases/${id}`, input, canvasSchema, csrf)

export const deleteCanvas = (id: string, csrf: string): Promise<void> =>
  del(`${BASE}/canvases/${id}`, csrf)

// -- Pomodoro -----------------------------------------------------------------------------------------

export const fetchPomodoroSettings = (): Promise<PomodoroSettings> =>
  apiClient.get(`${BASE}/pomodoro/settings`, pomodoroSettingsSchema)

export const patchPomodoroSettings = (
  input: PatchPomodoroSettingsInput,
  csrf: string,
): Promise<PomodoroSettings> =>
  apiClient.patch(`${BASE}/pomodoro/settings`, input, pomodoroSettingsSchema, csrf)

export const fetchPomodoroSessions = (): Promise<PomodoroSession[]> =>
  apiClient.get(`${BASE}/pomodoro/sessions?limit=200`, pomodoroSessionListSchema)

export const createPomodoroSession = (
  input: CreatePomodoroSessionInput,
  csrf: string,
): Promise<PomodoroSession> =>
  apiClient.post(`${BASE}/pomodoro/sessions`, input, pomodoroSessionSchema, csrf)

export const patchPomodoroSession = (
  id: string,
  input: PatchPomodoroSessionInput,
  csrf: string,
): Promise<PomodoroSession> =>
  apiClient.patch(`${BASE}/pomodoro/sessions/${id}`, input, pomodoroSessionSchema, csrf)

export const fetchPomodoroStats = (): Promise<PomodoroStats> =>
  apiClient.get(`${BASE}/pomodoro/stats`, pomodoroStatsSchema)
