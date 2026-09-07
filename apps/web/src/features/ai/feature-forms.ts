// Data-driven form descriptors for the assistant panel (`assistant-panel.tsx`): one entry per
// TECH-SPEC §8 feature, so the panel does not need ten hand-built forms -- each descriptor says what
// fields to render and how to turn their raw string values into the JSON `input` the feature's own
// Zod `inputSchema` (`@devon/ai`) expects. `locale` is added by the panel itself (from `useLocale()`),
// never listed here, so every feature answers in the viewer's own language by default.
import type { AiFeatureId } from './types.js'

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'localeSelect'
  | 'stringList' // one item per line -> string[]
  | 'idTitleList' // one "id | title" per line -> {id, title}[]

export type FieldSpec = {
  key: string
  labelKey: string
  kind: FieldKind
  placeholderKey?: string
  /** Only for `kind: 'textarea'|'text'` -- a starting value so the panel is never a totally blank
   * page the first time someone opens a tab (DESIGN.md: every empty state offers a way forward). */
  sampleKey?: string
  optional?: boolean
}

export type FeatureFormSpec = {
  feature: AiFeatureId
  labelKey: string
  descriptionKey: string
  fields: readonly FieldSpec[]
}

function stringListToLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function idTitleListToItems(value: string): { id: string; title: string }[] {
  return stringListToLines(value).map((line, i) => {
    const [idPart, ...rest] = line.split('|')
    const title = rest.join('|').trim()
    return { id: (idPart ?? '').trim() || `row-${i + 1}`, title: title || (idPart ?? '').trim() }
  })
}

/** Turns the panel's raw `Record<string, string>` field values into the JSON body the feature's own
 * schema expects, per `field.kind`. Never validates -- `@devon/ai`'s `inputSchema` does that
 * server-side, and the panel shows whatever `validation_failed` Problem comes back. */
export function buildFeatureInput(
  spec: FeatureFormSpec,
  values: Record<string, string>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const field of spec.fields) {
    const raw = values[field.key] ?? ''
    if (field.optional && raw.trim().length === 0) continue
    switch (field.kind) {
      case 'text':
      case 'localeSelect':
        input[field.key] = raw
        break
      case 'textarea':
        input[field.key] = raw
        break
      case 'number':
        input[field.key] = raw.trim() === '' ? undefined : Number(raw)
        break
      case 'stringList':
        input[field.key] = stringListToLines(raw)
        break
      case 'idTitleList':
        input[field.key] = idTitleListToItems(raw)
        break
    }
  }
  return input
}

