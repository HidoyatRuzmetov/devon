// Zod schemas for the automations module (EPIC-017). The rule *body* schema itself lives in
// `@devon/contracts` (`work-plus.ts`), because the rule builder has to validate the same shape
// before it sends -- these are the response DTOs and the route params around it.
import { z } from 'zod'
import {
  automationRunStatusSchema,
  automationTriggerSchema,
  automationActionSchema,
  automationTriggerConfigSchema,
} from '@devon/contracts'

export const automationRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  trigger: automationTriggerSchema,
  triggerConfig: automationTriggerConfigSchema,
  actions: z.array(automationActionSchema),
  enabled: z.boolean(),
  runCount: z.number().int(),
  lastRunAt: z.string().nullable(),
  /** The engine's last failure message, surfaced on the rule card so a broken rule announces
   * itself instead of quietly doing nothing (CLICKUP-RESEARCH §7.3's own finding about why people
   * turn automations off). */
  lastError: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
})
export const automationRuleListSchema = z.array(automationRuleSchema)

export const automationRunSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string().uuid(),
  ruleName: z.string(),
  cardId: z.string().uuid().nullable(),
  cardTitle: z.string().nullable(),
  status: automationRunStatusSchema,
  /** Machine-readable, rendered in four locales by the client -- never prose in one language. */
  detail: z.object({
    actions: z.array(z.string()).optional(),
    reason: z.string().optional(),
    error: z.string().optional(),
  }),
  at: z.string(),
})
export const automationRunListSchema = z.object({
  items: z.array(automationRunSchema),
  nextCursor: z.string().nullable(),
})

export const runsQuerySchema = z.object({
  ruleId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

export const patchAutomationBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    triggerConfig: automationTriggerConfigSchema,
    actions: z.array(automationActionSchema).min(1).max(5),
    enabled: z.boolean(),
    version: z.number().int(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' })

export const idParamsSchema = z.object({ id: z.string().uuid() })
