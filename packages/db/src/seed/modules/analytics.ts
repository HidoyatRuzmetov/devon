// Demo seed for analytics (MODULE-GUIDE.md "Seeds", TECH-SPEC §9): ~12 weeks of `app.analytics_daily`
// history computed directly from the cards `work.ts`'s seed already wrote, plus one saved filter and
// one pinned chart for each demo account -- "analytics history" rich enough that the page is never
// empty on first login.
//
// Order 700: strictly after `work.ts` (90, the cards this module aggregates), `structure.ts` (100,
// units `loadPerUnit` joins against), `projects.ts` (100) and `events.ts` (400) -- every table this
// seed's own aggregate query reads must already have its rows.
//
// `app.analytics_daily`/`app.onboarding_templates`-style department tables carry no owner column, but
// `app.analytics_saved_filters`/`app.analytics_pinned_charts` do (RLS: `owner_user_id =
// current_user_id()`) -- exactly personal.ts's problem, solved the same way: this module briefly
// re-points the transaction-local `app.user_id` GUC at each demo user before writing that user's own
// saved filter/pin, and clears it again afterwards so a later seed module never inherits a stale value.
import { sql } from 'drizzle-orm'
import { DEMO_DEPARTMENT, DEMO_USERS } from '../fixtures.js'
import { DEPARTMENT_ID } from '../work-fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'
import type { Tx } from '../../context.js'
import { DEMO_NOW } from '../clock.js'

export const order = 700

const HEAD = DEMO_USERS.find((u) => u.role === 'head')!
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!
// `work.ts` dates its cards around the same shared "now" (`../clock.ts`) -- this module's daily
// history has to end on that same reference day for its open/overdue snapshot to line up with what
// those cards actually look like "today".
const NOW = DEMO_NOW
const HISTORY_DAYS = 84 // 12 weeks (TECH-SPEC §9's own default window)

async function setSeedUser(tx: Tx, userId: string | null): Promise<void> {
  await tx.raw(sql`select set_config('app.user_id', ${userId ?? ''}, true)`)
}

/**
 * One `insert ... select` from `generate_series(...)` cross-joined with this department's cards --
 * the exact shape `apps/api/src/modules/analytics/repo.ts`'s live "open vs overdue" query uses,
 * duplicated here (a seed module cannot import from `@devon/api`, a different package one layer up
 * the dependency graph) so the demo's history is a real reconstruction of the seeded cards' timeline,
 * not synthetic noise. `on conflict do nothing` makes a second `seed:demo` run write zero rows here.
 */
async function seedDailyHistory(tx: Tx): Promise<number> {
  const startDay = new Date(NOW.getTime() - HISTORY_DAYS * 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 10)
  const endDay = NOW.toISOString().slice(0, 10)

  const inserted = await tx.raw<{ day: string }>(sql`
    insert into app.analytics_daily (id, department_id, day, metrics, computed_at)
    select
      -- Deterministic per-day id so a second run's ON CONFLICT target is the row itself, not a
      -- fresh uuid every time (the table's own unique index on (department_id, day) would also
      -- catch this, but a stable primary key means the RETURNING clause reports zero on a repeat).
      md5(${DEPARTMENT_ID}::text || gs.day::text)::uuid,
      ${DEPARTMENT_ID}::uuid,
      gs.day,
      jsonb_build_object(
        'cardsCreated', count(*) filter (
          where c.created_at >= gs.day and c.created_at < gs.day + interval '1 day'
        ),
        'cardsDone', count(*) filter (
          where c.status = 'done' and c.done_at >= gs.day and c.done_at < gs.day + interval '1 day'
        ),
        'cardsDoneOnTime', count(*) filter (
          where c.status = 'done' and c.done_at >= gs.day and c.done_at < gs.day + interval '1 day'
            and c.due_at is not null and c.done_at <= c.due_at
        ),
        'cardsOpenAtEnd', count(*) filter (
          where c.created_at < gs.day + interval '1 day'
            and (c.done_at is null or c.done_at >= gs.day + interval '1 day')
            and (c.archived_at is null or c.archived_at >= gs.day + interval '1 day')
        ),
        'cardsOverdueAtEnd', count(*) filter (
          where c.created_at < gs.day + interval '1 day'
            and (c.done_at is null or c.done_at >= gs.day + interval '1 day')
            and (c.archived_at is null or c.archived_at >= gs.day + interval '1 day')
            and c.due_at is not null and c.due_at < gs.day + interval '1 day'
        )
      ),
      ${NOW}
    from generate_series(${startDay}::date, ${endDay}::date, interval '1 day') as gs(day)
    cross join app.cards c
    where c.department_id = ${DEPARTMENT_ID} and c.deleted_at is null
    group by gs.day
    on conflict (id) do nothing
    returning day
  `)
  return inserted.length
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  rows += await seedDailyHistory(tx)

  // One saved filter + one pinned chart per demo account -- the head watches the whole department's
  // overdue load, the member watches their own open work.
  const savedFilterFixtures = [
    {
      user: HEAD,
      key: 'head.overdue-department',
      name: 'Muddati oʻtganlar',
      query: 'status:active due:<today',
      chartKey: 'openVsOverdue' as const,
      chartTitle: 'Ochiq va muddati oʻtgan topshiriqlar',
    },
    {
      user: MEMBER,
      key: 'member.my-open',
      name: 'Mening ochiq ishlarim',
      query: 'assignee:@me status:active',
      chartKey: 'personal' as const,
      chartTitle: 'Shaxsiy koʻrsatkichlarim',
    },
  ]

  for (let i = 0; i < savedFilterFixtures.length; i += 1) {
    const fixture = savedFilterFixtures[i]!
    await setSeedUser(tx, fixture.user.id)

    const filterInserted = await tx.raw<{ id: string }>(sql`
      insert into app.analytics_saved_filters (id, department_id, owner_user_id, name, query, since_days, shared)
      values (
        ${demoId(`analytics.saved-filter.${fixture.key}`)}, ${DEMO_DEPARTMENT.id}, ${fixture.user.id},
        ${fixture.name}, ${fixture.query}, ${HISTORY_DAYS}, false
      )
      on conflict (id) do nothing
      returning id
    `)
    rows += filterInserted.length

    const pinInserted = await tx.raw<{ id: string }>(sql`
      insert into app.analytics_pinned_charts (id, department_id, owner_user_id, chart_key, title, filter_query, sort)
      values (
        ${demoId(`analytics.pin.${fixture.key}`)}, ${DEMO_DEPARTMENT.id}, ${fixture.user.id},
        ${fixture.chartKey}, ${fixture.chartTitle}, ${fixture.query}, 0
      )
      on conflict (id) do nothing
      returning id
    `)
    rows += pinInserted.length
  }

  await setSeedUser(tx, null) // never leave a demo user's id on the transaction-local GUC for the next module

  return rows
}

