// EPIC-017 -- typed client for the automations module. The rule *body* schema itself comes from
// `@devon/contracts` (`automationRuleBodySchema`), because the rule builder validates the same shape
// the server refuses with; these are the response DTOs around it.
import { z } from 'zod'
import {
  automationActionSchema,
  automationRunStatusSchema,
  automationTriggerConfigSchema,
  automationTriggerSchema,
  type AutomationRuleBody,
} from '@devon/contracts'
import { apiClient } from '../../lib/api-client.js'

export const automationRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: automationTriggerSchema,
  triggerConfig: automationTriggerConfigSchema,
  actions: z.array(automationActionSchema),
  enabled: z.boolean(),
  runCount: z.number().int(),
  lastRunAt: z.string().nullable(),
  /** The engine's last failure, surfaced on the rule card so a broken rule announces itself instead
   * of quietly doing nothing -- CLICKUP-RESEARCH §7.3's finding about why people turn automations
   * off is precisely that they cannot tell a silent rule from a broken one. */
  lastError: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
})
export type AutomationRule = z.infer<typeof automationRuleSchema>
export const automationRuleListSchema = z.array(automationRuleSchema)

export const automationRunSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  cardId: z.string().nullable(),
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
export type AutomationRun = z.infer<typeof automationRunSchema>

export const automationRunListSchema = z.object({
  items: z.array(automationRunSchema),
  nextCursor: z.string().nullable(),
  /** How many runs the filter matches, department-wide -- not how many this page carries. See the
   * API schema's own comment: reporting the page's length as "the number of runs" is how the log
   * came to contradict the rule card above it (v1.1 recapture #9). */
  total: z.number().int().min(0),
})
export type AutomationRunList = z.infer<typeof automationRunListSchema>

const idResultSchema = z.object({ id: z.string() })

export function fetchAutomationRules(): Promise<AutomationRule[]> {
  return apiClient.get('/api/v1/automations', automationRuleListSchema)
}

export function createAutomationRule(
  body: AutomationRuleBody,
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post('/api/v1/automations', body, idResultSchema, csrfToken)
}

export async function patchAutomationRule(
  id: string,
  patch: Partial<{
    name: string
    triggerConfig: AutomationRuleBody['triggerConfig']
    actions: AutomationRuleBody['actions']
    enabled: boolean
    version: number
  }>,
  csrfToken: string,
): Promise<void> {
  await apiClient.patch(`/api/v1/automations/${encodeURIComponent(id)}`, patch, z.void(), csrfToken)
}

export async function deleteAutomationRule(id: string, csrfToken: string): Promise<void> {
  await apiClient.delete(`/api/v1/automations/${encodeURIComponent(id)}`, csrfToken)
}

export type RunsQuery = {
  ruleId?: string
  status?: AutomationRun['status']
  limit?: number
  cursor?: string
}

export function fetchAutomationRuns(query: RunsQuery = {}): Promise<AutomationRunList> {
  const params = new URLSearchParams()
  if (query.ruleId) params.set('ruleId', query.ruleId)
  if (query.status) params.set('status', query.status)
  if (query.limit) params.set('limit', String(query.limit))
  if (query.cursor) params.set('cursor', query.cursor)
  const qs = params.toString()
  return apiClient.get(`/api/v1/automations/runs${qs ? `?${qs}` : ''}`, automationRunListSchema)
}

/** The kill switch (SPEC §7): one click disables every rule in the department. Answers with how many
 * it changed, so the toast can say so rather than claiming a number it guessed. */
export function pauseAllAutomations(csrfToken: string): Promise<{ changed: number }> {
  return apiClient.post(
    '/api/v1/automations/pause-all',
    { enabled: false },
    z.object({ changed: z.number().int() }),
    csrfToken,
  )
}
