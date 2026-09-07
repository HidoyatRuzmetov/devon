// The golden set (TECH-SPEC §8/§12: "promptfoo golden sets in CI"). Each case is one real, believable
// input in one locale for one feature -- `run.ts` runs every one of them through `runFeature()` (the
// real GLM provider when `AI_API_KEY` is configured, the offline simulator otherwise) and asserts the
// output is schema-valid and, where checkable without a human, semantically sane (a returned id was
// actually given, a returned assignee name was actually in the candidate list, etc).
//
// Uzbek/Russian coverage (TECH-SPEC §12: "Uzbek/Russian golden set") is deliberate: at least one case
// per locale for every feature that takes free text, not just English.
import type { AiFeature } from '../src/types.js'

export type EvalCase = {
  id: string
  feature: AiFeature
  input: Record<string, unknown>
  /** A cheap, mechanical check beyond "the schema parsed" -- most of what this golden set is actually
   * for (a schema-valid-but-nonsensical answer is exactly the failure mode a real promptfoo run in CI
   * exists to catch once a real model is behind it). */
  check?(output: unknown): string | null // returns an error string, or null if it passed
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'quick-add.uz-latn.basic',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Latn',
      text: 'Nodiraga hisobotni ertaga topshirsin',
      memberNames: ['Nodira Karimova', 'Anvar Aliyev'],
    },
    check: (out) => {
      const o = out as { assigneeName: string | null }
      if (o.assigneeName !== null && o.assigneeName !== 'Nodira Karimova') {
        return `expected assigneeName to be "Nodira Karimova" or null, got ${String(o.assigneeName)}`
      }
      return null
    },
  },
  {
    id: 'quick-add.ru.basic',
    feature: 'quick_add_parse',
    input: {
      locale: 'ru',
      text: 'Поручить Анвару подготовить отчёт к пятнице',
      memberNames: ['Nodira Karimova', 'Anvar Aliyev'],
    },
  },
  {
    id: 'quick-add.en.no-assignee',
    feature: 'quick_add_parse',
    input: { locale: 'en', text: 'Prepare the quarterly report', memberNames: ['Nodira Karimova'] },
  },
  {
    id: 'subtasks.uz-latn.launch',
    feature: 'subtask_breakdown',
    input: {
      locale: 'uz-Latn',
      cardTitle: 'Yangi intranet sahifasini ishga tushirish',
      targetCount: 5,
    },
    check: (out) => {
      const o = out as { subtasks: string[] }
      return o.subtasks.length >= 1 ? null : 'expected at least one subtask'
    },
  },
  {
    id: 'subtasks.en.report',
    feature: 'subtask_breakdown',
    input: {
      locale: 'en',
      cardTitle: 'Prepare the quarterly report',
      cardDescription: 'Collect figures. Draft narrative. Get sign-off. Send to the ministry.',
    },
  },
  {
    id: 'plan-sprint.en.day',
    feature: 'plan_sprint',
    input: {
      locale: 'en',
      sprintKind: 'day',
      tasks: [
        { title: 'Reply to emails', estimateMin: 20 },
        { title: 'Write the report', estimateMin: 120 },
        { title: 'Team meeting', estimateMin: 30 },
      ],
    },
    check: (out) => {
      const o = out as { orderedTaskTitles: string[] }
      const given = new Set(['Reply to emails', 'Write the report', 'Team meeting'])
      return o.orderedTaskTitles.length === 3 && o.orderedTaskTitles.every((t) => given.has(t))
        ? null
        : 'orderedTaskTitles must be exactly the given titles, reordered'
    },
  },
  {
    id: 'deadline-risk.en.overdue',
    feature: 'deadline_risk',
    input: {
      locale: 'en',
      cardTitle: 'Quarterly report',
      dueDate: '2026-09-01',
      today: '2026-09-08',
      checklistTotal: 4,
      checklistDone: 1,
      daysSinceUpdate: 10,
    },
    check: (out) =>
      (out as { riskLevel: string }).riskLevel === 'high'
        ? null
        : 'an overdue, stalled card should be high risk',
  },
  {
    id: 'deadline-risk.en.on-track',
    feature: 'deadline_risk',
    input: {
      locale: 'en',
      cardTitle: 'Newsletter draft',
      dueDate: '2026-09-30',
      today: '2026-09-08',
      checklistTotal: 4,
      checklistDone: 4,
      daysSinceUpdate: 1,
    },
    check: (out) =>
      (out as { riskLevel: string }).riskLevel === 'low'
        ? null
        : 'a done, recently-touched, far-off card should be low risk',
  },
  {
    id: 'weekly-summary.ru.department',
    feature: 'weekly_summary',
    input: {
      locale: 'ru',
      scope: 'department',
      subjectName: 'Raqamli xizmatlar boshqarmasi',
      periodLabel: 'на этой неделе',
      doneCards: [{ id: 'c1', title: 'Отчёт за август' }],
      overdueCards: [{ id: 'c2', title: 'Обновление сайта' }],
      newCards: [],
    },
    check: (out) => {
      const o = out as { highlightIds: string[] }
      return o.highlightIds.every((id) => ['c1', 'c2'].includes(id))
        ? null
        : 'cited an id that was not given'
    },
  },
  {
    id: 'draft-event.uz-latn.picnic',
    feature: 'draft_event',
    input: { locale: 'uz-Latn', idea: 'Kuz sayli Chorvoqda', category: 'team_building' },
    check: (out) => {
      const o = out as { checklist: string[]; pollOptions: string[] }
      return o.checklist.length > 0 && o.pollOptions.length > 0
        ? null
        : 'expected a non-empty checklist and poll options'
    },
  },
  {
    id: 'summarize-thread.en.basic',
    feature: 'summarize_thread',
    input: {
      locale: 'en',
      cardTitle: 'Budget approval',
      comments: [
        { id: 'k1', author: 'Anvar', text: 'We agreed on the September figures.' },
        { id: 'k2', author: 'Nodira', text: 'I will send the final PDF tomorrow.' },
      ],
    },
    check: (out) => {
      const o = out as { citedCommentIds: string[] }
      return o.citedCommentIds.every((id) => ['k1', 'k2'].includes(id))
        ? null
        : 'cited a comment id that was not given'
    },
  },
  {
    id: 'nl-analytics.en.overdue-unit',
    feature: 'nl_analytics',
    input: {
      locale: 'en',
      query: "overdue cards of Data bo'limi this month",
      knownUnits: ["Data bo'limi", 'Kadrlar boʻlimi'],
    },
  },
  {
    id: 'translate.uz-latn-to-ru',
    feature: 'translate',
    input: {
      locale: 'ru',
      sourceLocale: 'uz-Latn',
      text: "Yig'ilish ertaga soat 10:00 da boshlanadi.",
    },
  },
  {
    id: 'translate.en-to-uz-cyrl',
    feature: 'translate',
    input: { locale: 'uz-Cyrl', sourceLocale: 'en', text: 'The meeting starts tomorrow at 10 AM.' },
  },
  {
    id: 'what-did-i-miss.en.basic',
    feature: 'what_did_i_miss',
    input: {
      locale: 'en',
      sinceLabel: 'last Friday',
      newCards: [{ id: 'n1', title: 'Prepare onboarding page' }],
      commentsOnMyCards: [{ id: 'n2', title: 'Budget approval' }],
      upcomingEvents: [{ id: 'n3', title: 'Autumn picnic' }],
    },
    check: (out) => {
      const o = out as { highlightIds: string[] }
      return o.highlightIds.every((id) => ['n1', 'n2', 'n3'].includes(id))
        ? null
        : 'cited an id that was not given'
    },
  },
]
