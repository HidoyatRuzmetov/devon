// The residue sweep: what `seed:reset --demo` has to delete that no seed module ever wrote.
//
// v1.1 critique SEV2 #24, and the reason it kept coming back one foreign key at a time. Every
// module's `reset()` deleted rows *by the deterministic `demoId(...)` ids its own `seed()` writes*,
// which is exactly right for a database nobody has used -- and wrong for every database worth
// resetting. A demo box is a box people have demonstrated from: a head sends a fill request
// (`app.field_requests`), the rollup job writes a day (`app.analytics_daily`), the search indexer
// writes a document (`app.ai_search_documents`), the automations engine writes a run, a presenter
// creates a card, an agent drives the real API. None of those rows has an id any seed module could
// have predicted, all of them point at a demo department or a demo user, and `NO ACTION` is the
// delete rule on every single foreign key in the `app` schema (there is not one `on delete cascade`).
// So the department/user delete failed, on a different constraint each time, and "reseed before the
// demo" was impossible on the only kind of instance where it matters.
//
// Fixing the three constraints the report named would have bought the next three. The root cause is
// that a demo reset was expressed as "delete the rows I wrote" when it has to mean "delete the rows
// that belong to what I am about to remove". This file is that second sentence, once, for every
// table -- and `test/unit/reset-sweep.test.ts` fails the build if a new table is added to
// `TENANCY` without a decision recorded here, exactly the way `tenancy.registry.test.ts` fails it if
// a table is added to the schema without a class.
//
// Order is child-before-parent within each list, because `NO ACTION` means Postgres checks
// immediately. Scope is re-pointed with `scope.ts`'s `asDepartment`/`asUser` for the same reason
// every module already does it: RLS here is a *scope* check, not a role check, so a department-wide
// delete run under the wrong GUC matches zero rows however privileged the caller is.
import { sql } from 'drizzle-orm'
import type { Tx } from '../context.js'
import { TENANCY } from '../tenancy.js'
import { asDepartment, asUser } from './scope.js'

/** The departments and users a demo reset is about to delete. Modules that create departments or
 * users of their own contribute theirs through `module-loader.ts`'s optional `scope` export; the
 * foundation's come from `fixtures.ts`'s `DEMO_DELETE_ORDER`. */
export type DemoScope = {
  readonly departmentIds: readonly string[]
  readonly userIds: readonly string[]
}

/**
 * `department_owned` tables, children first. Every one of these carries `department_id` and an RLS
 * policy that compares it to `app.current_department_id()`, so one statement per table per demo
 * department clears it.
 */
export const DEPARTMENT_SWEEP_ORDER: readonly { table: string; ownerColumn?: string }[] = [
  // Events and everything hanging off one.
  { table: 'app.event_telegram_deliveries' },
  { table: 'app.poll_votes' },
  { table: 'app.poll_options' },
  { table: 'app.polls' },
  { table: 'app.carpool_seats' },
  { table: 'app.carpools' },
  { table: 'app.event_feedback' },
  { table: 'app.event_photos' },
  { table: 'app.event_comments' },
  { table: 'app.event_items' },
  { table: 'app.event_rsvps' },
  { table: 'app.events' },
  // Work: runs before rules, card children before cards, cards before projects.
  { table: 'app.automation_runs' },
  { table: 'app.automation_rules' },
  { table: 'app.card_dependencies' },
  // Owner-only on write (user_id); swept once per account -- see sweepDepartmentResidue.
  { table: 'app.card_reminders', ownerColumn: 'user_id' },
  // Owner-only on write (user_id); swept once per account -- see sweepDepartmentResidue.
  { table: 'app.card_time_logs', ownerColumn: 'user_id' },
  // Owner-only on write (user_id); swept once per account -- see sweepDepartmentResidue.
  { table: 'app.focus_pins', ownerColumn: 'user_id' },
  { table: 'app.card_activity' },
  { table: 'app.card_comments' },
  { table: 'app.card_checklist_items' },
  { table: 'app.attachments' },
  { table: 'app.cards' },
  { table: 'app.projects' },
  { table: 'app.work_capacity' },
  { table: 'app.work_templates' },
  { table: 'app.goals' },
  // Custom fields: requests and values both reference a definition.
  { table: 'app.field_requests' },
  { table: 'app.field_values' },
  { table: 'app.field_defs' },
  { table: 'app.notification_department_settings' },
  // Pages and onboarding: a run references its template, a version references its page.
  { table: 'app.onboarding_runs' },
  { table: 'app.onboarding_templates' },
  { table: 'app.page_versions' },
  { table: 'app.pages' },
  // Owner-only on write (owner_user_id); swept once per account -- see sweepDepartmentResidue.
  { table: 'app.analytics_pinned_charts', ownerColumn: 'owner_user_id' },
  // Owner-only on write (owner_user_id); swept once per account -- see sweepDepartmentResidue.
  { table: 'app.analytics_saved_filters', ownerColumn: 'owner_user_id' },
  { table: 'app.analytics_daily' },
  { table: 'app.ai_traces' },
  { table: 'app.ai_search_documents' },
  { table: 'app.ai_briefings' },
  { table: 'app.ai_department_settings' },
  // Owner-only on write (owner_user_id); swept once per account -- see sweepDepartmentResidue.
  { table: 'app.saved_views', ownerColumn: 'owner_user_id' },
  { table: 'app.people_views' },
  { table: 'app.shared_canvases' },
  { table: 'app.labels' },
  // Structure last of the department-owned set: a unit role references its unit, a unit its parent.
  { table: 'app.unit_roles' },
  { table: 'app.units' },
  // Memberships are the department's last child before the department itself, and the reason a
  // colleague who joined the demo department through the product does not block the reset.
  { table: 'app.memberships' },
]

