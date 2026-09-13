// The client's own Zod mirrors of every AI feature's output shape.
//
// `POST /ai/features/:feature/run` returns `data` as opaque JSON: one dynamic route cannot carry
// fourteen different typed response shapes through `fastify-type-provider-zod`, so the server's
// `runFeatureResponseSchema` declares `z.record(z.string(), z.unknown())` and says, in its own
// comment, that "the client re-validates against the matching Zod schema before use". This file is
// that schema set.
//
// It is deliberately a *duplicate* of `@devon/ai`'s per-prompt output schemas rather than an import
// of them. `apps/web` does not depend on `packages/ai` and must not start to: that package carries a
// provider, an HTTP client, a prompt corpus and an API-key-reading config loader, none of which has
// any business being reachable from a browser bundle. The same reasoning already keeps
// `apps/web/src/features/ai/types.ts` a hand-written mirror of `apps/api/src/modules/ai/schemas.ts`
// (MODULE-GUIDE.md "Web features": every feature builds its own typed endpoint functions; there is no
// shared DTO package, and there never should be).
//
// Re-validating here is not ceremony. The server already validated the model's answer, but this is
// the boundary where an *older deployed server* meets a newer client, and a preview that renders
// `undefined.map` because a field moved is a white screen in front of a civil servant.
import { z } from 'zod'
import type { AiFeatureId } from './types.js'

const localeSchema = z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en'])
const confidenceSchema = z.enum(['high', 'medium', 'low'])
// `@devon/ai`'s own `riskLevelSchema`, mirrored exactly: these are the three values
// `computeRisk()` produces on the server, not a generic severity scale. Guessing high/medium/low
// here made every `deadline_risk` call fail its input schema with a 422 -- found live.
const riskLevelSchema = z.enum(['none', 'at_risk', 'overdue'])
const prioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent'])
const idSchema = z.string().min(1)
const isoDateSchema = z.string()

export const quickAddOutputSchema = z.object({
  title: z.string(),
  assigneeUserId: idSchema.nullable(),
  dueDate: isoDateSchema.nullable(),
  priority: prioritySchema,
  labelIds: z.array(idSchema),
  projectId: idSchema.nullable(),
  confidence: z.object({
    assignee: confidenceSchema,
    dueDate: confidenceSchema,
    priority: confidenceSchema,
  }),
  ambiguous: z.array(z.string()),
  notes: z.string(),
})
export type QuickAddOutput = z.infer<typeof quickAddOutputSchema>

export const subtaskBreakdownOutputSchema = z.object({
  subtasks: z.array(
    z.object({
      text: z.string(),
      estimateMin: z.number(),
      needsApproval: z.boolean(),
    }),
  ),
  insufficientInput: z.boolean(),
})
export type SubtaskBreakdownOutput = z.infer<typeof subtaskBreakdownOutputSchema>

export const planSprintOutputSchema = z.object({
  orderedIds: z.array(idSchema),
  focusId: idSchema.nullable(),
  reasons: z.array(z.object({ id: idSchema, reason: z.string() })),
  wontFitIds: z.array(idSchema),
  overCommittedByMin: z.number(),
  summary: z.string(),
})
export type PlanSprintOutput = z.infer<typeof planSprintOutputSchema>

export const deadlineRiskOutputSchema = z.object({
  riskLevel: riskLevelSchema,
  headline: z.string(),
  explanation: z.string(),
  actionKind: z.enum([
    'move_due_date',
    'split_into_subtasks',
    'ping_assignee',
    'reassign',
    'mark_blocked',
    'none',
  ]),
  actionLabel: z.string(),
  actionPayload: z.object({ suggestedDueDate: isoDateSchema.nullable() }),
})
export type DeadlineRiskOutput = z.infer<typeof deadlineRiskOutputSchema>

const blockSchema = z.object({ text: z.string(), citedIds: z.array(idSchema) })

export const catchUpOutputSchema = z.object({
  headline: z.string(),
  wins: blockSchema,
  risks: z.array(
    z.object({
      cardId: idSchema,
      text: z.string(),
      severity: z.enum(['high', 'medium']),
    }),
  ),
  overloaded: z.array(z.object({ name: z.string(), openCount: z.number(), text: z.string() })),
  lookingAhead: blockSchema,
  items: z.array(
    z.object({
      kind: z.enum(['overdue', 'assigned', 'mention', 'comment', 'event', 'done']),
      refId: idSchema,
      text: z.string(),
      needsAction: z.boolean(),
    }),
  ),
  moreCount: z.number(),
  needsActionCount: z.number(),
})
export type CatchUpOutput = z.infer<typeof catchUpOutputSchema>

export const draftEventOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  dateOptions: z.array(
    z.object({
      date: isoDateSchema,
      startTime: z.string(),
      durationMin: z.number(),
      label: z.string(),
    }),
  ),
  checklist: z.array(z.string()),
  carpool: z.object({ needed: z.boolean(), note: z.string() }),
  estimatedAttendees: z.number(),
})
export type DraftEventOutput = z.infer<typeof draftEventOutputSchema>

