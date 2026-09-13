// v1.1 SPEC §7 (ClickUp adoptions A3, A7, A10, A11, EPIC-017): the work types both sides of the wire
// share -- estimates, recurrence, dependencies, goals and automation rules.
//
// Why here and not in `apps/api/src/modules/work/schemas.ts`: every one of these is a *rule* the
// client has to understand as well as the server. The client parses "2 soat 30 daqiqa" into minutes
// before it ever sends a PATCH (so the field can echo what it understood); the rule builder has to
// know which actions a trigger allows before the server refuses the combination; the dependency
// picker has to grey out the cards that would close a cycle before the user clicks. Duplicating any
// of that would be exactly the drift `@devon/contracts` exists to prevent (I-7 in spirit: one
// definition, two readers).
//
// Pure: zod and nothing else, like every other file in this package. No dates are formatted here --
// formatting is locale work and belongs to `@devon/i18n`; this file only ever returns numbers,
// `Date`s and structured records the caller renders.
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// A3 -- time estimates and the light time log
// ---------------------------------------------------------------------------------------------

/** A working day, for "3 kun" style estimates. Deliberately 8 and not 24: a civil servant typing
 * "3 kun" means three working days, not seventy-two hours, and the workload view's capacity is
 * counted in working hours too (`DEFAULT_WEEKLY_CAPACITY_HOURS`). */
export const HOURS_PER_WORKING_DAY = 8

/** SPEC §7 (A4): the default a person's week is measured against until the head (or the person
 * themselves) overrides it. Five working days at eight hours. */
export const DEFAULT_WEEKLY_CAPACITY_HOURS = 40

/** Hard ceiling on one card's estimate, so a mistyped "8000" cannot paint a whole workload week red.
 * 400 hours is ten working weeks -- past that the answer is "split the card", which is what the
 * inline message says. */
export const MAX_ESTIMATE_MINUTES = 400 * 60

/** Hard ceiling on one time-log entry: a single day cannot hold more than 24 hours of work. */
export const MAX_TIME_LOG_MINUTES = 24 * 60

/**
 * Natural-language estimate entry in all four locales (A3: "estimate hours ... natural-language
 * entry in four locales").
 *
 * Accepts, in any order and with or without spaces: a bare number (read as hours, the ClickUp
 * convention -- "2" is two hours, not two minutes), `1.5` / `1,5` decimals, and unit-suffixed parts
 * built from the letters each locale actually types:
 *
 * | unit | uz-Latn | uz-Cyrl | ru | en |
 * |---|---|---|---|---|
 * | day | `kun`, `k` | `кун`, `к` | `дн`, `д` | `day`, `d` |
 * | hour | `soat`, `s` | `соат`, `с` | `час`, `ч` | `hour`, `hr`, `h` |
 * | minute | `daqiqa`, `daq`, `d`, `min` | `дақиқа`, `дақ`, `м` | `мин`, `м` | `minute`, `min`, `m` |
 *
 * The one genuine collision is Latin `d`: a minute in uz-Latn (`daqiqa`) and a day in English
 * (`day`). It resolves to **minutes**, because the product's default locale is uz-Latn and "2s 30d"
 * is the shape the placeholder teaches; an English speaker who means days can type `3 days`, which
 * matches the longer `day` alternative first. Documented rather than silently ambiguous.
 *
 * Returns `null` for anything it cannot read whole -- a partially understood estimate is worse than
 * none, because the field would silently store a different number than the one on screen.
 */
