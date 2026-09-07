// Draft an event from one line (TECH-SPEC §8): description, checklist, poll options, carpool plan.
// The events module's "new event" screen calls this, previews the result, and lets the organiser edit
// every field before actually creating anything -- this tool never creates an event itself.
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

const eventCategorySchema = z.enum([
  'team_building',
  'sports',
  'volunteering',
  'social',
  'training',
  'family',
  'other',
])

export const draftEventInputSchema = z.object({
  locale: localeSchema,
  idea: z.string().min(1).max(500),
  category: eventCategorySchema.nullish(),
})
export type DraftEventInput = z.infer<typeof draftEventInputSchema>

export const draftEventOutputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  checklist: z.array(z.string().min(1).max(300)).max(20),
  pollOptions: z.array(z.string().min(1).max(200)).max(10),
  carpoolPlan: z.string().min(1).max(600),
})
export type DraftEventOutput = z.infer<typeof draftEventOutputSchema>

function simulate(input: DraftEventInput): DraftEventOutput {
  return {
    title: input.idea.length <= 80 ? input.idea : `${input.idea.slice(0, 77)}...`,
    description: `${input.idea}. Details to be confirmed -- edit this draft before sending invitations.`,
    checklist: [
      'Confirm the venue',
      'Send the invitation',
      'Confirm headcount',
      'Arrange transport if needed',
    ],
    pollOptions: ['This Friday', 'Next Friday', 'A weekend day'],
    carpoolPlan:
      'Ask each attendee whether they can drive and how many seats they have free; match riders to the nearest driver by neighbourhood.',
  }
}

export const draftEventSpec: FeatureSpec<DraftEventInput, DraftEventOutput> = {
  feature: 'draft_event',
  inputSchema: draftEventInputSchema,
  outputSchema: draftEventOutputSchema,
  toolName: 'emit_event_draft',
  toolDescription:
    'Emit a full event draft (description, checklist, poll options, carpool plan) from a one-line idea.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'checklist', 'pollOptions', 'carpoolPlan'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 1, maxLength: 2000 },
      checklist: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
      pollOptions: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 } },
      carpoolPlan: { type: 'string', minLength: 1, maxLength: 600 },
    },
  },
  defaultMaxTokens: 1536,
  systemPrompt: (input) =>
    `You turn one short event idea${input.category ? ` (category: ${input.category})` : ''} into a complete draft: a title, a friendly one- or two-paragraph description, an organiser checklist (venue/invites/headcount/etc, 4-8 items), 2-5 poll options for scheduling it (dates or times, not yes/no), and a short carpool coordination plan. This is always a draft the organiser reviews and edits before anything is sent -- be concrete and specific to the idea given, never generic filler. ${localeInstruction(input.locale)} Call emit_event_draft exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
