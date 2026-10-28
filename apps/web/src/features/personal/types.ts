// Client-side mirror of `apps/api/src/modules/personal/schemas.ts` (same convention as
// `src/lib/api-schemas.ts` mirroring the foundation's `apps/api/src/schemas.ts`): the two packages
// never share a schema file, so each side validates the wire shape it actually expects.
import { z } from 'zod'

export const pomodoroKindSchema = z.enum(['focus', 'short_break', 'long_break'])
export type PomodoroKind = z.infer<typeof pomodoroKindSchema>

export const taskSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  doneAt: z.string().nullable(),
  notes: z.string().nullable(),
  sort: z.number().int(),
  estimateMin: z.number().int().nullable(),
  linkedCardId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type Task = z.infer<typeof taskSchema>
export const taskListSchema = z.array(taskSchema)

export type CreateTaskInput = {
  title: string
  afterTaskId?: string
  parentId?: string | null
  notes?: string | null
  estimateMin?: number | null
  linkedCardId?: string | null
  sort?: number
}
export type PatchTaskInput = {
  title?: string
  parentId?: string | null
  done?: boolean
  notes?: string | null
  estimateMin?: number | null
  linkedCardId?: string | null
  sort?: number
  version: number
}
export type ReorderTasksInput = {
  items: { id: string; sort: number; parentId?: string | null }[]
}

export const pomodoroSettingsSchema = z.object({
  focusMin: z.number().int(),
  shortBreakMin: z.number().int(),
  longBreakMin: z.number().int(),
  cyclesBeforeLong: z.number().int(),
  sound: z.enum(['chime', 'bell', 'digital', 'none']),
  notifications: z.boolean(),
  autoStart: z.boolean(),
})
export type PomodoroSettings = z.infer<typeof pomodoroSettingsSchema>
export type PatchPomodoroSettingsInput = Partial<PomodoroSettings>

export const pomodoroSessionSchema = z.object({
  id: z.string(),

  kind: pomodoroKindSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  completed: z.boolean(),
  createdAt: z.string(),
})
export type PomodoroSession = z.infer<typeof pomodoroSessionSchema>
export const pomodoroSessionListSchema = z.array(pomodoroSessionSchema)

export type CreatePomodoroSessionInput = {
  kind: PomodoroKind
  startedAt: string
  endedAt?: string | null
  completed?: boolean
}
export type PatchPomodoroSessionInput = { endedAt?: string | null; completed?: boolean }
