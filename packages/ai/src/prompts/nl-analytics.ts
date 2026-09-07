// Natural-language analytics (TECH-SPEC §8): "show overdue cards of Data bo'limi this month" ->
// filter grammar + chart choice. This feature only translates into the work module's existing filter
// grammar text form (`@devon/contracts`'s `parseFilterQuery`/`serializeFilterQuery`) -- it never runs
// the query itself; the analytics screen parses the returned text with the exact same grammar every
// filter bar in the app already uses, so an AI-produced filter and a hand-typed one are indistinguishable
// to the rest of the system.
import { z } from 'zod'
import { parseFilterQuery } from '@devon/contracts'
import { localeInstruction } from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

const chartTypeSchema = z.enum(['bar', 'line', 'pie', 'table', 'burnup'])

export const nlAnalyticsInputSchema = z.object({
  locale: localeSchema,
  query: z.string().min(1).max(400),
  knownUnits: z.array(z.string().min(1).max(200)).max(200).default([]),
  knownLabels: z.array(z.string().min(1).max(100)).max(200).default([]),
  knownProjects: z.array(z.string().min(1).max(200)).max(200).default([]),
})
export type NlAnalyticsInput = z.infer<typeof nlAnalyticsInputSchema>

export const nlAnalyticsOutputSchema = z.object({
  /** The work module's filter-grammar text (`assignee:@x status:active due:<=friday ...`) --
   * `apps/api`/`apps/web` re-parse this with `parseFilterQuery`, never trust it as already-safe SQL
   * or a query plan (TECH-SPEC §8 guard rail: "content is data"). */
  filterText: z.string().min(0).max(500),
  chartType: chartTypeSchema,
  explanation: z.string().min(1).max(400),
})
export type NlAnalyticsOutput = z.infer<typeof nlAnalyticsOutputSchema>

function simulate(input: NlAnalyticsInput): NlAnalyticsOutput {
  const lower = input.query.toLowerCase()
  const clauses: string[] = []
  if (/(overdue|muddati o'tgan|muddati otgan|просрочен)/i.test(lower))
    clauses.push('due:<today status:active')
  else if (/(done|bajarilgan|выполнен)/i.test(lower)) clauses.push('status:done')
  const unit = input.knownUnits.find((u) => lower.includes(u.toLowerCase()))
  if (unit) clauses.push(`unit:"${unit}"`)
  const filterText = clauses.join(' ')
  const chartType: NlAnalyticsOutput['chartType'] = /trend|dynamics|динамик/i.test(lower)
    ? 'line'
    : /share|breakdown|доля/i.test(lower)
      ? 'pie'
      : 'bar'
  return {
    filterText,
    chartType,
    explanation: filterText
      ? `Interpreted as: ${filterText}`
      : 'Could not confidently map this to a filter -- showing everything; refine the query.',
  }
}

export const nlAnalyticsSpec: FeatureSpec<NlAnalyticsInput, NlAnalyticsOutput> = {
  feature: 'nl_analytics',
  inputSchema: nlAnalyticsInputSchema,
  outputSchema: nlAnalyticsOutputSchema,
  toolName: 'emit_analytics_query',
  toolDescription:
    'Translate one natural-language analytics question into the filter-grammar text and a chart type.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['filterText', 'chartType', 'explanation'],
    properties: {
      filterText: { type: 'string', maxLength: 500 },
      chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'table', 'burnup'] },
      explanation: { type: 'string', minLength: 1, maxLength: 400 },
    },
  },
  defaultMaxTokens: 1024,
  systemPrompt: (input) =>
    `You translate one natural-language analytics question into this exact small filter grammar: tokens "assignee:@name", "giver:@name", "status:active|done|archived", "due:<=word" / "due:>=word" / "due:word" (word is today/a weekday name/YYYY-MM-DD), 'project:"Name"', "label:name", 'unit:"Name"', plus free text for anything else. Only use unit/project/label names from the lists given (knownUnits/knownLabels/knownProjects) -- never invent one. Pick the chart type that best answers the question (bar for comparisons/counts, line for a trend over time, pie for a share/breakdown, table for a raw list, burnup for project progress over time). filterText may be empty if the question does not map to any filter. ${localeInstruction(input.locale)} (filterText itself stays in the grammar's own syntax, untranslated.) Call emit_analytics_query exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}

/** Exported so the API module can sanity-check a real model's `filterText` before ever handing it
 * back to a client (never throws -- an unrecognised token degrades to free text, per
 * `parseFilterQuery`'s own contract -- this is just a shared re-export so callers do not need their
 * own `@devon/contracts` import solely for this one check). */
export { parseFilterQuery }