export function parseEstimateMinutes(input: string): number | null {
  // Non-breaking spaces arrive from copy-paste and from the app's own formatted values.
  const text = input
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
  if (text.length === 0) return null

  // A bare number (with either decimal separator) means hours.
  const bare = /^(\d+(?:[.,]\d+)?)$/.exec(text)
  if (bare) {
    const hours = Number(bare[1]!.replace(',', '.'))
    if (!Number.isFinite(hours) || hours < 0) return null
    return clampEstimate(Math.round(hours * 60))
  }

  const partPattern = new RegExp(ESTIMATE_PART_SOURCE, 'gu')
  let total = 0
  let matched = 0
  let match: RegExpExecArray | null
  while ((match = partPattern.exec(text)) !== null) {
    const value = Number(match[1]!.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) return null
    const unit = ESTIMATE_UNIT_MINUTES.get(match[2]!)
    if (unit === undefined) return null
    total += value * unit
    matched += 1
  }
  if (matched === 0) return null
  // Every character outside a recognised `<number><unit>` group must be a separator, or the input
  // said something this function did not understand -- and a half-understood estimate is worse than
  // none, because the stored number would differ from the one on screen.
  const leftovers = text
    .replace(new RegExp(ESTIMATE_PART_SOURCE, 'gu'), '')
    .replace(/[\s,;+-]/g, '')
  if (leftovers.length > 0) return null
  return clampEstimate(Math.round(total))
}

const MINUTE = 1
const HOUR = 60
const WORKING_DAY = HOURS_PER_WORKING_DAY * 60

/** Every unit word the four locales' keyboards actually produce, with the minutes it is worth.
 * Order in this list is irrelevant -- the alternation below is built longest-first, so `daqiqa`
 * always wins over `daq` and Cyrillic `kun` over its single-letter short form, regardless of how
 * they are written here. */
const ESTIMATE_UNIT_MINUTES: ReadonlyMap<string, number> = new Map([
  ['kunlar', WORKING_DAY],
  ['kun', WORKING_DAY],
  ['days', WORKING_DAY],
  ['day', WORKING_DAY],
  ['\u043a\u0443\u043d\u043b\u0430\u0440', WORKING_DAY],
  ['\u043a\u0443\u043d', WORKING_DAY],
  ['\u0434\u043d\u0435\u0439', WORKING_DAY],
  ['\u0434\u043d\u044f', WORKING_DAY],
  ['\u0434\u043d', WORKING_DAY],
  ['\u043a', WORKING_DAY],
  ['soatlar', HOUR],
  ['soat', HOUR],
  ['hours', HOUR],
  ['hour', HOUR],
  ['hrs', HOUR],
  ['hr', HOUR],
  ['\u0441\u043e\u0430\u0442\u043b\u0430\u0440', HOUR],
  ['\u0441\u043e\u0430\u0442', HOUR],
  ['\u0447\u0430\u0441\u043e\u0432', HOUR],
  ['\u0447\u0430\u0441\u0430', HOUR],
  ['\u0447\u0430\u0441', HOUR],
  ['\u0447', HOUR],
  ['\u0441', HOUR],
  ['s', HOUR],
  ['h', HOUR],
  ['daqiqalar', MINUTE],
  ['daqiqa', MINUTE],
  ['daq', MINUTE],
  ['minutes', MINUTE],
  ['minute', MINUTE],
  ['mins', MINUTE],
  ['min', MINUTE],
  ['\u0434\u0430\u049b\u0438\u049b\u0430\u043b\u0430\u0440', MINUTE],
  ['\u0434\u0430\u049b\u0438\u049b\u0430', MINUTE],
  ['\u0434\u0430\u049b', MINUTE],
  ['\u043c\u0438\u043d\u0443\u0442\u044b', MINUTE],
  ['\u043c\u0438\u043d\u0443\u0442\u0430', MINUTE],
  ['\u043c\u0438\u043d\u0443\u0442', MINUTE],
  ['\u043c\u0438\u043d', MINUTE],
  ['\u043c', MINUTE],
  ['d', MINUTE],
  ['m', MINUTE],
])

/** `\b` is ASCII-only in JavaScript, so it does not fire between a Cyrillic unit word and a
 * following space (both sides are non-word characters to it) -- the unit boundary is therefore
 * written explicitly as "the next character is not a letter", with a Unicode property escape. */
