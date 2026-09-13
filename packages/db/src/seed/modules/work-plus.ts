// Demo seed for the v1.1 work extras (SPEC §7, §12): estimates and per-person capacity, a blocked
// card, a recurring card, a department card template and a project template, a department goal, an
// automation rule, a focus list and a couple of time logs and reminders.
//
// Why this exists at all: every one of those features shipped in v1.1 and every one of their screens
// opened on its empty state, because `work.ts` (order 90) predates them and no package extended it.
// SPEC §12 asks for exactly this content, and a head who opens "Maqsadlar" in a demo and is told to
// create their first goal learns nothing about what goals do.
//
// `order: 960` -- after `work.ts` (90, the cards this module hangs estimates, dependencies, pins and
// logs off), `projects.ts` (100) and `fields.ts` (950, so the field-driven goal below has a
// definition to point at).
//
// Idempotence (MODULE-GUIDE.md "DB: seeds"): every row carries a deterministic `demoId(...)` and every
// insert is `on conflict do nothing`, so a second `seed:demo` writes zero rows here; `reset()` deletes
// exactly those ids, children before parents. The estimate and recurrence columns are the one
// exception to "insert": they are `update`s of `work.ts`'s own cards, so `reset()` nulls them back out
// rather than deleting anything -- the cards belong to `work.ts` and it deletes them itself.
//
// Raw SQL rather than Drizzle table objects for the same reason `apps/api/src/modules/work/
// plus-repo.ts` uses it: these tables (`app.goals`, `app.work_templates`, `app.automation_rules`,
// `app.card_dependencies`, `app.focus_pins`, `app.work_capacity`, `app.card_time_logs`,
// `app.card_reminders`) are declared in SQL migrations and have no `packages/db/src/schema/*.ts`
// mirror, so a Drizzle object here would be a second, drift-prone declaration of the same columns.
import { sql } from 'drizzle-orm'
import {
  ALL_WORK_MEMBER_IDS,
  DEPARTMENT_ID,
  HEAD_USER_ID,
  MEMBER_USER_ID,
  labelId,
} from '../work-fixtures.js'
import { demoId } from '../ids.js'
import { asUser } from '../scope.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 960

/** The same fixed "now" `work.ts` builds its cards around, so a due date here lands where that
 * module's dates do rather than drifting with the clock of whichever machine seeds. */
