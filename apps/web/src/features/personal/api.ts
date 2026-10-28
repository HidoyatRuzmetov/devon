// Typed endpoint functions for the personal workspace (MODULE-GUIDE.md "Web features": "the typed
// API client every `src/features/<name>` module builds its own endpoint functions on"). `apiClient`
// itself (`src/lib/api-client.ts`) only wires up GET/POST/PATCH -- this module's `DELETE` routes need
// one more small, same-shaped helper, built locally rather than by editing that shared file.
import {
  personalDeleteReceiptSchema,
  personalTaskVersionChangeSchema,
  type PersonalDeleteReceipt,
} from '@devon/contracts'
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import {
  pomodoroSessionListSchema,
  pomodoroSessionSchema,
  pomodoroSettingsSchema,
  taskListSchema,
  taskSchema,
  type CreatePomodoroSessionInput,
  type CreateTaskInput,
  type PatchPomodoroSessionInput,
  type PatchPomodoroSettingsInput,
  type PatchTaskInput,
  type PomodoroSession,
  type PomodoroSettings,
  type ReorderTasksInput,
  type Task,
} from './types.js'

const BASE = '/api/v1/personal'

// -- Tasks --------------------------------------------------------------------------------------------

export const fetchTasks = (): Promise<Task[]> => apiClient.get(`${BASE}/tasks`, taskListSchema)

export const createTask = (input: CreateTaskInput, csrf: string): Promise<Task> =>
  apiClient.post(`${BASE}/tasks`, input, taskSchema, csrf)

const taskWriteResultSchema = z.object({
  task: taskSchema,
  affectedVersions: z.array(personalTaskVersionChangeSchema),
})
export const patchTask = (id: string, input: PatchTaskInput, csrf: string) =>
  apiClient.patch(`${BASE}/tasks/${id}?versions=true`, input, taskWriteResultSchema, csrf)

export const deleteTask = (id: string, csrf: string): Promise<PersonalDeleteReceipt> =>
  apiClient.delete(`${BASE}/tasks/${id}?receipt=true`, personalDeleteReceiptSchema, csrf)

export const restoreTask = (
  id: string,
  receipt: PersonalDeleteReceipt,
  csrf: string,
): Promise<Task> => apiClient.post(`${BASE}/tasks/${id}/restore`, receipt, taskSchema, csrf)

const reorderResultSchema = z.object({
  updated: z.number().int(),
  affectedVersions: z.array(personalTaskVersionChangeSchema),
})

export const reorderTasks = (input: ReorderTasksInput, csrf: string) =>
  apiClient.post(`${BASE}/tasks/reorder?versions=true`, input, reorderResultSchema, csrf)

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
