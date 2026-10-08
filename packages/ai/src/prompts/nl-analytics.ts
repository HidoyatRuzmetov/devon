// F8 nl_analytics (v1.1 AI-AUDIT §3 F8). "Map, then answer."
//
// The model's job is *only* stage A: turn one question into a formal query — the filter-grammar text
// (`@devon/contracts`'s `parseFilterQuery` syntax), which metric answers it, how to group it, and how
// to draw it. Stage B is not a model call at all: `/analytics` already holds every number, so the
// client computes the answer from the metric the model chose and renders it. That is what makes
// "answer with numbers" safe — there is no path by which a figure a ministry reads was generated
// rather than measured.
//
// v1.0 passed only `knownUnits`, never labels, projects or members, so `assignee:@…` — the most
// common question shape in this department — was unreachable by construction. And `chartType` was
// returned and never used.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { confidenceSchema, isoDateSchema, localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

/** The metrics `/analytics` can actually compute, named exactly as `AnalyticsSummary`'s keys are --
 * so the client's stage B is a property lookup, not a translation table that can drift. */
export const ANALYTICS_METRICS = [
  'throughput',
  'onTimeRate',
  'openVsOverdue',
  'loadPerPerson',
  'loadPerUnit',
  'projectProgress',
  'eventsParticipation',
  'pollTurnout',
] as const
export const analyticsMetricSchema = z.enum(ANALYTICS_METRICS)
export type AnalyticsMetric = z.infer<typeof analyticsMetricSchema>

export const nlAnalyticsInputSchema = z.object({
  locale: localeSchema,
  query: z.string().min(1).max(400),
  today: isoDateSchema,
  knownUnits: z.array(z.string().min(1).max(200)).max(100).default([]),
  knownLabels: z.array(z.string().min(1).max(80)).max(200).default([]),
  knownProjects: z.array(z.string().min(1).max(300)).max(100).default([]),
  knownMembers: z
    .array(z.object({ name: z.string().min(1).max(200), handle: z.string().max(100) }))
    .max(200)
    .default([]),
  dateRange: z.object({ since: isoDateSchema, until: isoDateSchema }),
})
export type NlAnalyticsInput = z.infer<typeof nlAnalyticsInputSchema>

export const nlAnalyticsOutputSchema = z.object({
  filterText: z.string().max(500),
  metric: analyticsMetricSchema.nullable(),
  groupBy: z.enum(['person', 'unit', 'project', 'label', 'status', 'none']),
  chartType: z.enum(['bar', 'line', 'pie', 'table', 'burnup']),
  /** Anything the question asked that the grammar cannot express. Never silently dropped. */
  unmappedTerms: z.array(z.string().max(80)).max(5),
  confidence: confidenceSchema,
  /** The "did I understand you" line, in the reader's own language. Replaces v1.0's `explanation`,
   * which mostly restated the filter syntax back at a non-technical user. */
  restatement: z.string().min(1).max(200),
})
export type NlAnalyticsOutput = z.infer<typeof nlAnalyticsOutputSchema>

const FEW_SHOT = `today 2026-09-12, knownUnits ["Data boʻlimi","Kadrlar boʻlimi"], knownMembers [{"Nodira Karimova","nodira"}], knownLabels ["EGDI"]

in : "Bu oy Data boʻlimining muddati oʻtgan kartochkalari"  (locale uz-Latn)
out: {"filterText":"unit:\\"Data boʻlimi\\" status:active due:<2026-09-12 due:>=2026-09-01",
 "metric":"openVsOverdue","groupBy":"none","chartType":"bar","unmappedTerms":[],"confidence":"high",
 "restatement":"Data boʻlimida shu oy muddati oʻtgan ochiq vazifalar soni"}

in : "Кто больше всех просрочил?"  (locale ru)
out: {"filterText":"status:active due:<2026-09-12","metric":"openVsOverdue","groupBy":"person",
 "chartType":"bar","unmappedTerms":[],"confidence":"high","restatement":"Кто имеет больше всего просроченных задач"}

in : "Nodira qanchalik samarali ishlayapti?"  (locale uz-Latn)
out: {"filterText":"assignee:@nodira","metric":"onTimeRate","groupBy":"none","chartType":"line",
 "unmappedTerms":["samarali"],"confidence":"low","restatement":"Nodiraning vazifalarni muddatida bajarish ulushi"}`

