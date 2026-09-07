// Weekly summary per person and per department (TECH-SPEC §8: "drafts the digest"). The inbox
// module's digest job supplies the aggregated lists (already computed from its own reads); this
// feature only narrates them. `highlightIds` can only ever be ids that were actually given -- the
// guard rail "citations (links to cards/events) in every summary" is mechanical here, not a hope: the
// caller drops any id in the response that is not in its own input before rendering a link.
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { idTitleSchema, localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

export const weeklySummaryInputSchema = z.object({
  locale: localeSchema,
  scope: z.enum(['person', 'department']),
  subjectName: z.string().min(1).max(200),
  periodLabel: z.string().min(1).max(100),
  doneCards: z.array(idTitleSchema).max(200).default([]),
  overdueCards: z.array(idTitleSchema).max(200).default([]),
  newCards: z.array(idTitleSchema).max(200).default([]),
})
export type WeeklySummaryInput = z.infer<typeof weeklySummaryInputSchema>

export const weeklySummaryOutputSchema = z.object({
  narrative: z.string().min(1).max(1500),
  /** A subset of the ids from `doneCards`/`overdueCards`/`newCards` that the narrative actually
   * references. Validated against the input's own id set by `features.ts`'s caller-side check, not by
   * this schema alone (a schema cannot see the input it is being validated against). */
  highlightIds: z.array(z.string().min(1).max(200)).max(30),
})
export type WeeklySummaryOutput = z.infer<typeof weeklySummaryOutputSchema>

function simulate(input: WeeklySummaryInput): WeeklySummaryOutput {
  const parts: string[] = []
  if (input.doneCards.length > 0) parts.push(`${input.doneCards.length} card(s) finished`)
  if (input.overdueCards.length > 0) parts.push(`${input.overdueCards.length} overdue`)
  if (input.newCards.length > 0) parts.push(`${input.newCards.length} new`)
  const narrative =
    parts.length > 0
      ? `${input.subjectName}, ${input.periodLabel}: ${parts.join(', ')}.`
      : `${input.subjectName}, ${input.periodLabel}: no activity recorded.`
  const highlightIds = [...input.doneCards, ...input.overdueCards].slice(0, 5).map((c) => c.id)
  return { narrative, highlightIds }
}

export const weeklySummarySpec: FeatureSpec<WeeklySummaryInput, WeeklySummaryOutput> = {
  feature: 'weekly_summary',
  inputSchema: weeklySummaryInputSchema,
  outputSchema: weeklySummaryOutputSchema,
  toolName: 'emit_weekly_summary',
  toolDescription:
    'Emit a short narrative digest of one week for one person or one department, citing only the given card ids.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['narrative', 'highlightIds'],
    properties: {
      narrative: { type: 'string', minLength: 1, maxLength: 1500 },
      highlightIds: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 200 } },
    },
  },
  defaultMaxTokens: 1536,
  systemPrompt: (input) =>
    `You write a short, warm, specific weekly digest narrative for ${input.scope === 'person' ? 'one person' : 'one department'} named "${input.subjectName}" covering ${input.periodLabel}, from three lists of cards (done, overdue, new -- each item has an id and a title). Mention concrete card titles, never invent a card that is not in one of the three lists. highlightIds must only ever contain ids copied verbatim from the input lists -- never an id you made up. If all three lists are empty, say plainly that nothing happened this period; never fabricate activity. ${localeInstruction(input.locale)} Call emit_weekly_summary exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
