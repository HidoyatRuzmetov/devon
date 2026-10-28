import { z } from 'zod'

export const checkinStateSchema = z.enum(['pending', 'done', 'blocked'])
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
  id: z.string().uuid(),
  cycleId: z.string().uuid(),
  memberUserId: z.string().uuid(),
  checklistItemId: z.string().uuid(),
  cardId: z.string().uuid(),
  cardTitle: z.string(),
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
  units: z.array(z.object({ id: z.string().uuid() })).default([]),
  members: z.array(checkinMemberSchema),
  entries: z.array(checkinEntrySchema),
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
export const checkinUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    text: z.string().trim().min(1).max(500).optional(),
    state: checkinStateSchema.optional(),
  })
  .strict()
  .refine((value) => value.text !== undefined || value.state !== undefined, 'empty change')
export const checkinLockSchema = z.object({ phase: z.enum(['checkin', 'checkout']) }).strict()
export type CheckinBoard = z.infer<typeof checkinBoardSchema>
export type CheckinEntry = z.infer<typeof checkinEntrySchema>
export type CheckinCycle = z.infer<typeof checkinCycleSchema>
export type CheckinMember = z.infer<typeof checkinMemberSchema>