const NOW = new Date('2026-09-06T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const daysFromNow = (days: number): Date => new Date(NOW.getTime() + days * DAY_MS)
const isoDate = (days: number): string => daysFromNow(days).toISOString().slice(0, 10)

/** `work.ts`'s own id scheme, repeated here so this module can point at those cards by name.
 * `(assigneeIndex, n)` with `n < 12` is always present -- every member gets at least 12 cards. */
const workCardId = (assigneeIndex: number, n: number): string =>
  demoId(`work.card.standalone.${assigneeIndex}.${n}`)

// --- estimates (A3) -----------------------------------------------------------------------------
//
// Spread over the first ten cards of every member's column so the workload grid has hours in every
// cell and the people table's Yuklama column shows hours rather than a bare open count (HANDOFFS #5).
// 30..300 minutes, deterministic per card.
const ESTIMATES: readonly { cardId: string; minutes: number }[] = ALL_WORK_MEMBER_IDS.flatMap(
  (_userId, i) =>
    Array.from({ length: 10 }, (__, n) => ({
      cardId: workCardId(i, n),
      minutes: 30 + ((i * 3 + n * 5) % 10) * 30,
    })),
)

// --- capacity (A4) ------------------------------------------------------------------------------
//
// A real department is not 40 h for everybody: a boshliq spends most of the week on management, and
// two people are part-time. Anything not listed here falls back to `DEFAULT_WEEKLY_CAPACITY_HOURS`,
// which is what a department that has never touched the setting sees.
const CAPACITY: readonly { userId: string; weeklyHours: number }[] = [
  { userId: HEAD_USER_ID, weeklyHours: 16 },
  { userId: MEMBER_USER_ID, weeklyHours: 40 },
  ...ALL_WORK_MEMBER_IDS.slice(2, 6).map((userId, i) => ({
    userId,
    weeklyHours: [40, 32, 40, 20][i] ?? 40,
  })),
]

// --- dependencies (A10) -------------------------------------------------------------------------
//
// Two edges, both inside one member's column so the "blocked" chip and the timeline arrow are visible
// without hunting: card 2 waits on card 0, card 3 waits on card 2 (a chain, not a pair, so the cycle
// guard has something real to refuse).
const DEPENDENCIES: readonly { id: string; cardId: string; blockedByCardId: string }[] = [
  {
    id: demoId('workplus.dep.1'),
    cardId: workCardId(1, 2),
    blockedByCardId: workCardId(1, 0),
  },
  {
    id: demoId('workplus.dep.2'),
    cardId: workCardId(1, 3),
    blockedByCardId: workCardId(1, 2),
  },
]

// --- recurrence (A7) ----------------------------------------------------------------------------
//
// The weekly Monday report every ministry department actually has. `recurrence_series_id` is the
// card's own id: it is the first instance of its series.
const RECURRING_CARD_ID = workCardId(1, 4)
const RECURRENCE_RULE = {
  freq: 'weekly',
  interval: 1,
  mode: 'after_done',
  weekdays: [1],
} as const

// --- templates (7.2) ----------------------------------------------------------------------------
const CARD_TEMPLATE_ID = demoId('workplus.template.card.hisobot')
const PROJECT_TEMPLATE_ID = demoId('workplus.template.project.audit')

const TEMPLATES: readonly {
  id: string
  kind: 'card' | 'project'
  scope: 'department' | 'personal'
  ownerUserId: string
  name: string
  description: string
  payload: unknown
}[] = [
  {
    id: CARD_TEMPLATE_ID,
    kind: 'card',
    scope: 'department',
    ownerUserId: HEAD_USER_ID,
    name: 'Oylik hisobot',
    description: 'Har oy takrorlanadigan hisobot: yigʻish, tekshirish, yuborish.',
    payload: {
      title: 'Oylik hisobotni tayyorlash',
      priority: 'medium',
      dueInDays: 7,
      estimateMin: 240,
      labels: [labelId('report')],
      checklist: [
        'Boʻlimlardan raqamlarni yigʻish',
        'Oʻtgan oy bilan solishtirish',
        'Boshliq bilan koʻrib chiqish',
        'Vazirlikka yuborish',
      ],
    },
  },
  {
    id: PROJECT_TEMPLATE_ID,
    kind: 'project',
    scope: 'department',
    ownerUserId: HEAD_USER_ID,
    name: 'Axborot xavfsizligi auditi',
    description: 'Har chorakda oʻtkaziladigan audit uchun tayyor reja.',
    payload: {
      title: 'Axborot xavfsizligi auditi',
      colour: '#8b5cf6',
      milestones: [
        { title: 'Koʻlamni belgilash', offsetDays: 7 },
        { title: 'Texnik tekshiruv', offsetDays: 21 },
        { title: 'Hisobot va tavsiyalar', offsetDays: 35 },
      ],
      cards: [
        { title: 'Tarmoq skanerlash', offsetDays: 10, estimateMin: 480 },
        { title: 'Kirish huquqlarini qayta koʻrib chiqish', offsetDays: 18, estimateMin: 360 },
        { title: 'Yakuniy hisobotni yozish', offsetDays: 33, estimateMin: 240 },
      ],
    },
  },
]

// --- goals (A11) --------------------------------------------------------------------------------
const GOALS: readonly {
  id: string
  title: string
  description: string
  metric: 'cards_done' | 'on_time_rate' | 'estimate_hours' | 'open_cards_max'
  filter: string
  targetValue: number
  startsOn: string
  dueOn: string
}[] = [
  {
    id: demoId('workplus.goal.oylik'),
    title: 'Sentabrda 120 ta vazifa yakunlansin',
    description: 'Boʻlimning oylik sur’ati — kartalardan oʻzi hisoblanadi.',
    metric: 'cards_done',
    filter: '',
    targetValue: 120,
    startsOn: isoDate(-6),
    dueOn: isoDate(24),
  },
  {
    id: demoId('workplus.goal.muddat'),
    title: 'Muddatida bajarish 85% dan past tushmasin',
    description: 'Muddati oʻtib ketgan ish — fuqaro kutayotgan ish.',
    metric: 'on_time_rate',
    filter: '',
    targetValue: 85,
    startsOn: isoDate(-36),
    dueOn: isoDate(24),
  },
  {
    id: demoId('workplus.goal.muhim'),
    title: 'Ochiq «Muhim» ishlar 100 tadan oshmasin',
    description: 'Yuqori chegara: ochiq muhim ishlar soni shu raqamdan past turishi kerak.',
    metric: 'open_cards_max',
    filter: 'label:"Muhim"',
    targetValue: 100,
    startsOn: isoDate(-6),
    dueOn: isoDate(24),
  },
]

// --- automations (EPIC-017) ---------------------------------------------------------------------
const AUTOMATIONS: readonly {
  id: string
  name: string
  trigger: string
  triggerConfig: unknown
  actions: unknown
  enabled: boolean
}[] = [
  // Deliberately OFF in the demo, and the reason is the lesson: `notify_head` fires once per card,
  // the scan dedupes per rule per card per day but not per tick, and this department carries 77
  // overdue cards -- so switching it on filled the boshliq's inbox with 79 identical rows in one
  // sweep. It ships enabled: false so the demo shows a rule in both states and a head sees what the
  // switch is for before they flip it on a backlog.
  {
    id: demoId('workplus.rule.kechikkan'),
    name: 'Muddati oʻtganda boshliqqa xabar bering',
    trigger: 'card_overdue',
    triggerConfig: { filter: 'label:"Muhim"' },
    actions: [{ kind: 'notify_head' }],
    enabled: false,
  },
  {
    id: demoId('workplus.rule.muhim'),
    name: '«Muhim» yorligʻi qoʻyilsa — muhimlikni koʻtaring',
    trigger: 'card_field_changed',
    triggerConfig: { field: 'labels', filter: 'label:"Muhim"' },
    actions: [{ kind: 'set_priority', priority: 'high' }],
    enabled: true,
  },
  {
    id: demoId('workplus.rule.yangi'),
    name: 'Yangi vazifaga tekshiruv roʻyxatini qoʻshing',
    trigger: 'card_created',
    triggerConfig: { filter: '' },
    actions: [
      {
        kind: 'add_checklist',
        checklist: ['Talabni aniqlashtirish', 'Muddatni kelishish', 'Natijani topshirish'],
      },
    ],
    enabled: false,
  },
]

// --- focus list (A9), time logs (A3) and reminders (7.4) ----------------------------------------
const FOCUS_PINS: readonly { id: string; userId: string; cardId: string; position: number }[] = [
  { id: demoId('workplus.focus.1'), userId: MEMBER_USER_ID, cardId: workCardId(1, 0), position: 0 },
  { id: demoId('workplus.focus.2'), userId: MEMBER_USER_ID, cardId: workCardId(1, 2), position: 1 },
  { id: demoId('workplus.focus.3'), userId: MEMBER_USER_ID, cardId: workCardId(1, 5), position: 2 },
  { id: demoId('workplus.focus.4'), userId: HEAD_USER_ID, cardId: workCardId(0, 1), position: 0 },
]

const TIME_LOGS: readonly {
  id: string
  cardId: string
  userId: string
  minutes: number
  spentOn: string
  note: string
}[] = [
  {
    id: demoId('workplus.timelog.1'),
    cardId: workCardId(1, 0),
    userId: MEMBER_USER_ID,
    minutes: 90,
    spentOn: isoDate(-2),
    note: 'Maʼlumot yigʻish',
  },
  {
    id: demoId('workplus.timelog.2'),
    cardId: workCardId(1, 0),
    userId: MEMBER_USER_ID,
    minutes: 45,
    spentOn: isoDate(-1),
    note: 'Tahrir',
  },
  {
    id: demoId('workplus.timelog.3'),
    cardId: workCardId(0, 1),
    userId: HEAD_USER_ID,
    minutes: 60,
    spentOn: isoDate(-1),
    note: 'Koʻrib chiqish',
  },
]

const REMINDERS: readonly {
  id: string
  cardId: string
  userId: string
  remindAt: Date
  note: string
}[] = [
  {
    id: demoId('workplus.reminder.1'),
    cardId: workCardId(1, 5),
    userId: MEMBER_USER_ID,
    remindAt: daysFromNow(8),
    note: 'Ertalab boshlash',
  },
  {
    id: demoId('workplus.reminder.2'),
    cardId: workCardId(0, 1),
    userId: HEAD_USER_ID,
    remindAt: daysFromNow(9),
    note: 'Jasur bilan gaplashish',
  },
]

/** Owner-only rows are written one statement per owner (see `seed()`), so they are grouped first --
 * this is what keeps "no query in a loop" true: the loop is over *owners*, of which there are two. */
function groupByUser<T extends { userId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = out.get(row.userId)
    if (bucket) bucket.push(row)
    else out.set(row.userId, [row])
  }
  return out
}