export const FEATURE_FORMS: readonly FeatureFormSpec[] = [
  {
    feature: 'translate',
    labelKey: 'ai.features.translate.label',
    descriptionKey: 'ai.features.translate.description',
    fields: [
      {
        key: 'text',
        labelKey: 'ai.fields.text',
        kind: 'textarea',
        sampleKey: 'ai.samples.translate',
      },
    ],
  },
  {
    feature: 'quick_add_parse',
    labelKey: 'ai.features.quickAddParse.label',
    descriptionKey: 'ai.features.quickAddParse.description',
    fields: [
      { key: 'text', labelKey: 'ai.fields.text', kind: 'text', sampleKey: 'ai.samples.quickAdd' },
      {
        key: 'memberNames',
        labelKey: 'ai.fields.memberNames',
        kind: 'stringList',
        sampleKey: 'ai.samples.memberNames',
        optional: true,
      },
    ],
  },
  {
    feature: 'subtask_breakdown',
    labelKey: 'ai.features.subtaskBreakdown.label',
    descriptionKey: 'ai.features.subtaskBreakdown.description',
    fields: [
      { key: 'cardTitle', labelKey: 'ai.fields.cardTitle', kind: 'text' },
      {
        key: 'cardDescription',
        labelKey: 'ai.fields.cardDescription',
        kind: 'textarea',
        optional: true,
      },
    ],
  },
  {
    feature: 'draft_event',
    labelKey: 'ai.features.draftEvent.label',
    descriptionKey: 'ai.features.draftEvent.description',
    fields: [
      { key: 'idea', labelKey: 'ai.fields.idea', kind: 'text', sampleKey: 'ai.samples.event' },
    ],
  },
  {
    feature: 'nl_analytics',
    labelKey: 'ai.features.nlAnalytics.label',
    descriptionKey: 'ai.features.nlAnalytics.description',
    fields: [
      {
        key: 'query',
        labelKey: 'ai.fields.query',
        kind: 'text',
        sampleKey: 'ai.samples.analytics',
      },
      { key: 'knownUnits', labelKey: 'ai.fields.knownUnits', kind: 'stringList', optional: true },
    ],
  },
  {
    feature: 'deadline_risk',
    labelKey: 'ai.features.deadlineRisk.label',
    descriptionKey: 'ai.features.deadlineRisk.description',
    fields: [
      { key: 'cardTitle', labelKey: 'ai.fields.cardTitle', kind: 'text' },
      {
        key: 'dueDate',
        labelKey: 'ai.fields.dueDate',
        kind: 'text',
        sampleKey: 'ai.samples.dueDate',
      },
      { key: 'today', labelKey: 'ai.fields.today', kind: 'text', sampleKey: 'ai.samples.today' },
      { key: 'checklistTotal', labelKey: 'ai.fields.checklistTotal', kind: 'number' },
      { key: 'checklistDone', labelKey: 'ai.fields.checklistDone', kind: 'number' },
      { key: 'daysSinceUpdate', labelKey: 'ai.fields.daysSinceUpdate', kind: 'number' },
    ],
  },
  {
    feature: 'summarize_thread',
    labelKey: 'ai.features.summarizeThread.label',
    descriptionKey: 'ai.features.summarizeThread.description',
    fields: [
      { key: 'cardTitle', labelKey: 'ai.fields.cardTitle', kind: 'text' },
      {
        key: 'comments',
        labelKey: 'ai.fields.comments',
        kind: 'idTitleList',
        placeholderKey: 'ai.placeholders.commentLines',
      },
    ],
  },
  {
    feature: 'weekly_summary',
    labelKey: 'ai.features.weeklySummary.label',
    descriptionKey: 'ai.features.weeklySummary.description',
    fields: [
      { key: 'subjectName', labelKey: 'ai.fields.subjectName', kind: 'text' },
      {
        key: 'periodLabel',
        labelKey: 'ai.fields.periodLabel',
        kind: 'text',
        sampleKey: 'ai.samples.period',
      },
      {
        key: 'doneCards',
        labelKey: 'ai.fields.doneCards',
        kind: 'idTitleList',
        optional: true,
        placeholderKey: 'ai.placeholders.cardLines',
      },
      {
        key: 'overdueCards',
        labelKey: 'ai.fields.overdueCards',
        kind: 'idTitleList',
        optional: true,
        placeholderKey: 'ai.placeholders.cardLines',
      },
      {
        key: 'newCards',
        labelKey: 'ai.fields.newCards',
        kind: 'idTitleList',
        optional: true,
        placeholderKey: 'ai.placeholders.cardLines',
      },
    ],
  },
  {
    feature: 'what_did_i_miss',
    labelKey: 'ai.features.whatDidIMiss.label',
    descriptionKey: 'ai.features.whatDidIMiss.description',
    fields: [
      {
        key: 'sinceLabel',
        labelKey: 'ai.fields.sinceLabel',
        kind: 'text',
        sampleKey: 'ai.samples.since',
      },
      {
        key: 'newCards',
        labelKey: 'ai.fields.newCards',
        kind: 'idTitleList',
        optional: true,
        placeholderKey: 'ai.placeholders.cardLines',
      },
      {
        key: 'commentsOnMyCards',
        labelKey: 'ai.fields.commentsOnMyCards',
        kind: 'idTitleList',
        optional: true,
        placeholderKey: 'ai.placeholders.cardLines',
      },
      {
        key: 'upcomingEvents',
        labelKey: 'ai.fields.upcomingEvents',
        kind: 'idTitleList',
        optional: true,
        placeholderKey: 'ai.placeholders.cardLines',
      },
    ],
  },
  {
    feature: 'plan_sprint',
    labelKey: 'ai.features.planSprint.label',
    descriptionKey: 'ai.features.planSprint.description',
    fields: [
      { key: 'goal', labelKey: 'ai.fields.goal', kind: 'text', optional: true },
      {
        key: 'tasks',
        labelKey: 'ai.fields.tasks',
        kind: 'idTitleList',
        placeholderKey: 'ai.placeholders.taskLines',
      },
    ],
  },
]

/** `plan_sprint`'s `tasks` field is `{title, estimateMin?}[]`, not `{id, title}[]` like every
 * citation-bearing feature -- reuses the same "one per line" textarea UX (`idTitleListToItems`) and
 * remaps `id` -> `title` here rather than inventing a fourth field kind for one feature. */
export function remapPlanSprintTasks(input: Record<string, unknown>): Record<string, unknown> {
  const tasks = input['tasks']
  if (!Array.isArray(tasks)) return input
  return {
    ...input,
    tasks: tasks.map((t: { id: string; title: string }) => ({ title: t.title || t.id })),
    sprintKind: 'day',
  }
}