const ESTIMATE_PART_SOURCE =
  String.raw`(\d+(?:[.,]\d+)?)\s*(` +
  [...ESTIMATE_UNIT_MINUTES.keys()].sort((a, b) => b.length - a.length).join('|') +
  String.raw`)(?=$|[^\p{L}])`

function clampEstimate(minutes: number): number | null {
  if (minutes <= 0) return null
  return Math.min(minutes, MAX_ESTIMATE_MINUTES)
}

/** `{ hours, minutes }` for rendering -- the caller supplies the locale's own words, because "2 soat
 * 30 daqiqa" / "2 ч 30 мин" / "2h 30m" are three sentences, not one template (DESIGN.md §2.3). */
export function splitEstimateMinutes(total: number): { hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(total))
  return { hours: Math.floor(safe / 60), minutes: safe % 60 }
}

/** Hours, to one decimal -- what the workload grid and the people table's "Yuklama" column count in. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}

// ---------------------------------------------------------------------------------------------
// A7 -- recurring cards
// ---------------------------------------------------------------------------------------------

export const recurrenceFreqSchema = z.enum(['daily', 'weekly', 'monthly'])
export type RecurrenceFreq = z.infer<typeof recurrenceFreqSchema>

/**
 * When the next instance appears (A7 / CLICKUP-RESEARCH §7.1's own distinction, which is the single
 * thing people get wrong about recurring tasks):
 *
 * - `schedule` -- the next card is created on the schedule regardless of whether this one is done.
 *   Right for "weekly report due every Friday": missing one week does not move the next one.
 * - `after_done` -- the next card is created when this one is completed, counting from that moment.
 *   Right for "review the register every 30 days": the clock starts when the work actually happened.
 */
export const recurrenceModeSchema = z.enum(['schedule', 'after_done'])
export type RecurrenceMode = z.infer<typeof recurrenceModeSchema>

export const recurrenceRuleSchema = z
  .object({
    freq: recurrenceFreqSchema,
    /** Every N days/weeks/months. 1..60. */
    interval: z.number().int().min(1).max(60),
    mode: recurrenceModeSchema,
    /** Weekly only: ISO weekday numbers, 1 = Monday … 7 = Sunday. Empty means "the weekday the
     * series started on". */
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    /** Monthly only: 1..31. A month too short for the chosen day clamps to its last day (31 → 30 in
     * April, 28/29 in February) rather than skipping the month. */
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    /** ISO date (`YYYY-MM-DD`); no instance is created on or after it. */
    until: z.string().date().nullable().optional(),
    /** Stop after this many instances (the first card counts as one). */
    count: z.number().int().min(1).max(500).nullable().optional(),
  })
  .strict()
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>

const DAY_MS = 24 * 60 * 60 * 1000

/** ISO weekday, 1 = Monday … 7 = Sunday (JS `getUTCDay()` is 0 = Sunday). */
function isoWeekday(date: Date): number {
  const day = date.getUTCDay()
  return day === 0 ? 7 : day
}

function atUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  )
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * The first occurrence strictly after `from`, or `null` when the rule has run out (`until` passed,
 * or `occurrencesSoFar` has reached `count`).
 *
 * Deliberately UTC and date-only: a recurring card is a *day's* work item ("Friday's report"), and
 * anchoring it to a wall-clock instant means a department in Asia/Tashkent gets Thursday's card
 * whenever the job happens to run before 05:00 local. The time of day is carried over from the
 * card's own `dueAt` by the caller, not by this function.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  from: Date,
  occurrencesSoFar = 1,
): Date | null {
  if (rule.count != null && occurrencesSoFar >= rule.count) return null
  const start = atUtcMidnight(from)
  let next: Date

  if (rule.freq === 'daily') {
    next = new Date(start.getTime() + rule.interval * DAY_MS)
  } else if (rule.freq === 'weekly') {
    const wanted = [...new Set(rule.weekdays ?? [])].sort((a, b) => a - b)
    if (wanted.length === 0) {
      next = new Date(start.getTime() + rule.interval * 7 * DAY_MS)
    } else {
      const current = isoWeekday(start)
      const laterThisWeek = wanted.find((d) => d > current)
      if (laterThisWeek !== undefined) {
        next = new Date(start.getTime() + (laterThisWeek - current) * DAY_MS)
      } else {
        // Jump to the interval's next week, then to its first wanted weekday.
        const toMonday = 1 - current
        const weekStart = new Date(start.getTime() + (toMonday + rule.interval * 7) * DAY_MS)
        next = new Date(weekStart.getTime() + (wanted[0]! - 1) * DAY_MS)
      }
    }
  } else {
    const year = start.getUTCFullYear()
    const month = start.getUTCMonth()
    const targetMonth = month + rule.interval
    const targetYear = year + Math.floor(targetMonth / 12)
    const normalisedMonth = ((targetMonth % 12) + 12) % 12
    const wantedDay = rule.dayOfMonth ?? start.getUTCDate()
    const day = Math.min(wantedDay, lastDayOfMonth(targetYear, normalisedMonth))
    next = new Date(Date.UTC(targetYear, normalisedMonth, day))
  }

  if (rule.until) {
    const until = new Date(`${rule.until}T00:00:00.000Z`)
    if (next.getTime() >= until.getTime()) return null
  }
  return next
}

// ---------------------------------------------------------------------------------------------
// A10 -- dependencies
// ---------------------------------------------------------------------------------------------

/** One edge of the dependency graph: `cardId` **is blocked by** `blockedByCardId`. One direction
 * only -- "blocks" is the same edge read from the other end, which is why the API stores one row and
 * the card sheet shows two lists. */
export type DependencyEdge = { cardId: string; blockedByCardId: string }

/**
 * Would adding "`cardId` is blocked by `blockedByCardId`" close a loop?
 *
 * Depth-first walk from the proposed blocker along "is blocked by" edges: if it can reach `cardId`,
 * then `cardId` already (transitively) blocks it and the new edge would make each wait for the
 * other. A self-edge counts as a cycle. Pure and total -- an already-cyclic input (which the
 * database's own guard makes impossible, but a test may construct) terminates on the `seen` set
 * rather than recursing forever.
 */
export function wouldCreateDependencyCycle(
  edges: readonly DependencyEdge[],
  cardId: string,
  blockedByCardId: string,
): boolean {
  if (cardId === blockedByCardId) return true
  const blockersOf = new Map<string, string[]>()
  for (const edge of edges) {
    const list = blockersOf.get(edge.cardId)
    if (list) list.push(edge.blockedByCardId)
    else blockersOf.set(edge.cardId, [edge.blockedByCardId])
  }
  const seen = new Set<string>()
  const stack = [blockedByCardId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === cardId) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const blocker of blockersOf.get(current) ?? []) stack.push(blocker)
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// 7.2 -- templates
// ---------------------------------------------------------------------------------------------

export const workTemplateKindSchema = z.enum(['card', 'project'])
export type WorkTemplateKind = z.infer<typeof workTemplateKindSchema>

/** `department` templates are the head's curated gallery, visible to everyone; `personal` templates
 * belong to whoever saved them and are visible only to them (SPEC §7.2). */
export const workTemplateScopeSchema = z.enum(['department', 'personal'])
export type WorkTemplateScope = z.infer<typeof workTemplateScopeSchema>

export const cardTemplatePayloadSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(20000).nullable().optional(),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional(),
    /** Days from "create from template" to the new card's due date. */
    dueInDays: z.number().int().min(0).max(365).nullable().optional(),
    estimateMin: z.number().int().min(1).max(MAX_ESTIMATE_MINUTES).nullable().optional(),
    labels: z.array(z.string().uuid()).max(20).optional(),
    checklist: z.array(z.string().min(1).max(500)).max(50).optional(),
  })
  .strict()
