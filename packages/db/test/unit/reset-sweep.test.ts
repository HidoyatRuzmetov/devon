// The reset sweep's coverage guard -- the same mechanism `tenancy.registry.test.ts` is for the
// tenancy registry, and for the same reason: `seed:reset --demo` broke three times in a row, each
// time on a table somebody added without asking what a demo reset should do with it. A table that
// appears in `TENANCY` and in neither `reset-sweep.ts`'s sweep lists nor its `SWEEP_NOT_NEEDED`
// allowlist fails this test, which fails the `unit` gate, which fails the build.
//
// Pure: no database, no Docker. The behavioural proof that the sweep actually clears a used
// instance lives in `test/seed.idempotence.test.ts` ("a database people have used").
import { describe, expect, it } from 'vitest'
import {
  DEPARTMENT_SWEEP_ORDER,
  GLOBAL_SWEEP,
  SWEEP_NOT_NEEDED,
  USER_SWEEP_ORDER,
  checkSweepCoverage,
} from '../../src/seed/reset-sweep.js'
import { TENANCY } from '../../src/tenancy.js'

describe('reset sweep coverage', () => {
  it('every table the tenancy registry knows about has a recorded decision', () => {
    const result = checkSweepCoverage()
    expect(
      result.uncovered,
      `Add each of these to reset-sweep.ts -- to a sweep list if a demo reset has to clear it, or to SWEEP_NOT_NEEDED with the reason it never holds a demo row:\n${result.uncovered.join('\n')}`,
    ).toEqual([])
    expect(
      result.stale,
      `These are swept or excused but no longer in TENANCY -- delete the stale entries:\n${result.stale.join('\n')}`,
    ).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('no table is named twice across the three sweep lists', () => {
    const all = [
      ...DEPARTMENT_SWEEP_ORDER.map((e) => e.table),
      ...USER_SWEEP_ORDER.map((e) => e.table),
      ...GLOBAL_SWEEP.map((e) => e.table),
      ...Object.keys(SWEEP_NOT_NEEDED),
    ]
    const seen = new Set<string>()
    const duplicated = all.filter((t) => (seen.has(t) ? true : (seen.add(t), false)))
    expect(duplicated).toEqual([])
  })

  it('sweeps every department_owned table by department and every user_owned table by user', () => {
    // The class in the registry decides which list a table belongs in: a department-scoped policy
    // can only be satisfied by `app.department_id`, an owner-only one only by `app.user_id`. Getting
    // this pairing wrong is the failure mode that deletes zero rows and reports success.
    const departmentSwept = new Set(DEPARTMENT_SWEEP_ORDER.map((e) => e.table))
    const userSwept = new Set(USER_SWEEP_ORDER.map((e) => e.table))
    const excused = new Set(Object.keys(SWEEP_NOT_NEEDED))

    const misplaced: string[] = []
    for (const [table, klass] of Object.entries(TENANCY)) {
      if (excused.has(table) || klass === 'audit') continue
      if (klass === 'department_owned' && !departmentSwept.has(table)) {
        misplaced.push(`${table}: department_owned but not in DEPARTMENT_SWEEP_ORDER`)
      }
      if (klass === 'user_owned' && !userSwept.has(table)) {
        misplaced.push(`${table}: user_owned but not in USER_SWEEP_ORDER`)
      }
      if (klass === 'department_owned' && userSwept.has(table)) {
        misplaced.push(`${table}: department_owned but swept per user`)
      }
      if (klass === 'user_owned' && departmentSwept.has(table)) {
        misplaced.push(`${table}: user_owned but swept per department`)
      }
    }
    expect(misplaced).toEqual([])
  })

  it('orders children before their parents inside the department sweep', () => {
    // A handful of the foreign keys `seed:reset --demo` actually died on, asserted as an order
    // rather than as a comment. `NO ACTION` is the delete rule on every FK in the app schema, so a
    // parent listed before its child is a crash on the next used instance, not a style preference.
    const at = (t: string): number => DEPARTMENT_SWEEP_ORDER.findIndex((e) => e.table === t)
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['app.automation_runs', 'app.automation_rules'],
      ['app.automation_runs', 'app.cards'],
      ['app.card_activity', 'app.cards'],
      ['app.card_comments', 'app.cards'],
      ['app.card_checklist_items', 'app.cards'],
      ['app.card_dependencies', 'app.cards'],
      ['app.card_reminders', 'app.cards'],
      ['app.card_time_logs', 'app.cards'],
      ['app.focus_pins', 'app.cards'],
      ['app.cards', 'app.projects'],
      ['app.field_requests', 'app.field_defs'],
      ['app.field_values', 'app.field_defs'],
      ['app.event_telegram_deliveries', 'app.polls'],
      ['app.event_telegram_deliveries', 'app.events'],
      ['app.poll_votes', 'app.poll_options'],
      ['app.poll_options', 'app.polls'],
      ['app.polls', 'app.events'],
      ['app.carpool_seats', 'app.carpools'],
      ['app.carpools', 'app.events'],
      ['app.event_rsvps', 'app.events'],
      ['app.page_versions', 'app.pages'],
      ['app.onboarding_runs', 'app.onboarding_templates'],
      ['app.unit_roles', 'app.units'],
    ]
    for (const [child, parent] of pairs) {
      expect(at(child), `${child} must be swept before ${parent}`).toBeGreaterThanOrEqual(0)
      expect(at(parent), `${parent} must be in the sweep`).toBeGreaterThanOrEqual(0)
      expect(at(child), `${child} must be swept before ${parent}`).toBeLessThan(at(parent))
    }
  })

  it('sweeps notification deliveries before the notifications they hang off', () => {
    const order = USER_SWEEP_ORDER.map((e) => e.table)
    expect(order.indexOf('app.notification_deliveries')).toBeLessThan(
      order.indexOf('app.notifications'),
    )
    expect(order.indexOf('app.pomodoro_sessions')).toBeLessThan(order.indexOf('app.personal_tasks'))
    expect(order.indexOf('app.personal_tasks')).toBeLessThan(order.indexOf('app.personal_sprints'))
  })

  it('gives every excused table a written reason', () => {
    for (const [table, reason] of Object.entries(SWEEP_NOT_NEEDED)) {
      expect(reason.length, `${table} needs a real reason, not a placeholder`).toBeGreaterThan(20)
    }
  })
})
