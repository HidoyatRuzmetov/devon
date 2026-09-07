// "Plan my sprint" (TECH-SPEC §8, personal workspace, EPIC-009). Input is the caller's own open
// personal tasks -- this feature never reads `app.personal_tasks` itself; the personal-workspace
// screen that already has them loaded (owner-only, I-1) is the only caller.
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

const sprintKindSchema = z.enum(['3h', 'day', 'week', 'custom'])

const taskInputSchema = z.object({
  title: z.string().min(1).max(500),
  estimateMin: z.number().int().min(1).max(10_000).nullish(),
})

export const planSprintInputSchema = z.object({
  locale: localeSchema,
  sprintKind: sprintKindSchema,
  goal: z.string().max(1000).nullish(),
  tasks: z.array(taskInputSchema).min(1).max(100),
})
export type PlanSprintInput = z.infer<typeof planSprintInputSchema>

export const planSprintOutputSchema = z.object({
  /** Every title from `tasks`, reordered -- never a title that was not given (checked by the caller,
   * not just trusted: TECH-SPEC §8 "content is data"). */
  orderedTaskTitles: z.array(z.string().min(1).max(500)).min(1).max(100),
  /** The one task to start with right now, or `null` if `tasks` was empty (never happens given the
   * input schema's `min(1)`, kept nullable only so the schema does not lie about the impossible). */
  focusTaskTitle: z.string().max(500).nullable(),
  scheduleNote: z.string().min(1).max(1000),
})
export type PlanSprintOutput = z.infer<typeof planSprintOutputSchema>

function simulate(input: PlanSprintInput): PlanSprintOutput {
  // Offline fallback: shortest-estimate-first (a reasonable, explainable default), no estimate treated
  // as "unknown, schedule last".
  const sorted = [...input.tasks].sort((a, b) => (a.estimateMin ?? 1e9) - (b.estimateMin ?? 1e9))
  return {
    orderedTaskTitles: sorted.map((t) => t.title),
    focusTaskTitle: sorted[0]?.title ?? null,
    scheduleNote:
      'Ordered by shortest estimate first so early wins build momentum; tasks with no estimate are scheduled last.',
  }
}

export const planSprintSpec: FeatureSpec<PlanSprintInput, PlanSprintOutput> = {
  feature: 'plan_sprint',
  inputSchema: planSprintInputSchema,
  outputSchema: planSprintOutputSchema,
  toolName: 'emit_sprint_plan',
  toolDescription:
    "Emit a suggested order for one person's open personal to-dos, plus what to focus on first.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['orderedTaskTitles', 'focusTaskTitle', 'scheduleNote'],
    properties: {
      orderedTaskTitles: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { type: 'string', maxLength: 500 },
      },
      focusTaskTitle: { type: ['string', 'null'], maxLength: 500 },
      scheduleNote: { type: 'string', minLength: 1, maxLength: 1000 },
    },
  },
  defaultMaxTokens: 1280,
  systemPrompt: (input) =>
    `You help one person plan their personal ${input.sprintKind} sprint. You are given their open to-dos (title + optional time estimate in minutes) and an optional goal. Reorder the exact same set of task titles into a sensible working order (do not invent, drop, merge, or rename any task) and name the single task they should start with. Keep scheduleNote to one or two short sentences explaining the ordering logic. ${localeInstruction(input.locale)} Call emit_sprint_plan exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