/**
 * Blitz integration fix: this module shipped `seed()` but never `reset()` -- `seed:reset --demo`
 * (`demo.ts`'s `runResetDemo`) only calls a module's `reset()` when one exists, so every row this
 * module ever wrote was silently left behind. Harmless while nothing downstream pointed back at it,
 * until the very next step of the same reset (`DEMO_DELETE_ORDER`'s own department delete, `demo.ts`)
 * hit `analytics_daily_department_id_fkey` and failed outright -- reproduced end to end against a
 * fresh Testcontainers Postgres (`test:seed-idempotence`), so this is not specific to any one
 * long-lived demo database; every `seed:demo` followed by `seed:reset --demo` hit it.
 *
 * `analytics_daily`'s RLS write policy only checks `department_id` (no owner column on that table), so
 * one department-scoped delete covers every row `seedDailyHistory` ever inserts, deterministic id or
 * not -- and also covers a real recompute job's rows for this department, the same "reset cleans up
 * live usage on its own seeded rows, not only what it remembers seeding" fix `events.ts`'s `reset()`
 * needed for the same reason.
 *
 * `analytics_saved_filters`/`analytics_pinned_charts` additionally require `owner_user_id =
 * current_user_id()` in their write policies (RLS, `owner_user_id` is a real column here, `personal.ts`'s
 * exact problem) -- deleting each demo user's own rows needs `app.user_id` pointed at them first,
 * exactly the same `setSeedUser` dance `seed()` above already does to insert them.
 */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  const deletedDaily = await tx.raw<{ id: string }>(sql`
    delete from app.analytics_daily where department_id = ${DEPARTMENT_ID} returning id
  `)
  rows += deletedDaily.length

  // C-style loop, not for-of/Promise.all (TECH-SPEC §16's "no query in a loop" is about independent
  // items; these share one transaction-local `app.user_id` GUC, so they have to run one at a time --
  // the exact same reason `seed()` above loops this way over `savedFilterFixtures`).
  const users = [HEAD, MEMBER]
  for (let i = 0; i < users.length; i += 1) {
    const user = users[i]!
    await setSeedUser(tx, user.id)

    const deletedFilters = await tx.raw<{ id: string }>(sql`
      delete from app.analytics_saved_filters
      where department_id = ${DEMO_DEPARTMENT.id} and owner_user_id = ${user.id}
      returning id
    `)
    rows += deletedFilters.length

    const deletedPins = await tx.raw<{ id: string }>(sql`
      delete from app.analytics_pinned_charts
      where department_id = ${DEMO_DEPARTMENT.id} and owner_user_id = ${user.id}
      returning id
    `)
    rows += deletedPins.length
  }

  await setSeedUser(tx, null) // same reason seed() clears it: never leak a demo user id to the next module

  return rows
}