function systemPrompt(input: NlAnalyticsInput): string {
  return composePrompt({
    role: "You translate one analytics question about a ministry department's work board into a formal query. You answer only with the query — you never guess a number, because the product computes every figure itself from the query you return.",
    inputs: `A JSON object: query, today (${input.today}), dateRange (${input.dateRange.since} → ${input.dateRange.until}), and the closed lists below.
Units that exist: ${input.knownUnits.join(' | ') || '(none)'}
Labels that exist: ${input.knownLabels.join(' | ') || '(none)'}
Projects that exist: ${input.knownProjects.join(' | ') || '(none)'}
People that exist: ${input.knownMembers.map((m) => `${m.name} (@${m.handle})`).join(' | ') || '(none)'}
Metrics available: ${ANALYTICS_METRICS.join(', ')}`,
    instructions: [
      'filterText uses exactly this grammar and nothing else: assignee:@handle, giver:@handle, status:active|done|archived, due:<=WORD / due:>=WORD / due:WORD (WORD is today, a weekday name in any of the four locales, or YYYY-MM-DD), project:"Name", label:name, unit:"Name", plus bare words for free text. Quote any value containing a space: assignee:"@Nodira Karimova". A full name in knownMembers.handle is a permitted exact person selector.',
      'Only use unit, project and label names from the lists above, spelled exactly as they are spelled there, and only handles from the people list. Never invent one.',
      `Resolve deadline questions against today (${input.today}) with due clauses. A period of completed work is a COMPLETION period, not a deadline filter: the current report covers dateRange; if another completion period is requested, list it in unmappedTerms instead of silently substituting due dates.`,
      'metric: the one number from the list above that actually answers the question, or null when the question is a plain list of items rather than a measurement.',
      'groupBy: person, unit, project, label, status or none — what the answer should be broken down by.',
      'chartType: bar for comparisons and counts, line for a trend over time, pie for a share of a whole, table for a raw list, burnup for progress towards completion.',
      'unmappedTerms: any part of the question you could not express in the grammar — a vague adjective ("samarali", "эффективно"), an entity that does not exist, a time concept the grammar has no token for. Never silently drop it, and never let it push you into inventing a token.',
      'confidence: high only when every part of the question mapped. Anything in unmappedTerms caps you at medium; a question you largely could not map is low with an empty filterText.',
      "restatement: one sentence in the reader's own language saying what you understood them to be asking. Never the filter syntax — the person reading this is not a programmer.",
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      TONE_CONSTRAINT,
      "SHAPE. filterText itself stays in the grammar's own syntax and is never translated — it is machine text, not prose. restatement is the only field written for a human.",
    ],
    examples: FEW_SHOT,
    toolName: 'emit_analytics_query',
  })
}

// -- Offline simulator ------------------------------------------------------------------------

const RESTATEMENT: Record<Locale, Record<string, string>> = {
  'uz-Latn': {
    overdue: 'Muddati oʻtgan ochiq vazifalar soni',
    done: 'Bajarilgan vazifalar soni',
    perPerson: 'Xodimlar boʻyicha vazifa yuki',
    perUnit: 'Boʻlimlar boʻyicha vazifa yuki',
    onTime: 'Vazifalarni muddatida bajarish ulushi',
    projects: 'Loyihalarning bajarilish darajasi',
    events: 'Tadbirlarda ishtirok',
    fallback: 'Vazifalar roʻyxati',
  },
  'uz-Cyrl': {
    overdue: 'Муддати ўтган очиқ вазифалар сони',
    done: 'Бажарилган вазифалар сони',
    perPerson: 'Ходимлар бўйича вазифа юки',
    perUnit: 'Бўлимлар бўйича вазифа юки',
    onTime: 'Вазифаларни муддатида бажариш улуши',
    projects: 'Лойиҳаларнинг бажарилиш даражаси',
    events: 'Тадбирларда иштирок',
    fallback: 'Вазифалар рўйхати',
  },
  ru: {
    overdue: 'Число просроченных открытых задач',
    done: 'Число выполненных задач',
    perPerson: 'Нагрузка по сотрудникам',
    perUnit: 'Нагрузка по отделам',
    onTime: 'Доля задач, выполненных в срок',
    projects: 'Степень выполнения проектов',
    events: 'Участие в мероприятиях',
    fallback: 'Список задач',
  },
  en: {
    overdue: 'How many open items are overdue',
    done: 'How many items were completed',
    perPerson: 'Workload per person',
    perUnit: 'Workload per unit',
    onTime: 'Share of items finished on time',
    projects: 'How far each project has got',
    events: 'Event participation',
    fallback: 'A list of items',
  },
}