/**
 * `user_owned` tables, children first. RLS on these is `user_id = app.current_user_id()` with no
 * actor-role bypass at all (I-1), so they are swept one demo user at a time under `asUser` -- the
 * same shape `personal.ts` and `notifications.ts` already use to *write* them.
 */
export const USER_SWEEP_ORDER: readonly { table: string; column: string | null }[] = [
  { table: 'app.pomodoro_sessions', column: 'user_id' },
  { table: 'app.pomodoro_settings', column: 'user_id' },
  { table: 'app.personal_tasks', column: 'user_id' },
  { table: 'app.personal_sprints', column: 'user_id' },
  { table: 'app.personal_notes', column: 'user_id' },
  { table: 'app.personal_canvases', column: 'user_id' },
  // A delivery has no user column of its own; it is reachable only through its notification, which
  // this same user owns -- so the subquery is visible under exactly this GUC and no other.
  { table: 'app.notification_deliveries', column: null },
  { table: 'app.notifications', column: 'user_id' },
  { table: 'app.notification_quiet_hours', column: 'user_id' },
  { table: 'app.notification_prefs', column: 'user_id' },
  { table: 'app.push_subscriptions', column: 'user_id' },
]

/**
 * `global` tables that hold a foreign key at `app.users` or `app.departments`. No RLS, so these are
 * plain deletes -- but they are every bit as able to block the foundation delete (`sessions` and
 * `user_security` were the two that already had a hand-written delete in `demo.ts`, for this exact
 * reason; the rest of this list is the same discovery made systematically instead of one crash at a
 * time).
 */
export const GLOBAL_SWEEP: readonly {
  table: string
  userColumns: readonly string[]
  departmentColumns: readonly string[]
}[] = [
  { table: 'app.event_reminder_jobs', userColumns: [], departmentColumns: ['department_id'] },
  { table: 'app.outbox_events', userColumns: [], departmentColumns: ['department_id'] },
  { table: 'app.join_attempts', userColumns: ['user_id'], departmentColumns: ['department_id'] },
  {
    table: 'app.telegram_group_connect_codes',
    userColumns: ['created_by'],
    departmentColumns: ['department_id'],
  },
  {
    table: 'app.telegram_groups',
    userColumns: ['connected_by'],
    departmentColumns: ['department_id'],
  },
  { table: 'app.telegram_link_codes', userColumns: ['user_id'], departmentColumns: [] },
  { table: 'app.telegram_links', userColumns: ['user_id'], departmentColumns: [] },
  { table: 'app.calendar_feeds', userColumns: ['user_id'], departmentColumns: [] },
  { table: 'app.uploads', userColumns: ['user_id'], departmentColumns: [] },
  { table: 'app.login_challenges', userColumns: ['user_id'], departmentColumns: [] },
  { table: 'app.account_deletion_requests', userColumns: ['user_id'], departmentColumns: [] },
  { table: 'app.wipe_requests', userColumns: ['initiated_by_user_id'], departmentColumns: [] },
  { table: 'app.sentinel_keys', userColumns: ['created_by_user_id'], departmentColumns: [] },
  { table: 'app.setup_tokens', userColumns: ['consumed_by_user_id'], departmentColumns: [] },
  {
    table: 'app.department_requests',
    userColumns: ['requester_user_id'],
    departmentColumns: ['created_department_id'],
  },
  { table: 'app.user_security', userColumns: ['user_id'], departmentColumns: [] },
  { table: 'app.sessions', userColumns: ['user_id'], departmentColumns: [] },
]

/**
 * Tables no demo reset ever has to sweep, each with the reason -- the same shape as
 * `tenancy.ts`'s `GLOBAL_ALLOWLIST`, and checked by the same kind of test, so "this table is fine"
 * is a recorded decision rather than an omission nobody noticed.
 */