/** `count` of an `insert ... on conflict do nothing ... returning id` -- the number of rows this run
 * actually wrote, which is what `runSeedDemo` sums. */
async function insertCount(
  ctx: SeedModuleContext,
  statement: ReturnType<typeof sql>,
): Promise<number> {
  const rows = await ctx.tx.raw<{ id: string }>(statement)
  return rows.length
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let written = 0

  // --- estimates: an update of `work.ts`'s cards, not an insert. One statement over a values list,
  // never one statement per card (I-14 "no query in a loop").
  const estimateValues = sql.join(
    ESTIMATES.map((e) => sql`(${e.cardId}::uuid, ${e.minutes}::int)`),
    sql`, `,
  )
  const estimated = await tx.raw<{ id: string }>(
    sql`update app.cards c
        set estimate_min = v.minutes, updated_at = now()
        from (values ${estimateValues}) as v(card_id, minutes)
        where c.id = v.card_id
          and c.department_id = ${DEPARTMENT_ID}
          and c.estimate_min is null
        returning c.id`,
  )
  written += estimated.length

  // --- recurrence: the same shape, for one card.
  const recurring = await tx.raw<{ id: string }>(
    sql`update app.cards
        set recurrence = ${JSON.stringify(RECURRENCE_RULE)}::jsonb,
            recurrence_series_id = id,
            recurrence_index = 0,
            updated_at = now()
        where id = ${RECURRING_CARD_ID}
          and department_id = ${DEPARTMENT_ID}
          and recurrence is null
        returning id`,
  )
  written += recurring.length

  // --- capacity
  const capacityValues = sql.join(
    CAPACITY.map(
      (c) =>
        sql`(${demoId(`workplus.capacity.${c.userId}`)}::uuid, ${DEPARTMENT_ID}::uuid, ${c.userId}::uuid, ${c.weeklyHours}::numeric, ${HEAD_USER_ID}::uuid)`,
    ),
    sql`, `,
  )
  written += await insertCount(
    ctx,
    sql`insert into app.work_capacity (id, department_id, user_id, weekly_hours, updated_by_user_id)
        values ${capacityValues}
        on conflict do nothing
        returning id`,
  )

  // --- dependencies
  const dependencyValues = sql.join(
    DEPENDENCIES.map(
      (d) =>
        sql`(${d.id}::uuid, ${DEPARTMENT_ID}::uuid, ${d.cardId}::uuid, ${d.blockedByCardId}::uuid, ${HEAD_USER_ID}::uuid)`,
    ),
    sql`, `,
  )
  written += await insertCount(
    ctx,
    sql`insert into app.card_dependencies (id, department_id, card_id, blocked_by_card_id, created_by_user_id)
        values ${dependencyValues}
        on conflict do nothing
        returning id`,
  )

  // --- templates
  const templateValues = sql.join(
    TEMPLATES.map(
      (t) =>
        sql`(${t.id}::uuid, ${DEPARTMENT_ID}::uuid, ${t.kind}::app.work_template_kind, ${t.scope}::app.work_template_scope, ${t.ownerUserId}::uuid, ${t.name}, ${t.description}, ${JSON.stringify(t.payload)}::jsonb)`,
    ),
    sql`, `,
  )
  written += await insertCount(
    ctx,
    sql`insert into app.work_templates (id, department_id, kind, scope, owner_user_id, name, description, payload)
        values ${templateValues}
        on conflict do nothing
        returning id`,
  )

  // --- goals
  const goalValues = sql.join(
    GOALS.map(
      (g) =>
        sql`(${g.id}::uuid, ${DEPARTMENT_ID}::uuid, ${g.title}, ${g.description}, ${g.metric}::app.goal_metric, ${g.filter}, ${g.targetValue}::numeric, ${g.startsOn}::date, ${g.dueOn}::date, ${HEAD_USER_ID}::uuid)`,
    ),
    sql`, `,
  )
  written += await insertCount(
    ctx,
    sql`insert into app.goals (id, department_id, title, description, metric, filter, target_value, starts_on, due_on, created_by_user_id)
        values ${goalValues}
        on conflict do nothing
        returning id`,
  )

  // --- automation rules
  const ruleValues = sql.join(
    AUTOMATIONS.map(
      (a) =>
        sql`(${a.id}::uuid, ${DEPARTMENT_ID}::uuid, ${a.name}, ${a.trigger}::app.automation_trigger, ${JSON.stringify(a.triggerConfig)}::jsonb, ${JSON.stringify(a.actions)}::jsonb, ${a.enabled}::boolean, ${HEAD_USER_ID}::uuid)`,
    ),
    sql`, `,
  )
  written += await insertCount(
    ctx,
    sql`insert into app.automation_rules (id, department_id, name, trigger, trigger_config, actions, enabled, created_by_user_id)
        values ${ruleValues}
        on conflict do nothing
        returning id`,
  )

  // --- focus pins, time logs and reminders are owner-only rows (`user_id = app.current_user_id()`,
  // no actor-role carve-out -- I-1), so each owner's slice is written under `asUser` exactly as
  // `personal.ts` and `notifications.ts` already do. One statement per *owner*, never per row.
  for (const [userId, rows] of groupByUser(FOCUS_PINS)) {
    const values = sql.join(
      rows.map(
        (p) =>
          sql`(${p.id}::uuid, ${DEPARTMENT_ID}::uuid, ${p.userId}::uuid, ${p.cardId}::uuid, ${p.position}::int)`,
      ),
      sql`, `,
    )
    written += await asUser(tx, userId, () =>
      insertCount(
        ctx,
        sql`insert into app.focus_pins (id, department_id, user_id, card_id, position)
            values ${values}
            on conflict do nothing
            returning id`,
      ),
    )
  }

  for (const [userId, rows] of groupByUser(TIME_LOGS)) {
    const values = sql.join(
      rows.map(
        (l) =>
          sql`(${l.id}::uuid, ${DEPARTMENT_ID}::uuid, ${l.cardId}::uuid, ${l.userId}::uuid, ${l.minutes}::int, ${l.spentOn}::date, ${l.note})`,
      ),
      sql`, `,
    )
    written += await asUser(tx, userId, () =>
      insertCount(
        ctx,
        sql`insert into app.card_time_logs (id, department_id, card_id, user_id, minutes, spent_on, note)
            values ${values}
            on conflict do nothing
            returning id`,
      ),
    )
  }

  for (const [userId, rows] of groupByUser(REMINDERS)) {
    const values = sql.join(
      rows.map(
        (r) =>
          sql`(${r.id}::uuid, ${DEPARTMENT_ID}::uuid, ${r.cardId}::uuid, ${r.userId}::uuid, ${r.remindAt.toISOString()}::timestamptz, ${r.note})`,
      ),
      sql`, `,
    )
    written += await asUser(tx, userId, () =>
      insertCount(
        ctx,
        sql`insert into app.card_reminders (id, department_id, card_id, user_id, remind_at, note)
            values ${values}
            on conflict do nothing
            returning id`,
      ),
    )
  }

  return written
}

