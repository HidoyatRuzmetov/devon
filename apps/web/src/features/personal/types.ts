// Client-side mirror of `apps/api/src/modules/personal/schemas.ts` (same convention as
// `src/lib/api-schemas.ts` mirroring the foundation's `apps/api/src/schemas.ts`): the two packages
// never share a schema file, so each side validates the wire shape it actually expects.
import { z } from 'zod'

export const sprintKindSchema = z.enum(['3h', 'day', 'week', 'custom'])
export type SprintKind = z.infer<typeof sprintKindSchema>

export const sprintStatusSchema = z.enum(['active', 'completed', 'archived'])
export type SprintStatus = z.infer<typeof sprintStatusSchema>

export const pomodoroKindSchema = z.enum(['focus', 'short_break', 'long_break'])
export type PomodoroKind = z.infer<typeof pomodoroKindSchema>

export const sprintSchema = z.object({
  id: z.string(),
  kind: sprintKindSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  goal: z.string().nullable(),
  status: sprintStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type Sprint = z.infer<typeof sprintSchema>
export const sprintListSchema = z.array(sprintSchema)

export type CreateSprintInput = {
  kind: SprintKind
  startsAt: string
  endsAt: string
  goal?: string | null
}
export type PatchSprintInput = {
  goal?: string | null
  status?: SprintStatus
  startsAt?: string
  endsAt?: string
  version: number
}
export type RolloverSprintInput = { startsAt: string; endsAt: string; goal?: string | null }

export const taskSchema = z.object({
  id: z.string(),
  sprintId: z.string().nullable(),
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
  sprintId?: string | null
  parentId?: string | null
  notes?: string | null
  estimateMin?: number | null
  linkedCardId?: string | null
  sort?: number
}
export type PatchTaskInput = {
  title?: string
  sprintId?: string | null
  parentId?: string | null
  done?: boolean
  notes?: string | null
  estimateMin?: number | null
  linkedCardId?: string | null
  sort?: number
  version: number
}
export type ReorderTasksInput = {
  items: { id: string; sort: number; parentId?: string | null; sprintId?: string | null }[]
}

const noteBodySchema = z.object({ text: z.string() })
export type NoteBody = z.infer<typeof noteBodySchema>

export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: noteBodySchema,
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type Note = z.infer<typeof noteSchema>
export const noteListSchema = z.array(noteSchema)

export type CreateNoteInput = { title: string; body?: NoteBody; pinned?: boolean }
export type PatchNoteInput = { title?: string; body?: NoteBody; pinned?: boolean; version: number }

export type CanvasElement = {
  id: string
  type: 'freehand' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text'
  x: number
  y: number
  w: number
  h: number
  color: string
  strokeWidth: number
  points?: { x: number; y: number }[] | undefined
  text?: string | undefined
}

const canvasElementSchema: z.ZodType<CanvasElement> = z.object({
  id: z.string(),
  type: z.enum(['freehand', 'rectangle', 'ellipse', 'line', 'arrow', 'text']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  color: z.string(),
  strokeWidth: z.number(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  text: z.string().optional(),
})

const sceneSchema = z.object({
  elements: z.array(canvasElementSchema),
  appState: z.record(z.string(), z.unknown()),
})
export type Scene = z.infer<typeof sceneSchema>

export type Sticky = {
  id: string
  x: number
  y: number
  color: string
  text: string
  rotation?: number | undefined
}
const stickySchema: z.ZodType<Sticky> = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  color: z.string(),
  text: z.string(),
  rotation: z.number().optional(),
})

export const canvasSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type CanvasSummary = z.infer<typeof canvasSummarySchema>
export const canvasSummaryListSchema = z.array(canvasSummarySchema)

export const canvasSchema = canvasSummarySchema.extend({
  scene: sceneSchema,
  stickies: z.array(stickySchema),
})
export type Canvas = z.infer<typeof canvasSchema>

export type CreateCanvasInput = { title: string; scene?: Scene; stickies?: Sticky[] }
export type PatchCanvasInput = {
  title?: string
  scene?: Scene
  stickies?: Sticky[]
  version: number
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
  taskId: z.string().nullable(),
  kind: pomodoroKindSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  completed: z.boolean(),
  createdAt: z.string(),
})
export type PomodoroSession = z.infer<typeof pomodoroSessionSchema>
export const pomodoroSessionListSchema = z.array(pomodoroSessionSchema)

export type CreatePomodoroSessionInput = {
  taskId?: string | null
  kind: PomodoroKind
  startedAt: string
  endedAt?: string | null
  completed?: boolean
}
export type PatchPomodoroSessionInput = { endedAt?: string | null; completed?: boolean }

export const pomodoroStatsSchema = z.object({
  today: z.object({
    focusMinutes: z.number(),
    focusSessions: z.number(),
    completedSessions: z.number(),
  }),
  week: z.object({
    focusMinutes: z.number(),
    focusSessions: z.number(),
    completedSessions: z.number(),
  }),
})
export type PomodoroStats = z.infer<typeof pomodoroStatsSchema>
