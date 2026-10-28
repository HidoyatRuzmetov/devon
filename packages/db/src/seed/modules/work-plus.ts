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
import { DEMO_NOW } from '../clock.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'
import { asUser } from '../scope.js'
import {
  ALL_WORK_MEMBER_IDS,
  DEPARTMENT_ID,
  HEAD_USER_ID,
  MEMBER_USER_ID,
  labelId,
  standaloneCardCount,
} from '../work-fixtures.js'

export const order = 960

/** The same "now" `work.ts` builds its cards around (`../clock.ts`), so a due date here lands where
 * that module's dates do rather than drifting with the clock of whichever machine seeds. */
const NOW = DEMO_NOW
const DAY_MS = 24 * 60 * 60 * 1000
const daysFromNow = (days: number): Date => new Date(NOW.getTime() + days * DAY_MS)
const isoDate = (days: number): string => daysFromNow(days).toISOString().slice(0, 10)

/** `work.ts`'s own id scheme, repeated here so this module can point at those cards by name. Which
 * `(assigneeIndex, n)` pairs exist is `work-fixtures.ts`'s `standaloneCardCount` to decide, and this
 * module reads that same function rather than assuming a fixed column height -- the assumption it
 * used to make ("every member gets at least 12 cards") is exactly what broke when the demo dropped
 * from ~230 cards to ~65. Index 1 (`demo.xodim`) is guaranteed the tallest column, which is why every
 * dependency/focus/time-log fixture below lives there. */
const workCardId = (assigneeIndex: number, n: number): string =>
  demoId(`work.card.standalone.${assigneeIndex}.${n}`)

// --- estimates (A3) -----------------------------------------------------------------------------
//
// Every card in every member's column gets one, so the workload grid has hours in every cell and the
// people table's Yuklama column shows hours rather than a bare open count (HANDOFFS #5). 30..300
// minutes, deterministic per card.
const ESTIMATES: readonly { cardId: string; minutes: number }[] = ALL_WORK_MEMBER_IDS.flatMap(
  (_userId, i) =>
    Array.from({ length: standaloneCardCount(i) }, (__, n) => ({
      cardId: workCardId(i, n),
      minutes: 30 + ((i * 3 + n * 5) % 10) * 30,
    })),
)

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
  // Personal templates use their creator's scope, just like personal reminders and focus pins.
  // One bulk statement per owner preserves both the privacy policy and seed idempotence.
  for (const [userId, rows] of groupByUser(
    TEMPLATES.map((t) => ({ ...t, userId: t.ownerUserId })),
  )) {
    const templateValues = sql.join(
      rows.map(
        (t) =>
          sql`(${t.id}::uuid, ${DEPARTMENT_ID}::uuid, ${t.kind}::app.work_template_kind, ${t.scope}::app.work_template_scope, ${t.ownerUserId}::uuid, ${t.name}, ${t.description}, ${JSON.stringify(t.payload)}::jsonb)`,
      ),
      sql`, `,
    )
    written += await asUser(tx, userId, () =>
      insertCount(
        ctx,
        sql`insert into app.work_templates (id, department_id, kind, scope, owner_user_id, name, description, payload)
          values ${templateValues}
          on conflict do nothing
          returning id`,
      ),
    )
  }

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
  for (const [userId, rows] of groupByUser(
    TEMPLATES.map((t) => ({ ...t, userId: t.ownerUserId })),
  )) {
    deleted += await asUser(tx, userId, () =>
      byIds(
        'app.work_templates',
        rows.map((t) => t.id),
      ),
    )
  }
  deleted += await byIds(
    'app.card_dependencies',
    DEPENDENCIES.map((d) => d.id),
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
