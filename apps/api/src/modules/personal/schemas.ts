// Zod schemas for the personal workspace's endpoints (TECH-SPEC §3.3), module-owned per
// MODULE-GUIDE.md -- never added to the shared `apps/api/src/schemas.ts`. Every route body/query is
// validated against one of these; every response is validated against one too
// (`fastify-type-provider-zod`'s `schema.response`).
import { z } from 'zod'

export const pomodoroKindSchema = z.enum(['focus', 'short_break', 'long_break'])
const idSchema = z.string().uuid()
const isoDateTime = z.iso.datetime({ offset: true })

export const taskSchema = z.object({
  id: idSchema,
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
    parentId: idSchema.nullish(),
    notes: z.string().max(10000).trim().nullish(),
    estimateMin: z.number().int().min(0).max(1440).nullish(),
    linkedCardId: idSchema.nullish(),
    sort: z.number().int().optional(),
    afterTaskId: idSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.afterTaskId === undefined || (input.parentId === undefined && input.sort === undefined),
    {
      path: ['afterTaskId'],
      message: 'Insert-after derives its parent and position from the existing task',
    },
  )

export const patchTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    parentId: idSchema.nullish(),
    done: z.boolean().optional(),
    notes: z.string().max(10000).trim().nullish(),
    estimateMin: z.number().int().min(0).max(1440).nullish(),
    linkedCardId: idSchema.nullish(),
    sort: z.number().int().optional(),
    version: z.number().int(),
  })
  .strict()

export const reorderTasksBodySchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema,
        sort: z.number().int(),
        parentId: idSchema.nullish(),
      }),
    )
    .min(1)
    .max(500),
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

  kind: pomodoroKindSchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  completed: z.boolean(),
  createdAt: isoDateTime,
})
export type PomodoroSessionDto = z.infer<typeof pomodoroSessionSchema>

export const pomodoroSessionListSchema = z.array(pomodoroSessionSchema)

export const createPomodoroSessionBodySchema = z.object({
  kind: pomodoroKindSchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullish(),
  completed: z.boolean().optional(),
})

export const patchPomodoroSessionBodySchema = z.object({
  endedAt: isoDateTime.nullish(),
  completed: z.boolean().optional(),
})
