// Break a card into subtasks (TECH-SPEC §8). Input is whatever the work module's card-detail screen
// already has loaded (title/description/existing checklist) -- this feature never reads `app.cards`
// itself (MODULE-GUIDE.md: modules stay self-contained; see this package's header note in `index.ts`).
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

export const subtaskBreakdownInputSchema = z.object({
  locale: localeSchema,
  cardTitle: z.string().min(1).max(500),
  cardDescription: z.string().max(4000).nullish(),
  existingSubtasks: z.array(z.string().min(1).max(300)).max(100).default([]),
  /** How many new subtasks to aim for -- a suggestion, not a hard cap the model must hit exactly. */
  targetCount: z.number().int().min(1).max(20).default(6),
})
export type SubtaskBreakdownInput = z.infer<typeof subtaskBreakdownInputSchema>

export const subtaskBreakdownOutputSchema = z.object({
  subtasks: z.array(z.string().min(1).max(300)).min(1).max(20),
})
export type SubtaskBreakdownOutput = z.infer<typeof subtaskBreakdownOutputSchema>

function simulate(input: SubtaskBreakdownInput): SubtaskBreakdownOutput {
  // Offline fallback: split the description into clause-sized chunks; if there is none, derive a
  // small, generic checklist shape from the title alone -- always non-empty, always schema-valid.
  const source = (input.cardDescription ?? '').trim()
  const chunks = source
    .split(/[.\n;]+|,\s+(?=[A-ZА-ЯЁЎҚҒҲ])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
  const subtasks =
    chunks.length > 0
      ? chunks.slice(0, input.targetCount)
      : [
          `Prepare: ${input.cardTitle}`,
          `Execute: ${input.cardTitle}`,
          `Review and close: ${input.cardTitle}`,
        ]
  return { subtasks: subtasks.slice(0, input.targetCount) }
}

export const subtaskBreakdownSpec: FeatureSpec<SubtaskBreakdownInput, SubtaskBreakdownOutput> = {
  feature: 'subtask_breakdown',
  inputSchema: subtaskBreakdownInputSchema,
  outputSchema: subtaskBreakdownOutputSchema,
  toolName: 'emit_subtasks',
  toolDescription: 'Emit a checklist of concrete, short, actionable subtasks for one card.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['subtasks'],
    properties: {
      subtasks: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string', minLength: 1, maxLength: 300 },
      },
    },
  },
  defaultMaxTokens: 1280,
  systemPrompt: (input) =>
    `You break one work-board card into a checklist of concrete, independently-completable subtasks. Each subtask is a short imperative phrase (a verb first), never a restatement of the whole card title, and never a subtask that is already in the existing list you are given. Aim for about ${input.targetCount} subtasks. ${localeInstruction(input.locale)} Call emit_subtasks exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