export const SWEEP_NOT_NEEDED: Readonly<Record<string, string>> = Object.freeze({
  'app.departments': 'The parent the sweep exists to unblock; deleted by its own module / demo.ts.',
  'app.users': 'The other parent; deleted last, by demo.ts, from DEMO_DELETE_ORDER.',
  'app.instance_settings':
    'Singleton instance configuration; the reset flips is_demo, never deletes.',
  'app.seed_runs': 'The reset deletes its own row by name, as the last step of the run.',
  'app.idempotency_keys': 'Keyed by (key, route) with no foreign key at a user or a department.',
  'app.push_vapid_keys': 'One keypair for the whole deployment; no foreign key at either parent.',
  'app._migrations': 'Migration-runner bookkeeping; carries no foreign key at all.',
  'audit.events': 'Never deleted, by design (I-3, I-5a).',
  'audit.private_reads': 'Audit, never deleted (I-5a).',
  'audit.anchors': 'Audit, never deleted (I-5a).',
})

export type SweepCoverageResult = {
  ok: boolean
  /** Registered in `TENANCY` but neither swept nor explicitly excused here. */
  uncovered: string[]
  /** Named here but no longer in `TENANCY` -- a stale entry to delete. */
  stale: string[]
}

/** Pure, so the coverage test needs no database: every table `TENANCY` knows about must be either
 * swept by one of the three lists above or excused in `SWEEP_NOT_NEEDED`. */
export function checkSweepCoverage(): SweepCoverageResult {
  const covered = new Set<string>([
    ...DEPARTMENT_SWEEP_ORDER.map((t) => t.table),
    ...USER_SWEEP_ORDER.map((t) => t.table),
    ...GLOBAL_SWEEP.map((t) => t.table),
    ...Object.keys(SWEEP_NOT_NEEDED),
  ])
  const known = new Set(Object.keys(TENANCY))
  const uncovered = [...known].filter((t) => !covered.has(t)).sort()
  const stale = [...covered].filter((t) => !known.has(t)).sort()
  return { ok: uncovered.length === 0 && stale.length === 0, uncovered, stale }
}

function uuidArray(ids: readonly string[]): string {
  return `array[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]`
}

/**
 * Deletes every row of every `department_owned` table that belongs to `departmentId`, children
 * first.
 *
 * `userIds` is the demo scope's accounts, and it is not optional in practice: six of these tables
 * are department-scoped for *reading* and owner-only for *writing* (`0905_work_plus.sql`'s
 * "a time log is a statement about what you did", and the same shape for reminders, focus pins and
 * the three saved-view tables). A department-wide delete on one of those matches zero rows however
 * privileged the caller is -- silently, which is the failure mode worth naming: the sweep would
 * report success and the `cards` delete two lines later would fail on
 * `card_time_logs_card_id_fkey`. So those run once per account, with both GUCs pointed.
 */
export async function sweepDepartmentResidue(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[] = [],
): Promise<number> {
  return asDepartment(tx, departmentId, async () => {
    let deleted = 0
    // Only this department's own people can own a row inside it, so the owner loop below runs over
    // the membership list rather than over every demo account -- six departments times every
    // account times six tables is two thousand round trips for nothing, and "no query in a loop"
    // is a convention this file is already stretching (TECH-SPEC §16).
    const members = userIds.length
      ? await tx.raw<{ user_id: string }>(
          sql`select distinct user_id from app.memberships where department_id = ${departmentId}`,
        )
      : []
    const owners = members.map((m) => m.user_id).filter((id) => userIds.includes(id))

    for (const entry of DEPARTMENT_SWEEP_ORDER) {
      if (entry.ownerColumn) {
        for (const userId of owners) {
          // nosemgrep: query-in-loop -- `user_id = app.current_user_id()` is the only predicate
          // these policies accept, so "every owner's rows" is one statement per owner by
          // construction (`personal.ts` writes them the same way, for the same reason).
          const owned = await asUser(tx, userId, () =>
            tx.raw<{ id: string }>(
              sql`delete from ${sql.raw(entry.table)}
                  where department_id = ${departmentId}
                    and ${sql.raw(entry.ownerColumn!)} = ${userId}
                  returning 'x' as id`,
            ),
          )
          deleted += owned.length
        }
        continue
      }
      // nosemgrep: query-in-loop -- one statement per table is the shape of the work: the tables
      // differ, the order between them is the FK order, and there is no set-based way to express
      // "delete from these forty tables" in one round trip.
      const rows = await tx.raw<{ id: string }>(
        sql`delete from ${sql.raw(entry.table)} where department_id = ${departmentId} returning 'x' as id`,
      )
      deleted += rows.length
    }
    return deleted
  })
}

