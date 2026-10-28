import { z } from 'zod'
import { createCardBodySchema } from './schemas.js'

export const plannedChecklistSchema = z
  .array(
    z
      .object({
        key: z.string().min(1).max(80),
        text: z.string().trim().min(1).max(500),
        parentKey: z.string().min(1).max(80).optional(),
        parentItemId: z.string().uuid().optional(),
      })
      .strict(),
  )
  .max(200)
  .superRefine((items, ctx) => {
    const keys = new Set<string>()
    for (const [index, item] of items.entries()) {
      if (keys.has(item.key))
        ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'duplicate checklist key' })
      if (item.parentKey && !keys.has(item.parentKey))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'parentKey'],
          message: 'parent must precede child',
        })
      if (item.parentKey && item.parentItemId)
        ctx.addIssue({ code: 'custom', path: [index], message: 'choose one parent' })
      keys.add(item.key)
    }
  })
export const cardChecklistPlanSchema = z
  .object({
    existingCardId: z.string().uuid().optional(),
    create: createCardBodySchema.optional(),
    checklist: plannedChecklistSchema,
  })
  .strict()
  .refine(
    (v) => Boolean(v.existingCardId) !== Boolean(v.create),
    'choose an existing card or create one',
  )
export const assignManySchema = z
  .object({
    recipientUserIds: z.array(z.string().uuid()).min(1).max(500),
    task: createCardBodySchema.omit({ assigneeUserId: true, giverUserId: true, orderKey: true }),
    checklist: plannedChecklistSchema.default([]),
  })
  .strict()
  .refine(
    (v) => v.recipientUserIds.length * v.checklist.length <= 2000,
    'too many checklist items in one assignment',
  )
export const workflowResultSchema = z.object({
  id: z.string().uuid(),
  cardIds: z.array(z.string().uuid()),
  created: z.number().int(),
  checklistAdded: z.number().int(),
})
export type CardChecklistPlan = z.infer<typeof cardChecklistPlanSchema>
export type AssignMany = z.infer<typeof assignManySchema>
export type PlannedChecklist = z.infer<typeof plannedChecklistSchema>
export type WorkflowResult = z.infer<typeof workflowResultSchema>
