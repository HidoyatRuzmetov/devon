// Summarise a long comment thread (TECH-SPEC §8). Input is the thread the caller already has loaded
// on the card detail screen it is open on -- this feature never reads `app.card_comments` itself.
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

const commentSchema = z.object({
  id: z.string().min(1).max(200),
  author: z.string().min(1).max(200),
  text: z.string().min(1).max(4000),
})

export const summarizeThreadInputSchema = z.object({
  locale: localeSchema,
  cardTitle: z.string().min(1).max(500),
  comments: z.array(commentSchema).min(1).max(500),
})
export type SummarizeThreadInput = z.infer<typeof summarizeThreadInputSchema>

export const summarizeThreadOutputSchema = z.object({
  summary: z.string().min(1).max(1500),
  /** Ids copied verbatim from `comments` -- the guard rail (TECH-SPEC §8: "citations ... in every
   * summary") that lets the client render "based on N comments" as real links, not a vague claim. */
  citedCommentIds: z.array(z.string().min(1).max(200)).min(1).max(50),
})
export type SummarizeThreadOutput = z.infer<typeof summarizeThreadOutputSchema>

function simulate(input: SummarizeThreadInput): SummarizeThreadOutput {
  const last = input.comments.slice(-3)
  return {
    summary: `${input.comments.length} comment(s) on "${input.cardTitle}". Most recent: ${last
      .map((c) => `${c.author} -- ${c.text.slice(0, 80)}`)
      .join(' | ')}`,
    citedCommentIds: last.map((c) => c.id),
  }
}

export const summarizeThreadSpec: FeatureSpec<SummarizeThreadInput, SummarizeThreadOutput> = {
  feature: 'summarize_thread',
  inputSchema: summarizeThreadInputSchema,
  outputSchema: summarizeThreadOutputSchema,
  toolName: 'emit_thread_summary',
  toolDescription:
    'Emit a short summary of a card comment thread, citing the comment ids it is based on.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'citedCommentIds'],
    properties: {
      summary: { type: 'string', minLength: 1, maxLength: 1500 },
      citedCommentIds: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: { type: 'string', maxLength: 200 },
      },
    },
  },
  defaultMaxTokens: 1536,
  systemPrompt: (input) =>
    `You summarise a long card comment thread: what was decided, what is still open, and who committed to what. Keep it to a few sentences. citedCommentIds must only ever contain ids copied verbatim from the comments you were given -- pick the ones that most directly support your summary (typically the decisive or most recent ones), never an id you made up. ${localeInstruction(input.locale)} Call emit_thread_summary exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