/**
 * Deletes every row of every `user_owned` table owned by `userId`, children first. One user at a
 * time, because `user_id = app.current_user_id()` is the only predicate those policies accept.
 */
export async function sweepUserResidue(tx: Tx, userId: string): Promise<number> {
  return asUser(tx, userId, async () => {
    let deleted = 0
    for (const entry of USER_SWEEP_ORDER) {
      const statement =
        entry.column === null
          ? sql`delete from ${sql.raw(entry.table)}
                where notification_id in (select id from app.notifications)
                returning 'x' as id`
          : sql`delete from ${sql.raw(entry.table)}
                where ${sql.raw(entry.column)} = ${userId} returning 'x' as id`
      // nosemgrep: query-in-loop -- see sweepDepartmentResidue: one statement per table, in FK order.
      const rows = await tx.raw<{ id: string }>(statement)
      deleted += rows.length
    }
    return deleted
  })
}

/**
 * The `global` tables, swept for the whole demo scope at once (no RLS, so no per-row GUC dance).
 * Runs last, after every department- and user-owned table is empty.
 */
export async function sweepGlobalResidue(tx: Tx, scope: DemoScope): Promise<number> {
  let deleted = 0
  for (const entry of GLOBAL_SWEEP) {
    const predicates = [
      ...entry.userColumns
        .filter(() => scope.userIds.length > 0)
        .map((c) => sql`${sql.raw(c)} = any(${sql.raw(uuidArray(scope.userIds))})`),
      ...entry.departmentColumns
        .filter(() => scope.departmentIds.length > 0)
        .map((c) => sql`${sql.raw(c)} = any(${sql.raw(uuidArray(scope.departmentIds))})`),
    ]
    if (predicates.length === 0) continue
    // nosemgrep: query-in-loop -- one statement per table, as above.
    const rows = await tx.raw<{ id: string }>(
      sql`delete from ${sql.raw(entry.table)} where ${sql.join(predicates, sql` or `)} returning 'x' as id`,
    )
    deleted += rows.length
  }
  return deleted
}

/**
 * A demo account's rows inside a department the demo did not create.
 *
 * This is the other half of "a box people have used", and the one the Testcontainers test cannot
 * see: on the real development instance `demo.boshliq` and friends had joined departments an agent
 * had created through the real API ("Blitz sinov boshqarmasi" and the rest that
 * `purge-leftovers.ts` documents). Those memberships hold `memberships_user_id_fkey` straight at
 * `app.users`, so the account delete failed even with every demo department already empty.
 *
 * Only the demo accounts' own rows are touched, never the foreign department itself or anybody
 * else's rows in it -- a reset removes the demo, not somebody else's data (`purge-leftovers.ts` is
 * the command for that, and it soft-deletes). `memberships_write` compares `department_id` to the
 * GUC, so the delete is issued once per foreign department.
 */
async function sweepForeignMemberships(tx: Tx, scope: DemoScope): Promise<number> {
  if (scope.userIds.length === 0) return 0
  // `memberships_read` lets a super_admin -- which is what `demoContext()` is -- read across
  // departments, which is the only way to find out which ones to visit.
  const rows = await tx.raw<{ department_id: string }>(
    sql`select distinct department_id from app.memberships
        where user_id = any(${sql.raw(uuidArray(scope.userIds))})`,
  )
  const foreign = rows.map((r) => r.department_id).filter((id) => !scope.departmentIds.includes(id))

  let deleted = 0
  for (const departmentId of foreign) {
    // nosemgrep: query-in-loop -- one department per iteration is what the RLS scope check requires,
    // exactly as `purge-leftovers.ts`'s own loop documents.
    const removed = await asDepartment(tx, departmentId, () =>
      tx.raw<{ id: string }>(
        sql`delete from app.memberships
            where department_id = ${departmentId}
              and user_id = any(${sql.raw(uuidArray(scope.userIds))})
            returning 'x' as id`,
      ),
    )
    deleted += removed.length
  }
  return deleted
}

/**
 * The whole sweep for one scope: every user-owned table for every demo user, every department-owned
 * table for every demo department, then the global tables. `demo.ts` calls this once, after the
 * modules' own `reset()`s and before the foundation delete.
 */
export async function sweepDemoResidue(tx: Tx, scope: DemoScope): Promise<number> {
  let deleted = 0
  for (const userId of scope.userIds) {
    deleted += await sweepUserResidue(tx, userId)
  }
  for (const departmentId of scope.departmentIds) {
    deleted += await sweepDepartmentResidue(tx, departmentId, scope.userIds)
  }
  deleted += await sweepForeignMemberships(tx, scope)
  deleted += await sweepGlobalResidue(tx, scope)
  return deleted
}
