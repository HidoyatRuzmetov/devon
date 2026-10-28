// v1.1 SPEC §7 -- the work-plus DTOs (estimates, the light time log, dependencies, recurrence,
// templates, the focus list, reminders, capacity, workload and goals).
//
// A second schemas file rather than a longer `schemas.ts`: this module's original file is the v1.0
// card contract and is referenced by name in half a dozen comments across the codebase. Splitting on
// "what v1.1 added" keeps both files readable and makes the diff for this package one new file plus
// a handful of added lines, instead of one 500-line file nobody can review.
import {
  MAX_ESTIMATE_MINUTES,
  MAX_TIME_LOG_MINUTES,
  workTemplateKindSchema,
  workTemplateScopeSchema,
} from '@devon/contracts'
import { z } from 'zod'
import { cardPrioritySchema, cardRiskSchema, cardStatusSchema } from './schemas.js'

/** A card as a *reference*: what a dependency list, a blocked chip, a focus pin and a goal
 * breakdown all need, with none of the weight of the full DTO. */
export const cardRefSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: cardStatusSchema,
  doneAt: z.string().nullable(),
  risk: cardRiskSchema,
  dueAt: z.string().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
})
export type CardRef = z.infer<typeof cardRefSchema>

export const dependencyEntrySchema = z.object({
  id: z.string().uuid(),
  card: cardRefSchema,
})

export const cardDependenciesSchema = z.object({
  /** Cards this one waits for. */
  blockedBy: z.array(dependencyEntrySchema),
  /** Cards waiting for this one. */
  blocks: z.array(dependencyEntrySchema),
})

export const createDependencyBodySchema = z.object({
  blockedByCardId: z.string().uuid(),
})

export const timeLogEntrySchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  userId: z.string().uuid(),
  minutes: z.number().int(),
  spentOn: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
})

export const cardTimeLogSchema = z.object({
  entries: z.array(timeLogEntrySchema),
  /** Summed minutes across every person, so the card sheet can say how much of the estimate is
   * gone without the client adding the rows up itself. */
  loggedMin: z.number().int(),
  estimateMin: z.number().int().nullable(),
  /** `estimateMin - loggedMin`, floored at zero; `null` when there is no estimate to remain
   * against (a remaining figure with no estimate behind it is a made-up number). */
  remainingMin: z.number().int().nullable(),
})

export const createTimeLogBodySchema = z.object({
  minutes: z.number().int().min(1).max(MAX_TIME_LOG_MINUTES),
  spentOn: z.string().date().optional(),
  note: z.string().max(300).optional(),
})

export const cardReminderSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  remindAt: z.string(),
  note: z.string().nullable(),
  sentAt: z.string().nullable(),
})
export const cardReminderListSchema = z.array(cardReminderSchema)

export const createReminderBodySchema = z.object({
  remindAt: z.string().datetime(),
  note: z.string().max(300).optional(),
})

/**
 * A8 -- the multitask toolbar, as one request for the whole selection.
 *
 * The table view already had a bulk bar, and it fired one PATCH per card through `Promise.all`:
 * forty transactions, forty audit rows written one at a time, forty independent chances of a partial
 * result nobody can explain, and no way to undo the set as a set. One endpoint fixes all four -- and
 * returns the previous values so the undo toast puts every card back exactly, which is the house
 * rule (undo over confirm) rather than a confirmation dialog before the action.
 */
export const bulkCardPatchBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  patch: z
    .object({
      assigneeUserId: z.string().uuid().nullable(),
      priority: cardPrioritySchema,
      dueAt: z.string().datetime().nullable(),
      status: cardStatusSchema,
      estimateMin: z.number().int().min(1).max(MAX_ESTIMATE_MINUTES).nullable(),
      addLabelIds: z.array(z.string().uuid()).max(20),
      removeLabelIds: z.array(z.string().uuid()).max(20),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' }),
})

export const bulkUndoEntrySchema = z.object({
  id: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
  priority: cardPrioritySchema,
  dueAt: z.string().nullable(),
  status: cardStatusSchema,
  estimateMin: z.number().int().nullable(),
  labels: z.array(z.string().uuid()),
})

export const bulkCardResultSchema = z.object({
  updated: z.array(z.string().uuid()),
  /** Ids the server refused because this viewer does not own them -- the toast names the count, so
   * a member never wonders why twelve of fifteen moved. */
  forbidden: z.array(z.string().uuid()),
  notFound: z.array(z.string().uuid()),
  /** Per-card previous values, so the undo toast can put every one of them back exactly. */
  undo: z.array(bulkUndoEntrySchema),
})

export const bulkUndoBodySchema = z.object({
  entries: z.array(bulkUndoEntrySchema).min(1).max(200),
})

export const workTemplateSchema = z.object({
  id: z.string().uuid(),
  kind: workTemplateKindSchema,
  scope: workTemplateScopeSchema,
  ownerUserId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  useCount: z.number().int(),
  createdAt: z.string(),
  /** Server-computed: may THIS viewer edit or remove this template (its owner, or the head for a
   * department one)? The gallery never guesses a permission. */
  canManage: z.boolean(),
})
export const workTemplateListSchema = z.array(workTemplateSchema)

export const templateListQuerySchema = z.object({
  kind: workTemplateKindSchema.optional(),
})

export const createWorkTemplateBodySchema = z.object({
  kind: workTemplateKindSchema,
  scope: workTemplateScopeSchema.optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  payload: z.record(z.string(), z.unknown()),
})

export const patchWorkTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullable(),
    scope: workTemplateScopeSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' })

export const createFromCardTemplateBodySchema = z.object({
  assigneeUserId: z.string().uuid().nullable().optional(),
  giverUserId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
})

export const focusPinSchema = z.object({
  cardId: z.string().uuid(),
  position: z.number().int(),
  card: cardRefSchema,
})
export const focusListSchema = z.object({
  items: z.array(focusPinSchema),
  /** A9: five is the ceiling, returned rather than hard-coded in the client so the copy that
   * explains a refused sixth pin and the rule that refuses it are the same number. */
  max: z.number().int(),
})
export const addFocusBodySchema = z.object({ cardId: z.string().uuid() })
export const reorderFocusBodySchema = z.object({
  cardIds: z.array(z.string().uuid()).max(5),
})

export const dependencyParamsSchema = z.object({
  id: z.string().uuid(),
  depId: z.string().uuid(),
})
export const timeLogParamsSchema = z.object({
  id: z.string().uuid(),
  logId: z.string().uuid(),
})
export const reminderParamsSchema = z.object({
  id: z.string().uuid(),
  reminderId: z.string().uuid(),
})
export const cardIdParamsSchema = z.object({ cardId: z.string().uuid() })
export const userIdParamsSchema = z.object({ userId: z.string().uuid() })
export const templateIdParamsSchema = z.object({ id: z.string().uuid() })