const VAGUE_TERMS =
  /(samarali|sifatli|yaxshi|yomon|эффективн|качествен|хорош|плох|efficient|effective|good|bad|productive)/gi

function monthBounds(today: string): { start: string; end: string } {
  const start = `${today.slice(0, 7)}-01`
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return { start, end: d.toISOString().slice(0, 10) }
}

function quote(value: string): string {
  return value.includes(' ') ? `"${value}"` : value
}

function simulate(input: NlAnalyticsInput): NlAnalyticsOutput {
  const q = input.query.toLowerCase()
  const r = RESTATEMENT[input.locale]
  const clauses: string[] = []
  let metric: AnalyticsMetric | null = null
  let groupBy: NlAnalyticsOutput['groupBy'] = 'none'
  let chartType: NlAnalyticsOutput['chartType'] = 'bar'
  let restatement = r['fallback']!

  const unit = input.knownUnits.find((name) => q.includes(name.toLowerCase().split(' ')[0] ?? name))
  if (unit) clauses.push(`unit:${quote(unit)}`)
  const project = input.knownProjects.find((name) =>
    q.includes(name.toLowerCase().split(' ')[0] ?? name),
  )
  if (project) clauses.push(`project:${quote(project)}`)
  const label = input.knownLabels.find((name) => q.includes(name.toLowerCase()))
  if (label) clauses.push(`label:${label}`)
  const member = input.knownMembers.find(
    (m) =>
      m.handle.length > 1 &&
      (q.includes(m.handle.toLowerCase()) ||
        q.includes((m.name.split(' ')[0] ?? '').toLowerCase())),
  )
  if (member) clauses.push(`assignee:${quote(`@${member.handle}`)}`)

  const overdue = /(muddat.*(oʻt|ўт|ot)|kechik|кечик|просроч|overdue|late)/i.test(input.query)
  const done = /(bajaril|ёпил|yopil|выполн|заверш|done|completed|closed)/i.test(input.query)
  const whoMost = /(kim eng|кто больше|кто чаще|who has the most|eng koʻp)/i.test(input.query)
  const onTime = /(muddatida|в срок|on time|samarali|эффективн)/i.test(input.query)

  if (overdue) {
    clauses.push('status:active', `due:<${input.today}`)
    metric = 'openVsOverdue'
    restatement = r['overdue']!
  } else if (done) {
    clauses.push('status:done')
    metric = 'throughput'
    chartType = 'line'
    restatement = r['done']!
  }
  if (whoMost) {
    metric = overdue ? 'openVsOverdue' : 'loadPerPerson'
    groupBy = 'person'
    restatement = r['perPerson']!
  } else if (unit && !overdue && !done) {
    metric = 'loadPerUnit'
    groupBy = 'unit'
    restatement = r['perUnit']!
  }
  if (onTime && !whoMost) {
    metric = 'onTimeRate'
    chartType = 'line'
    restatement = r['onTime']!
  }
  if (/(loyiha|лойиҳа|проект|project)/i.test(input.query)) {
    metric = 'projectProgress'
    groupBy = 'project'
    chartType = 'burnup'
    restatement = r['projects']!
  }
  if (/(tadbir|тадбир|мероприят|event|rsvp)/i.test(input.query)) {
    metric = 'eventsParticipation'
    chartType = 'bar'
    restatement = r['events']!
  }

  if (!done && /(bu oy|шу ой|в этом месяце|this month)/i.test(input.query)) {
    const { start, end } = monthBounds(input.today)
    clauses.push(`due:>=${start}`, `due:<=${end}`)
  }

  const unmappedTerms = [...new Set(input.query.match(VAGUE_TERMS) ?? [])].slice(0, 5)
  if (
    done &&
    /(bu oy|шу ой|в этом месяце|this month|last week|oʻtgan hafta|на прошлой неделе)/i.test(
      input.query,
    )
  )
    unmappedTerms.push(input.query.slice(0, 80))

  return {
    filterText: clauses.join(' '),
    metric,
    groupBy,
    chartType,
    unmappedTerms,
    confidence: clauses.length === 0 ? 'low' : unmappedTerms.length > 0 ? 'medium' : 'high',
    restatement,
  }
}

