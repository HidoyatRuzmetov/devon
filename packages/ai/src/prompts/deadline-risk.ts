// Explain deadline risk (TECH-SPEC §8). Input is a snapshot of one card's own fields, already visible
// to whoever is asking on the board they are looking at -- no extra read happens here.
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

export const deadlineRiskInputSchema = z.object({
  locale: localeSchema,
  cardTitle: z.string().min(1).max(500),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checklistTotal: z.number().int().min(0).max(1000),
  checklistDone: z.number().int().min(0).max(1000),
  /** Days since the card's last activity/comment -- a stalled card is riskier than an active one even
   * at the same days-to-deadline. */
  daysSinceUpdate: z.number().int().min(0).max(3650),
})
export type DeadlineRiskInput = z.infer<typeof deadlineRiskInputSchema>

export const deadlineRiskOutputSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  explanation: z.string().min(1).max(600),
  suggestedAction: z.string().min(1).max(300),
})
export type DeadlineRiskOutput = z.infer<typeof deadlineRiskOutputSchema>

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime()
  const to = new Date(`${toIso}T00:00:00Z`).getTime()
  return Math.round((to - from) / 86_400_000)
}

function simulate(input: DeadlineRiskInput): DeadlineRiskOutput {
  const daysLeft = daysBetween(input.today, input.dueDate)
  const progressPct =
    input.checklistTotal > 0 ? (input.checklistDone / input.checklistTotal) * 100 : 0
  let riskLevel: DeadlineRiskOutput['riskLevel'] = 'low'
  if (daysLeft < 0 || (daysLeft <= 1 && progressPct < 80) || input.daysSinceUpdate > 7) {
    riskLevel = 'high'
  } else if (daysLeft <= 3 && progressPct < 50) {
    riskLevel = 'medium'
  }
  return {
    riskLevel,
    explanation: `${daysLeft} day(s) left, ${Math.round(progressPct)}% of the checklist done, last touched ${input.daysSinceUpdate} day(s) ago.`,
    suggestedAction:
      riskLevel === 'high'
        ? 'Follow up today or move the deadline.'
        : riskLevel === 'medium'
          ? 'Check in before the deadline gets close.'
          : 'No action needed yet.',
  }
}

export const deadlineRiskSpec: FeatureSpec<DeadlineRiskInput, DeadlineRiskOutput> = {
  feature: 'deadline_risk',
  inputSchema: deadlineRiskInputSchema,
  outputSchema: deadlineRiskOutputSchema,
  toolName: 'emit_deadline_risk',
  toolDescription:
    'Emit a risk level and a short, concrete explanation for whether one card will make its deadline.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['riskLevel', 'explanation', 'suggestedAction'],
    properties: {
      riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
      explanation: { type: 'string', minLength: 1, maxLength: 600 },
      suggestedAction: { type: 'string', minLength: 1, maxLength: 300 },
    },
  },
  defaultMaxTokens: 1024,
  systemPrompt: (input) =>
    `You assess whether one work-board card is at risk of missing its deadline, from its due date, checklist progress, and how long it has sat untouched. Be specific and numeric in the explanation (days left, percent done) -- never vague hand-waving. suggestedAction is one short, concrete next step, not a lecture. ${localeInstruction(input.locale)} Call emit_deadline_risk exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
