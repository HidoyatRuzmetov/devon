// Zod schemas for the projects module (TECH-SPEC §3.2, EPIC-005).
import { z } from 'zod'

export const projectStatusSchema = z.enum(['planning', 'active', 'on_hold', 'done', 'archived'])
const dateSchema = z.iso.date()

export const milestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueOn: z.string().nullable(),
  doneAt: z.string().nullable(),
})

export const projectSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.object({ format: z.literal('markdown'), text: z.string() }).nullable(),
  colour: z.string(),
  coverKey: z.string().nullable(),
  ownerUserId: z.string().uuid(),
  members: z.array(z.string().uuid()),
  status: projectStatusSchema,
  startOn: z.string().nullable(),
  targetOn: z.string().nullable(),
  milestones: z.array(milestoneSchema),
  progress: z.number().min(0).max(1),
  objectiveTotal: z.number().int(),
  objectiveDone: z.number().int(),
  subjectiveTotal: z.number().int(),
  subjectiveDone: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type ProjectDTO = z.infer<typeof projectSchema>

export const projectListSchema = z.array(projectSchema)

export const createProjectBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).optional(),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  ownerUserId: z.string().uuid(),
  members: z.array(z.string().uuid()).min(1),
  status: projectStatusSchema.optional(),
  startOn: dateSchema.optional(),
  targetOn: dateSchema.optional(),
  milestones: z
    .array(z.object({ title: z.string().min(1), dueOn: z.string().nullable() }))
    .optional(),
})

export const patchProjectBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000).nullable(),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    ownerUserId: z.string().uuid(),
    members: z.array(z.string().uuid()).min(1),
    status: projectStatusSchema,
    startOn: dateSchema.nullable(),
    targetOn: dateSchema.nullable(),
    version: z.number().int(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' })

export const addMilestoneBodySchema = z.object({
  title: z.string().min(1).max(200),
  dueOn: z.string().nullable().optional(),
})

export const patchMilestoneBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  dueOn: z.string().nullable().optional(),
  done: z.boolean().optional(),
})

export const idParamsSchema = z.object({ id: z.string().uuid() })
export const createFromCardBodySchema = z
  .object({
    cardId: z.string().uuid(),
    members: z.array(z.string().uuid()).min(1),
  })
  .strict()
export const milestoneParamsSchema = z.object({ id: z.string().uuid(), milestoneId: z.string() })

export const templateSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  milestones: z.array(z.object({ title: z.string(), offsetDays: z.number().int() })),
})
export const templateListSchema = z.array(templateSchema)

export const createFromTemplateBodySchema = z.object({
  templateKey: z.string(),
  title: z.string().min(1).max(200).optional(),
  ownerUserId: z.string().uuid(),
  members: z.array(z.string().uuid()).min(1),
  startOn: dateSchema.optional(),
})
