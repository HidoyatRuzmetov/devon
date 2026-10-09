import { z } from 'zod'

/** A receipt is bound to one persisted owner-only deletion, not to an item forever. */
export const personalDeleteReceiptSchema = z.object({ restoreToken: z.string().uuid() })
export const personalRestoreBodySchema = personalDeleteReceiptSchema
export type PersonalDeleteReceipt = z.infer<typeof personalDeleteReceiptSchema>
export type PersonalRestoreBody = z.infer<typeof personalRestoreBodySchema>

/** Acknowledges only revisions minted by this committed mutation, never a later read. */
export const personalTaskVersionChangeSchema = z
  .object({
    id: z.string().uuid(),
    beforeVersion: z.number().int().positive(),
    afterVersion: z.number().int().positive(),
  })
  .refine((change) => change.afterVersion === change.beforeVersion + 1)
export const personalTaskVersionsQuerySchema = z.object({ versions: z.literal('true').optional() })
export type PersonalTaskVersionChange = z.infer<typeof personalTaskVersionChangeSchema>