/** Reverse of `seed()`. The two `update`s are reverted rather than deleted: those cards are
 * `work.ts`'s rows and it deletes them itself at its own (earlier) `order`. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let deleted = 0

  const byIds = async (table: string, ids: readonly string[]): Promise<number> => {
    if (ids.length === 0) return 0
    const rows = await tx.raw<{ id: string }>(
      sql`delete from ${sql.raw(table)} where id = any(${sql.raw(`array[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]`)}) returning id`,
    )
    return rows.length
  }

  // Owner-only tables: deleted under the same `asUser` their rows were written under.
  for (const [userId, rows] of groupByUser(REMINDERS)) {
    deleted += await asUser(tx, userId, () =>
      byIds(
        'app.card_reminders',
        rows.map((r) => r.id),
      ),
    )
  }
  for (const [userId, rows] of groupByUser(TIME_LOGS)) {
    deleted += await asUser(tx, userId, () =>
      byIds(
        'app.card_time_logs',
        rows.map((l) => l.id),
      ),
    )
  }
  for (const [userId, rows] of groupByUser(FOCUS_PINS)) {
    deleted += await asUser(tx, userId, () =>
      byIds(
        'app.focus_pins',
        rows.map((p) => p.id),
      ),
    )
  }
  // v1.1 critique SEV2 #24, found running the reseed the fix itself asks for: `seed:reset --demo`
  // died on `automation_runs_rule_id_fkey`. The engine writes a run row per card whenever a seeded
  // rule fires -- 79 of them on the demo box -- and those rows are nobody's to name: no seed module
  // wrote them, so no seed module's `reset()` deleted them, and the rule they point at could never
  // be removed. "Reseed before the demo" was therefore impossible on any instance where the
  // automations had ever actually run.
  //
  // A rule's runs are part of that rule, not independent data: deleting the rule and keeping its
  // history would leave rows referring to something that no longer exists. So the runs of exactly
  // these rule ids go first, by `rule_id` rather than by a list of ids this module would have to
  // have predicted. Same shape as `accounts.ts`'s sessions/memberships sweep, and for the same
  // reason -- the app wrote rows the seed did not.
  const automationIds = AUTOMATIONS.map((a) => a.id)
  const purgedRuns = await tx.raw<{ id: string }>(
    sql`delete from app.automation_runs
        where rule_id = any(${sql.raw(`array[${automationIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
        returning id`,
  )
  deleted += purgedRuns.length

  deleted += await byIds('app.automation_rules', automationIds)
  deleted += await byIds(
    'app.goals',
    GOALS.map((g) => g.id),
  )
  deleted += await byIds(
    'app.work_templates',
    TEMPLATES.map((t) => t.id),
  )
  deleted += await byIds(
    'app.card_dependencies',
    DEPENDENCIES.map((d) => d.id),
  )
  deleted += await byIds(
    'app.work_capacity',
    CAPACITY.map((c) => demoId(`workplus.capacity.${c.userId}`)),
  )

  const unrecurred = await tx.raw<{ id: string }>(
    sql`update app.cards
        set recurrence = null, recurrence_series_id = null, recurrence_index = null
        where id = ${RECURRING_CARD_ID} and recurrence is not null
        returning id`,
  )
  deleted += unrecurred.length

  const estimateIds = ESTIMATES.map((e) => e.cardId)
  const unestimated = await tx.raw<{ id: string }>(
    sql`update app.cards
        set estimate_min = null
        where department_id = ${DEPARTMENT_ID}
          and estimate_min is not null
          and id = any(${sql.raw(`array[${estimateIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
        returning id`,
  )
  deleted += unestimated.length

  return deleted
}
