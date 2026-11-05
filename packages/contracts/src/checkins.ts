import { z } from 'zod'
import { WORK_TITLE_MAX } from './work-limits.js'

export const checkinStateSchema = z.enum(['pending', 'done', 'blocked'])
export const checkinPrioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent'])
export const checkinLayoutSchema = z.object({
  cycleId: z.string().uuid(),
  memberUserId: z.string().uuid(),
  mode: z.enum(['priority', 'manual']),
  cardIds: z.array(z.string().uuid()),
  version: z.number().int(),
})
export const checkinSourceCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  priority: checkinPrioritySchema,
  projectId: z.string().uuid().nullable(),
  projectTitle: z.string().nullable(),
  version: z.number().int(),
  canEdit: z.boolean(),
  checklist: z.array(
    z.object({
      id: z.string().uuid(),
      text: z.string(),
      doneAt: z.string().nullable(),
      parentItemId: z.string().uuid().nullable(),
      version: z.number().int(),
      textLocked: z.boolean(),
      deletionProtected: z.boolean(),
      commentCount: z.number().int().nonnegative().default(0),
    }),
  ),
})
export const checkinSelectionSchema = z
  .object({
    addItemIds: z.array(z.string().uuid()).max(1000),
    removeEntryIds: z.array(z.string().uuid()).max(1000),
  })
  .strict()
export const checkinLayoutWriteSchema = z
  .object({
    mode: z.enum(['priority', 'manual']),
    cardIds: z.array(z.string().uuid()).max(1000),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .refine((v) => new Set(v.cardIds).size === v.cardIds.length, 'Duplicate cards')
export const checkinCycleSchema = z.object({
  id: z.string().uuid(),
  startsOn: z.string(),
  endsOn: z.string(),
  checkinLockedAt: z.string().nullable(),
  checkoutLockedAt: z.string().nullable(),
})
export const checkinMemberSchema = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  avatarKey: z.string().nullable(),
  unitId: z.string().uuid().nullable(),
  unitName: z.string().nullable(),
  unitColour: z.number().int().nullable(),
})
export const checkinEntrySchema = z.object({
  commentCount: z.number().int().nonnegative().default(0),
  id: z.string().uuid(),
  cycleId: z.string().uuid(),
  memberUserId: z.string().uuid(),
  checklistItemId: z.string().uuid(),
  cardId: z.string().uuid(),
  cardTitle: z.string(),
  cardPriority: checkinPrioritySchema.default('none'),
  cardVersion: z.number().int().nullable().default(null),
  canEditCard: z.boolean().default(false),
  textLocked: z.boolean().default(false),
  projectId: z.string().uuid().nullable(),
  projectTitle: z.string().nullable(),
  text: z.string(),
  state: checkinStateSchema,
  version: z.number().int(),
  sourceAvailable: z.boolean(),
})
export const checkinBoardSchema = z.object({
  currentCycleId: z.string().uuid(),
  selectedCycleId: z.string().uuid(),
  cycles: z.array(checkinCycleSchema),
  memberLocks: z.array(
    z.object({
      cycleId: z.string().uuid(),
      memberUserId: z.string().uuid(),
      checkinLockedAt: z.string().nullable(),
      checkoutLockedAt: z.string().nullable(),
    }),
  ),
  units: z.array(z.object({ id: z.string().uuid() })).default([]),
  members: z.array(checkinMemberSchema),
  entries: z.array(checkinEntrySchema),
  layouts: z.array(checkinLayoutSchema).default([]),
  progress: z.array(
    z.object({
      cycleId: z.string().uuid(),
      memberUserId: z.string().uuid(),
      done: z.number().int(),
      total: z.number().int(),
    }),
  ),
})
export const checkinAddSchema = z.object({ checklistItemId: z.string().uuid() }).strict()
export const checkinCreateTaskSchema = z
  .object({
    operationId: z.uuid(),
    title: z.string().trim().min(1).max(WORK_TITLE_MAX),
    priority: checkinPrioritySchema.default('none'),
    checklist: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  })
  .strict()
export type CheckinCreateTask = z.infer<typeof checkinCreateTaskSchema>
export const checkinUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    text: z.string().trim().min(1).max(500).optional(),
    state: checkinStateSchema.optional(),
  })
  .strict()
  .refine((value) => value.text !== undefined || value.state !== undefined, 'empty change')
export const checkinLockSchema = z
  .object({
    phase: z.enum(['checkin', 'checkout']),
    memberUserId: z.string().uuid(),
  })
  .strict()
export type CheckinBoard = z.infer<typeof checkinBoardSchema>
export type CheckinEntry = z.infer<typeof checkinEntrySchema>
export type CheckinCycle = z.infer<typeof checkinCycleSchema>
export type CheckinMember = z.infer<typeof checkinMemberSchema>
export type CheckinSourceCard = z.infer<typeof checkinSourceCardSchema>
export type CheckinSelection = z.infer<typeof checkinSelectionSchema>
export type CheckinLayoutWrite = z.infer<typeof checkinLayoutWriteSchema>