export type CardTemplatePayload = z.infer<typeof cardTemplatePayloadSchema>

export const projectTemplatePayloadSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(20000).nullable().optional(),
    colour: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    milestones: z
      .array(z.object({ title: z.string().min(1).max(200), offsetDays: z.number().int().min(0) }))
      .max(30)
      .optional(),
    /** Objective cards every project started from this template begins with. */
    cards: z
      .array(
        z.object({
          title: z.string().min(1).max(300),
          offsetDays: z.number().int().min(0).max(365).optional(),
          estimateMin: z.number().int().min(1).max(MAX_ESTIMATE_MINUTES).nullable().optional(),
        }),
      )
      .max(50)
      .optional(),
  })
  .strict()
export type ProjectTemplatePayload = z.infer<typeof projectTemplatePayloadSchema>

// ---------------------------------------------------------------------------------------------
// A11 -- department goals
// ---------------------------------------------------------------------------------------------

/**
 * What a goal counts. Every one of these is computed from cards the department already has -- a goal
 * never asks anybody to report a number by hand, which is exactly why ClickUp's own Goals are
 * abandoned so often (CLICKUP-RESEARCH §5).
 *
 * - `cards_done` -- how many matching cards reached `done`/`archived` in the window.
 * - `on_time_rate` -- percent of those completed on or before their due date.
 * - `estimate_hours` -- summed estimate of matching completed cards, in hours.
 * - `open_cards_max` -- an *upper bound* goal: keep matching open cards at or under the target
 *   ("no more than 10 overdue"). Progress is full while the count is under it.
 */
export const goalMetricSchema = z.enum([
  'cards_done',
  'on_time_rate',
  'estimate_hours',
  'open_cards_max',
])
export type GoalMetric = z.infer<typeof goalMetricSchema>

/** A goal whose metric is a ceiling counts down, not up -- the progress bar and its colour read the
 * other way round, and the head dashboard says "10 dan 4 ta" instead of "4 / 10". */
export function isCeilingMetric(metric: GoalMetric): boolean {
  return metric === 'open_cards_max'
}

/** 0..1, clamped. A ceiling metric is full at zero and empty at (or past) the target. */
export function goalProgress(metric: GoalMetric, current: number, target: number): number {
  if (target <= 0) return current === 0 ? 1 : 0
  const ratio = isCeilingMetric(metric)
    ? 1 - Math.max(0, current) / target
    : Math.max(0, current) / target
  return Math.max(0, Math.min(1, ratio))
}

// ---------------------------------------------------------------------------------------------
// EPIC-017 -- automations
// ---------------------------------------------------------------------------------------------

/** SPEC §7: "triggers card created / moved to status / assigned / due soon / overdue / field
 * changed". `card_field_changed` covers priority and label edits, which is what a head actually
 * wants to react to (the custom-fields package extends its config with a field key). */
export const AUTOMATION_TRIGGERS = [
  'card_created',
  'card_status_changed',
  'card_assigned',
  'card_due_soon',
  'card_overdue',
  'card_field_changed',
] as const
export const automationTriggerSchema = z.enum(AUTOMATION_TRIGGERS)
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>

export const automationTriggerConfigSchema = z
  .object({
    /** `card_status_changed`: only fire when the card lands on this status. */
    toStatus: z.enum(['active', 'done', 'archived']).nullable().optional(),
    /** `card_due_soon`: how many days ahead counts as "soon". 1..14. */
    daysAhead: z.number().int().min(1).max(14).nullable().optional(),
    /** `card_field_changed`: which field. */
    field: z.enum(['priority', 'labels', 'dueAt', 'estimate']).nullable().optional(),
    /** Every trigger: only cards matching this filter-grammar string. Empty = every card. */
    filter: z.string().max(500).nullable().optional(),
  })
  .strict()
