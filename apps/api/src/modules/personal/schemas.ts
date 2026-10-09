// Zod schemas for the personal workspace's endpoints (TECH-SPEC §3.3), module-owned per
// MODULE-GUIDE.md -- never added to the shared `apps/api/src/schemas.ts`. Every route body/query is
// validated against one of these; every response is validated against one too
// (`fastify-type-provider-zod`'s `schema.response`).
import { z } from 'zod'

export const sprintKindSchema = z.enum(['3h', 'day', 'week', 'custom'])
export const sprintStatusSchema = z.enum(['active', 'completed', 'archived'])
export const pomodoroKindSchema = z.enum(['focus', 'short_break', 'long_break'])

const idSchema = z.string().uuid()
const isoDateTime = z.iso.datetime({ offset: true })

export const sprintSchema = z.object({
  id: idSchema,
  kind: sprintKindSchema,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  goal: z.string().max(2000).nullable(),
  status: sprintStatusSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
})
export type SprintDto = z.infer<typeof sprintSchema>

export const sprintListSchema = z.array(sprintSchema)

export const createSprintBodySchema = z.object({
  kind: sprintKindSchema,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  goal: z.string().max(2000).trim().nullish(),
})

export const patchSprintBodySchema = z.object({
  goal: z.string().max(2000).trim().nullish(),
  status: sprintStatusSchema.optional(),
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional(),
  version: z.number().int(),
})

export const rolloverSprintBodySchema = z.object({
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  goal: z.string().max(2000).trim().nullish(),
})

export const taskSchema = z.object({
  id: idSchema,
  sprintId: idSchema.nullable(),
  parentId: idSchema.nullable(),
  title: z.string(),
  doneAt: isoDateTime.nullable(),
  notes: z.string().nullable(),
  sort: z.number().int(),
  estimateMin: z.number().int().nullable(),
  linkedCardId: idSchema.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
})
export type TaskDto = z.infer<typeof taskSchema>

export const taskListSchema = z.array(taskSchema)

export const createTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    sprintId: idSchema.nullish(),
    parentId: idSchema.nullish(),
    notes: z.string().max(10000).trim().nullish(),
    estimateMin: z.number().int().min(0).max(1440).nullish(),
    linkedCardId: idSchema.nullish(),
    sort: z.number().int().optional(),
    afterTaskId: idSchema.optional(),
  })
  .refine(
    (input) =>
      input.afterTaskId === undefined ||
      (input.parentId === undefined && input.sprintId === undefined && input.sort === undefined),
    {
      path: ['afterTaskId'],
      message: 'Insert-after derives its parent, period and position from the existing task',
    },
  )

export const patchTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  sprintId: idSchema.nullish(),
  parentId: idSchema.nullish(),
  done: z.boolean().optional(),
  notes: z.string().max(10000).trim().nullish(),
  estimateMin: z.number().int().min(0).max(1440).nullish(),
  linkedCardId: idSchema.nullish(),
  sort: z.number().int().optional(),
  version: z.number().int(),
})

export const reorderTasksBodySchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema,
        sort: z.number().int(),
        parentId: idSchema.nullish(),
        sprintId: idSchema.nullish(),
      }),
    )
    .min(1)
    .max(500),
})

const noteBodySchema = z.object({ text: z.string().max(20000) })

export const noteSchema = z.object({
  id: idSchema,
  title: z.string(),
  body: noteBodySchema,
  pinned: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
})
export type NoteDto = z.infer<typeof noteSchema>

export const noteListSchema = z.array(noteSchema)

export const createNoteBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: noteBodySchema.optional(),
  pinned: z.boolean().optional(),
})

export const patchNoteBodySchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  body: noteBodySchema.optional(),
  pinned: z.boolean().optional(),
  version: z.number().int(),
})

// The canvas's element/scene payload is a deliberately loose bag of shapes (TECH-SPEC §3.3's
// Excalidraw-shaped `scene jsonb`) -- validated for size and gross structure here, not element by
// element, exactly like a rich-text `body jsonb` elsewhere in this codebase. `check-secrets.mjs`/
// review still applies to whatever a client sends since it is never interpreted as anything but data.
const sceneSchema = z
  .object({
    elements: z.array(z.record(z.string(), z.unknown())).max(2000),
    appState: z.record(z.string(), z.unknown()),
  })
  .refine((v) => JSON.stringify(v).length <= 3_000_000, { message: 'Canvas scene is too large' })

const stickySchema = z.object({
  id: z.string().max(100),
  x: z.number(),
  y: z.number(),
  color: z.string().max(30),
  text: z.string().max(2000),
  rotation: z.number().optional(),
})
const stickiesSchema = z.array(stickySchema).max(200)

export const canvasSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
})
export const canvasSummaryListSchema = z.array(canvasSummarySchema)

export const canvasSchema = canvasSummarySchema.extend({
  scene: sceneSchema,
  stickies: stickiesSchema,
})
export type CanvasDto = z.infer<typeof canvasSchema>

export const createCanvasBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  scene: sceneSchema.optional(),
  stickies: stickiesSchema.optional(),
})

export const patchCanvasBodySchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  scene: sceneSchema.optional(),
  stickies: stickiesSchema.optional(),
  version: z.number().int(),
})

export const pomodoroSettingsSchema = z.object({
  focusMin: z.number().int().min(1).max(180),
  shortBreakMin: z.number().int().min(1).max(60),
  longBreakMin: z.number().int().min(1).max(120),
  cyclesBeforeLong: z.number().int().min(1).max(20),
  sound: z.enum(['chime', 'bell', 'digital', 'none']),
  notifications: z.boolean(),
  autoStart: z.boolean(),
})
export type PomodoroSettingsDto = z.infer<typeof pomodoroSettingsSchema>

export const patchPomodoroSettingsBodySchema = pomodoroSettingsSchema.partial()

export const pomodoroSessionSchema = z.object({
  id: idSchema,
  taskId: idSchema.nullable(),
  kind: pomodoroKindSchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  completed: z.boolean(),
  createdAt: isoDateTime,
})
export type PomodoroSessionDto = z.infer<typeof pomodoroSessionSchema>

export const pomodoroSessionListSchema = z.array(pomodoroSessionSchema)

export const createPomodoroSessionBodySchema = z.object({
  taskId: idSchema.nullish(),
  kind: pomodoroKindSchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullish(),
  completed: z.boolean().optional(),
})

export const patchPomodoroSessionBodySchema = z.object({
  endedAt: isoDateTime.nullish(),
  completed: z.boolean().optional(),
})

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
export type PomodoroStatsDto = z.infer<typeof pomodoroStatsSchema>