/** Strips every `unit:` / `project:` / `label:` / `assignee:` value the department does not have --
 * the mechanical version of "never invent one". Done with a small scanner rather than importing
 * `@devon/contracts`' parser, because this package deliberately has no runtime dependency on the
 * contracts parser's clause model and the check only needs the token values. */
function validateOutput(
  input: NlAnalyticsInput,
  output: NlAnalyticsOutput,
): ValidateOutcome<NlAnalyticsOutput> {
  const units = new Set(input.knownUnits.map((v) => v.toLowerCase()))
  const projects = new Set(input.knownProjects.map((v) => v.toLowerCase()))
  const labels = new Set(input.knownLabels.map((v) => v.toLowerCase()))
  const handles = new Set(input.knownMembers.map((m) => m.handle.toLowerCase()).filter(Boolean))

  const TOKEN = /([A-Za-z]+):"([^"]*)"|([A-Za-z]+):(\S+)|"([^"]*)"|(\S+)/g
  const kept: string[] = []
  const dropped: string[] = []
  let match: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((match = TOKEN.exec(output.filterText))) {
    const [whole, qKey, qVal, bKey, bVal] = match
    const key = (qKey ?? bKey)?.toLowerCase()
    const value = qVal ?? bVal
    if (!key || value === undefined) {
      kept.push(whole)
      continue
    }
    const lower = value.toLowerCase()
    const ok =
      key === 'unit'
        ? units.has(lower)
        : key === 'project'
          ? projects.has(lower)
          : key === 'label'
            ? labels.has(lower)
            : key === 'assignee' || key === 'giver'
              ? lower === '@me' || handles.has(lower.replace(/^@/, ''))
              : true
    if (ok) kept.push(whole)
    else dropped.push(value)
  }

  if (dropped.length === 0) return { ok: true, output }
  return {
    ok: true,
    output: {
      ...output,
      filterText: kept.join(' '),
      unmappedTerms: [...new Set([...output.unmappedTerms, ...dropped])].slice(0, 5),
      // A query that named something the department does not have was not a high-confidence read of
      // the question, whatever the model claimed.
      confidence: output.confidence === 'high' ? 'medium' : output.confidence,
    },
  }
}

export const nlAnalyticsSpec: FeatureSpec<NlAnalyticsInput, NlAnalyticsOutput> = {
  feature: 'nl_analytics',
  inputSchema: nlAnalyticsInputSchema,
  outputSchema: nlAnalyticsOutputSchema,
  toolName: 'emit_analytics_query',
  toolDescription:
    'Translate one plain-language analytics question into filter-grammar text, the metric that answers it, how to group it and how to chart it. Never a number.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [
      'filterText',
      'metric',
      'groupBy',
      'chartType',
      'unmappedTerms',
      'confidence',
      'restatement',
    ],
    properties: {
      filterText: { type: 'string', maxLength: 500 },
      metric: { type: ['string', 'null'], enum: [...ANALYTICS_METRICS, null] },
      groupBy: { type: 'string', enum: ['person', 'unit', 'project', 'label', 'status', 'none'] },
      chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'table', 'burnup'] },
      unmappedTerms: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 80 } },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      restatement: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
  defaultMaxTokens: 1024,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}