export const summarizeThreadOutputSchema = z.object({
  decisions: z.array(z.object({ text: z.string(), commentIds: z.array(idSchema) })),
  openQuestions: z.array(z.object({ text: z.string(), commentId: idSchema })),
  commitments: z.array(
    z.object({
      who: z.string(),
      what: z.string(),
      byWhen: isoDateSchema.nullable(),
      commentId: idSchema,
    }),
  ),
  forViewer: z.string(),
})
export type SummarizeThreadOutput = z.infer<typeof summarizeThreadOutputSchema>

export const nlAnalyticsOutputSchema = z.object({
  filterText: z.string(),
  // `@devon/ai`'s `ANALYTICS_METRICS`, mirrored exactly. These are the names of the sections the
  // analytics screen already computes -- not a generic metric vocabulary -- which is what makes
  // "answer with the numbers" a lookup rather than a second aggregation. Guessing snake_case names
  // here silently produced a preview with no numbers in it at all; found live.
  metric: z
    .enum([
      'throughput',
      'onTimeRate',
      'openVsOverdue',
      'loadPerPerson',
      'loadPerUnit',
      'projectProgress',
      'eventsParticipation',
      'pollTurnout',
    ])
    .nullable(),
  groupBy: z.enum(['person', 'unit', 'project', 'label', 'status', 'none']),
  chartType: z.enum(['bar', 'line', 'pie', 'table', 'burnup']),
  unmappedTerms: z.array(z.string()),
  confidence: confidenceSchema,
  restatement: z.string(),
})
export type NlAnalyticsOutput = z.infer<typeof nlAnalyticsOutputSchema>

export const translateOutputSchema = z.object({
  translatedText: z.string(),
  detectedSourceLocale: localeSchema.nullable(),
  alreadyInTarget: z.boolean(),
  uncertainTerms: z.array(z.string()),
})
export type TranslateOutput = z.infer<typeof translateOutputSchema>

export const draftReplyOutputSchema = z.object({
  draft: z.string(),
  tone: z.enum(['neutral', 'formal', 'brief']),
  answers: z.array(idSchema),
  stillNeeded: z.array(z.string()),
})
export type DraftReplyOutput = z.infer<typeof draftReplyOutputSchema>

export const boardRiskDigestOutputSchema = z.object({
  headline: z.string(),
  entries: z.array(
    z.object({
      cardId: idSchema,
      rank: z.number(),
      reason: z.string(),
      suggestedAction: z.enum([
        'move_due_date',
        'ping_assignee',
        'split_into_subtasks',
        'reassign',
        'mark_blocked',
      ]),
    }),
  ),
  pressurePoints: z.array(z.object({ name: z.string(), text: z.string() })),
})
export type BoardRiskDigestOutput = z.infer<typeof boardRiskDigestOutputSchema>

export const suggestAssigneeOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      userId: idSchema,
      rank: z.number(),
      reason: z.string(),
      loadWarning: z.string(),
      confidence: confidenceSchema,
    }),
  ),
  note: z.string(),
})
export type SuggestAssigneeOutput = z.infer<typeof suggestAssigneeOutputSchema>

export const duplicateCheckOutputSchema = z.object({
  matches: z.array(
    z.object({
      cardId: idSchema,
      relation: z.enum(['duplicate', 'related']),
      reason: z.string(),
    }),
  ),
  verdict: z.enum(['duplicate', 'related_only', 'none']),
})
export type DuplicateCheckOutput = z.infer<typeof duplicateCheckOutputSchema>

export const semanticAskOutputSchema = z.object({
  answer: z.string(),
  answered: z.boolean(),
  citations: z.array(z.string()),
  followUp: z.string(),
})
export type SemanticAskOutput = z.infer<typeof semanticAskOutputSchema>

/** Keyed by feature id so a caller that already has the id can validate without a switch. */
export const FEATURE_OUTPUT_SCHEMAS: Record<AiFeatureId, z.ZodTypeAny> = {
  quick_add_parse: quickAddOutputSchema,
  subtask_breakdown: subtaskBreakdownOutputSchema,
  plan_sprint: planSprintOutputSchema,
  deadline_risk: deadlineRiskOutputSchema,
  catch_up: catchUpOutputSchema,
  draft_event: draftEventOutputSchema,
  summarize_thread: summarizeThreadOutputSchema,
  nl_analytics: nlAnalyticsOutputSchema,
  translate: translateOutputSchema,
  draft_reply: draftReplyOutputSchema,
  board_risk_digest: boardRiskDigestOutputSchema,
  suggest_assignee: suggestAssigneeOutputSchema,
  duplicate_check: duplicateCheckOutputSchema,
  semantic_ask: semanticAskOutputSchema,
}

/**
 * Validate an opaque `data` payload against the feature it claims to be from. Returns `null` rather
 * than throwing: a preview that cannot render is a discarded preview, never a crashed screen.
 */
export function parseFeatureOutput<T>(feature: AiFeatureId, data: unknown): T | null {
  const parsed = FEATURE_OUTPUT_SCHEMAS[feature].safeParse(data)
  return parsed.success ? (parsed.data as T) : null
}
