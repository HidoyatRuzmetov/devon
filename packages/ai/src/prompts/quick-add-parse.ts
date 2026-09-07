// Quick-add parsing in four locales (TECH-SPEC §8): an enhancement behind a department flag over the
// work module's own pure `parseQuickAdd` (`apps/web/src/features/work/lib/quick-add.ts`), which only
// understands the `"Name: title, date-word"` grammar. This feature understands a full free-typed
// sentence in any of the four locales ("Ertaga Nodiraga hisobotni tayyorlashni tayinla" / "Assign
// Nodira the report by tomorrow, high priority") and always ends in a preview the person accepts or
// edits before a card is created -- this tool never creates anything itself.
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { cardPrioritySchema, localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

export const quickAddInputSchema = z.object({
  locale: localeSchema,
  text: z.string().min(1).max(500),
  /** Display names of the department's members, so the model can pick the right one instead of
   * inventing a name that merely sounds plausible (a hallucination guard, not a permission check --
   * the client re-resolves the returned name against its own member list before ever assigning
   * anyone, exactly like the existing pure-JS `resolveQuickAddAssignee` already does). */
  memberNames: z.array(z.string().min(1).max(200)).max(200).default([]),
})
export type QuickAddInput = z.infer<typeof quickAddInputSchema>

export const quickAddOutputSchema = z.object({
  title: z.string().min(1).max(500),
  /** Exactly one of `memberNames`, or `null` if the text named nobody. Never a name outside the list
   * given (the model is instructed accordingly; the client still re-validates before use). */
  assigneeName: z.string().max(200).nullable(),
  /** `YYYY-MM-DD`, or `null` if the text named no date. Deliberately date-only (no time-of-day) --
   * matches every other due-date field in this codebase (`CreateCardInput` et al). */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  priority: cardPrioritySchema,
  labels: z.array(z.string().min(1).max(60)).max(8),
})
export type QuickAddOutput = z.infer<typeof quickAddOutputSchema>

function simulate(input: QuickAddInput): QuickAddOutput {
  // Offline fallback: a small, honest heuristic (not a re-implementation of an LLM) -- good enough to
  // preview against with no key configured. Looks for a known member's name anywhere in the text and
  // a handful of locale-spanning relative-date words; everything else becomes the title verbatim.
  const lower = input.text.toLowerCase()
  const assigneeName =
    input.memberNames.find((name) => lower.includes(name.toLowerCase().split(' ')[0] ?? '')) ?? null

  const DATE_WORDS: Record<string, number> = {
    today: 0,
    bugun: 0,
    сегодня: 0,
    tomorrow: 1,
    ertaga: 1,
    завтра: 1,
  }
  let dueDate: string | null = null
  for (const [word, offsetDays] of Object.entries(DATE_WORDS)) {
    if (lower.includes(word)) {
      const d = new Date()
      d.setDate(d.getDate() + offsetDays)
      dueDate = d.toISOString().slice(0, 10)
      break
    }
  }

  const urgent = /urgent|zudlik|shosh|срочно/i.test(input.text)
  let title = input.text.trim()
  if (assigneeName) {
    const first = assigneeName.split(' ')[0] ?? assigneeName
    title = title.replace(new RegExp(first, 'i'), '').trim()
  }
  title = title.replace(/\s{2,}/g, ' ').trim() || input.text.trim()

  return {
    title,
    assigneeName,
    dueDate,
    priority: urgent ? 'urgent' : 'none',
    labels: [],
  }
}

export const quickAddParseSpec: FeatureSpec<QuickAddInput, QuickAddOutput> = {
  feature: 'quick_add_parse',
  inputSchema: quickAddInputSchema,
  outputSchema: quickAddOutputSchema,
  toolName: 'emit_quick_add',
  toolDescription:
    'Emit the structured card fields parsed from a free-typed quick-add sentence in any of four locales.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'assigneeName', 'dueDate', 'priority', 'labels'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 500 },
      assigneeName: { type: ['string', 'null'] },
      dueDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      priority: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'urgent'] },
      labels: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 8 },
    },
  },
  defaultMaxTokens: 1024,
  systemPrompt: (input) =>
    `You turn one free-typed sentence into structured department-board card fields. The sentence may be in Uzbek (Latin or Cyrillic), Russian, or English, and may mix a name, a task, a relative date word, and an urgency cue in any order. ${
      input.memberNames.length > 0
        ? `The only valid assignees are: ${input.memberNames.join(', ')}. Never invent a name that is not in this list.`
        : 'No member list was given -- always return assigneeName: null.'
    } Resolve relative dates (today/tomorrow/a weekday name in any of the three source locales) against today's date. The title must be the task itself with the name and date words removed, kept in its original language. ${localeInstruction(input.locale)} Call emit_quick_add exactly once with your answer.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