export type AutomationTriggerConfig = z.infer<typeof automationTriggerConfigSchema>

/** SPEC §7: "actions assign, set priority, add label, notify person or head, move, add checklist
 * from template, create follow-up card". */
export const AUTOMATION_ACTION_KINDS = [
  'assign',
  'set_priority',
  'add_label',
  'notify_user',
  'notify_head',
  'set_status',
  'add_checklist',
  'create_followup',
] as const
export const automationActionKindSchema = z.enum(AUTOMATION_ACTION_KINDS)
export type AutomationActionKind = z.infer<typeof automationActionKindSchema>

export const automationActionSchema = z
  .object({
    kind: automationActionKindSchema,
    /** `assign` / `notify_user`: who. */
    userId: z.string().uuid().nullable().optional(),
    /** `set_priority`. */
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).nullable().optional(),
    /** `add_label`. */
    labelId: z.string().uuid().nullable().optional(),
    /** `set_status`. */
    status: z.enum(['active', 'done', 'archived']).nullable().optional(),
    /** `add_checklist`: the lines to append (a "checklist template" that needs no second table). */
    checklist: z.array(z.string().min(1).max(500)).max(20).optional(),
    /** `create_followup`: the new card's title and how far ahead it is due. */
    title: z.string().min(1).max(300).nullable().optional(),
    dueInDays: z.number().int().min(0).max(365).nullable().optional(),
  })
  .strict()
export type AutomationAction = z.infer<typeof automationActionSchema>

/** Which actions make sense for which trigger, as one table both the rule builder (to fill its
 * second select) and the API (to refuse a nonsense rule) read. Everything is allowed everywhere
 * except `set_status`, which cannot react to a status change without a head starting a ping-pong
 * with themselves -- the loop guard below would stop it, but refusing it up front is kinder than
 * a rule that silently never runs twice. */
export const ACTIONS_FOR_TRIGGER: Readonly<
  Record<AutomationTrigger, readonly AutomationActionKind[]>
> = Object.freeze({
  card_created: AUTOMATION_ACTION_KINDS,
  card_status_changed: AUTOMATION_ACTION_KINDS.filter((a) => a !== 'set_status'),
  card_assigned: AUTOMATION_ACTION_KINDS.filter((a) => a !== 'assign'),
  card_due_soon: AUTOMATION_ACTION_KINDS,
  card_overdue: AUTOMATION_ACTION_KINDS,
  card_field_changed: AUTOMATION_ACTION_KINDS,
})

export function isActionAllowedForTrigger(
  trigger: AutomationTrigger,
  action: AutomationActionKind,
): boolean {
  return ACTIONS_FOR_TRIGGER[trigger].includes(action)
}

/** SPEC §7: "loops guarded (a rule cannot trigger itself twice in one chain)". The engine carries
 * the ids of the rules already applied in this chain and refuses to go deeper than this. */
export const AUTOMATION_MAX_CHAIN_DEPTH = 3

/** A department may not exceed this many enabled rules. A limit stated in the copy beats a rule set
 * nobody can reason about -- the same reasoning as `FIELD_CAPS` in `custom-fields.ts`. */
export const AUTOMATION_MAX_RULES = 25

export const automationRuleBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    trigger: automationTriggerSchema,
    triggerConfig: automationTriggerConfigSchema.default({}),
    actions: z.array(automationActionSchema).min(1).max(5),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((rule) => rule.actions.every((a) => isActionAllowedForTrigger(rule.trigger, a.kind)), {
    message: 'action_not_allowed_for_trigger',
    path: ['actions'],
  })
export type AutomationRuleBody = z.infer<typeof automationRuleBodySchema>

export const automationRunStatusSchema = z.enum(['applied', 'skipped', 'failed'])
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>
