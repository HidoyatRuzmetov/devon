// Postgres access for the automations module (EPIC-017). Same rules as every other module's repo:
// `withContext()`/`tx.raw()` directly, one transaction per function, no query in a loop.
import { randomUUID } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import {
  automationActionSchema,
  automationTriggerConfigSchema,
  type AutomationAction,
  type AutomationRunStatus,
  type AutomationTrigger,
  type AutomationTriggerConfig,
} from '@devon/contracts'

export type AutomationRule = {
  id: string
  name: string
  trigger: AutomationTrigger
  triggerConfig: AutomationTriggerConfig
  actions: AutomationAction[]
  enabled: boolean
  runCount: number
  lastRunAt: string | null
  lastError: string | null
  createdAt: string
  version: number
}

type RuleRow = {
  id: string
  name: string
  trigger: AutomationTrigger
  trigger_config: unknown
  actions: unknown
  enabled: boolean
  run_count: number
  last_run_at: Date | null
  last_error: string | null
  created_at: Date
  version: number
}

/** A stored rule written by an older build (or edited by hand) must never reach the engine as a
 * shape the contract does not describe: anything that fails to parse becomes an empty config and an
 * empty action list, which makes the rule a no-op the head can see and fix rather than a crash. */
function toRule(row: RuleRow): AutomationRule {
  const config = automationTriggerConfigSchema.safeParse(row.trigger_config ?? {})
  const rawActions = Array.isArray(row.actions) ? row.actions : []
  const actions = rawActions
    .map((a) => automationActionSchema.safeParse(a))
    .filter((r): r is { success: true; data: AutomationAction } => r.success)
    .map((r) => r.data)
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    triggerConfig: config.success ? config.data : {},
    actions,
    enabled: row.enabled,
    runCount: Number(row.run_count ?? 0),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    version: row.version,
  }
}

const RULE_COLUMNS = sql`id, name, trigger, trigger_config, actions, enabled, run_count,
  last_run_at, last_error, created_at, version`

export async function listRules(
  ctx: RequestContext,
  departmentId: string,
): Promise<AutomationRule[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<RuleRow>(
      sql`select ${RULE_COLUMNS} from app.automation_rules
          where department_id = ${departmentId} and deleted_at is null
          order by enabled desc, created_at desc
          limit 200`,
    )
    return rows.map(toRule)
  })
}

/** The engine's own read: every enabled rule in this department for one trigger, in one indexed
 * pass (`automation_rules_trigger_idx`) rather than "all rules, then filter in JavaScript". */
export async function listEnabledRulesForTrigger(
  ctx: RequestContext,
  departmentId: string,
  trigger: AutomationTrigger,
): Promise<AutomationRule[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<RuleRow>(
      sql`select ${RULE_COLUMNS} from app.automation_rules
          where department_id = ${departmentId} and trigger = ${trigger}
            and enabled = true and deleted_at is null
          order by created_at asc
          limit 50`,
    )
    return rows.map(toRule)
  })
}

export async function countRules(ctx: RequestContext, departmentId: string): Promise<number> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ cnt: string }>(
      sql`select count(*) as cnt from app.automation_rules
          where department_id = ${departmentId} and deleted_at is null`,
    )
    return Number(rows[0]?.cnt ?? 0)
  })
}

export async function createRule(
  ctx: RequestContext,
  departmentId: string,
  createdByUserId: string,
  input: {
    name: string
    trigger: AutomationTrigger
    triggerConfig: AutomationTriggerConfig
    actions: AutomationAction[]
    enabled: boolean
  },
): Promise<string> {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.automation_rules
            (id, department_id, name, trigger, trigger_config, actions, enabled, created_by_user_id)
          values (${id}, ${departmentId}, ${input.name}, ${input.trigger},
                  ${JSON.stringify(input.triggerConfig)}::jsonb,
                  ${JSON.stringify(input.actions)}::jsonb, ${input.enabled}, ${createdByUserId})`,
    )
    tx.audit({
      action: 'automations.rule_created',
      subjectType: 'automation_rule',
      subjectId: id,
      departmentId,
      after: {
        name: input.name,
        trigger: input.trigger,
        enabled: input.enabled,
      },
    })
    return id
  })
}

export async function patchRule(
  ctx: RequestContext,
  departmentId: string,
  id: string,
  patch: {
    name?: string | undefined
    triggerConfig?: AutomationTriggerConfig | undefined
    actions?: AutomationAction[] | undefined
    enabled?: boolean | undefined
  },
  expectedVersion: number | undefined,
): Promise<'ok' | 'not_found' | 'conflict'> {
  return withContext(ctx, async (tx) => {
    const sets: SQL[] = [sql`updated_at = now()`, sql`version = version + 1`]
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`)
    if (patch.triggerConfig !== undefined) {
      sets.push(sql`trigger_config = ${JSON.stringify(patch.triggerConfig)}::jsonb`)
    }
    if (patch.actions !== undefined) {
      sets.push(sql`actions = ${JSON.stringify(patch.actions)}::jsonb`)
    }
    if (patch.enabled !== undefined) {
      sets.push(sql`enabled = ${patch.enabled}`)
      // Re-enabling a rule clears the failure that made the head look at it -- otherwise the card
      // keeps showing an error from a problem they have just fixed.
      if (patch.enabled) sets.push(sql`last_error = null`)
    }
    const guard = expectedVersion === undefined ? sql`` : sql` and version = ${expectedVersion}`
    const rows = await tx.raw<{ id: string }>(
      sql`update app.automation_rules set ${sql.join(sets, sql`, `)}
          where id = ${id} and department_id = ${departmentId} and deleted_at is null${guard}
          returning id`,
    )
    if (rows.length === 0) {
      const exists = await tx.raw<{ id: string }>(
        sql`select id from app.automation_rules
            where id = ${id} and department_id = ${departmentId} and deleted_at is null`,
      )
      return exists.length > 0 ? 'conflict' : 'not_found'
    }
    tx.audit({
      action: 'automations.rule_updated',
      subjectType: 'automation_rule',
      subjectId: id,
      departmentId,
      after: patch,
    })
    return 'ok'
  })
}

export async function deleteRule(
  ctx: RequestContext,
  departmentId: string,
  id: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`update app.automation_rules set deleted_at = now(), updated_at = now(), enabled = false
          where id = ${id} and department_id = ${departmentId} and deleted_at is null
          returning id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'automations.rule_removed',
      subjectType: 'automation_rule',
      subjectId: id,
      departmentId,
    })
    return true
  })
}

/** The kill switch (SPEC §7: "a head-only rule builder with a run log and a kill switch"). One
 * statement for every rule in the department -- the point of a kill switch is that it is one act,
 * not twenty-five. */
export async function setAllRulesEnabled(
  ctx: RequestContext,
  departmentId: string,
  enabled: boolean,
): Promise<number> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`update app.automation_rules
          set enabled = ${enabled}, updated_at = now(), version = version + 1
          where department_id = ${departmentId} and deleted_at is null and enabled <> ${enabled}
          returning id`,
    )
    tx.audit({
      action: enabled ? 'automations.all_resumed' : 'automations.all_paused',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      after: { count: rows.length },
    })
    return rows.length
  })
}

export type RunRow = {
  id: string
  ruleId: string
  ruleName: string
  cardId: string | null
  cardTitle: string | null
  status: AutomationRunStatus
  detail: { actions?: string[]; reason?: string; error?: string }
  at: string
}

export async function listRuns(
  ctx: RequestContext,
  departmentId: string,
  options: {
    ruleId?: string | undefined
    limit: number
    cursor?: string | undefined
  },
): Promise<{ items: RunRow[]; nextCursor: string | null; total: number }> {
  return withContext(ctx, async (tx) => {
    const ruleFilter = options.ruleId ? sql` and r.rule_id = ${options.ruleId}` : sql``
    const cursorFilter = options.cursor ? sql` and r.at < ${options.cursor}` : sql``
    const rows = await tx.raw<{
      id: string
      rule_id: string
      rule_name: string
      card_id: string | null
      card_title: string | null
      status: AutomationRunStatus
      detail: { actions?: string[]; reason?: string; error?: string } | null
      at: Date
    }>(
      sql`select r.id, r.rule_id, ar.name as rule_name, c.id as card_id, c.title as card_title,
                 r.status, r.detail, r.at
          from app.automation_runs r
          join app.automation_rules ar on ar.id = r.rule_id
          left join app.cards c on c.id = r.card_id and c.deleted_at is null
          where r.department_id = ${departmentId}${ruleFilter}${cursorFilter}
          order by r.at desc
          limit ${options.limit + 1}`,
    )
    const page = rows.slice(0, options.limit)
    // v1.1 recapture §1a #9: the rule card said "79 marta ishlagan" and the log under it said
    // "50 ta ishga tushish", because the log was counting the rows it had been handed -- one page --
    // and presenting that as the number of runs. The page is a page; the total is a fact about the
    // filter, and only the database can answer it. Same `where` clause as the page query, minus the
    // cursor, so the two can never mean different things.
    const totals = await tx.raw<{ n: number }>(
      sql`select count(*)::int as n
          from app.automation_runs r
          where r.department_id = ${departmentId}${ruleFilter}`,
    )
    return {
      total: totals[0]?.n ?? page.length,
      items: page.map((r) => ({
        id: r.id,
        ruleId: r.rule_id,
        ruleName: r.rule_name,
        cardId: r.card_id,
        cardTitle: r.card_title,
        status: r.status,
        detail: r.detail ?? {},
        at: new Date(r.at).toISOString(),
      })),
      nextCursor:
        rows.length > options.limit && page.length > 0
          ? new Date(page[page.length - 1]!.at).toISOString()
          : null,
    }
  })
}

/** Written by the engine for *every* evaluation, applied or not -- the run log is the reason
 * automations are usable rather than frightening (CLICKUP-RESEARCH §7.3). */
export async function recordRun(
  ctx: RequestContext,
  departmentId: string,
  input: {
    ruleId: string
    cardId: string | null
    status: AutomationRunStatus
    detail: { actions?: string[]; reason?: string; error?: string }
  },
): Promise<void> {
  await withContext(ctx, async (tx) => {
    await tx.raw(
      sql`insert into app.automation_runs (id, department_id, rule_id, card_id, status, detail)
          values (${randomUUID()}, ${departmentId}, ${input.ruleId}, ${input.cardId},
                  ${input.status}, ${JSON.stringify(input.detail)}::jsonb)`,
    )
    if (input.status === 'applied') {
      await tx.raw(
        sql`update app.automation_rules
            set run_count = run_count + 1, last_run_at = now(), last_error = null
            where id = ${input.ruleId}`,
      )
    } else if (input.status === 'failed') {
      await tx.raw(
        sql`update app.automation_rules set last_run_at = now(), last_error = ${input.detail.error ?? 'unknown'}
            where id = ${input.ruleId}`,
      )
    }
    // Publish identifiers only; clients refetch the authorized run log after this transaction.
    tx.emit({
      type: 'automations.run.recorded',
      departmentId,
      payload: { ruleId: input.ruleId, cardId: input.cardId },
    })
  })
}

/** Cards whose due date has just crossed a line -- the two time-based triggers, resolved in one
 * query per department per tick rather than per rule. */
export async function listCardsForTimeTrigger(
  ctx: RequestContext,
  departmentId: string,
  trigger: 'card_due_soon' | 'card_overdue',
  daysAhead: number,
): Promise<Array<{ id: string }>> {
  return withContext(ctx, async (tx) => {
    const window =
      trigger === 'card_overdue'
        ? sql`c.due_at < now()`
        : sql`c.due_at >= now() and c.due_at < now() + (${daysAhead} * interval '1 day')`
    const rows = await tx.raw<{ id: string }>(
      sql`select c.id from app.cards c
          where c.department_id = ${departmentId} and c.deleted_at is null and c.status = 'active'
            and c.due_at is not null and ${window}
          order by c.due_at asc
          limit 200`,
    )
    return rows
  })
}

/** Every department that has at least one enabled time-based rule -- the tick's own starting point,
 * so a department with no automations costs nothing. */
export async function listDepartmentsWithTimeTriggers(
  ctx: RequestContext,
): Promise<Array<{ departmentId: string }>> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ department_id: string }>(
      sql`select distinct department_id from app.automation_rules
          where enabled = true and deleted_at is null
            and trigger in ('card_due_soon', 'card_overdue')
          limit 500`,
    )
    return rows.map((r) => ({ departmentId: r.department_id }))
  })
}

/** Has this rule already acted on this card today? The time-based triggers fire on a schedule, so
 * without this an overdue card would be re-labelled every hour for as long as it stayed overdue. */
export async function hasRecentApplied(
  ctx: RequestContext,
  departmentId: string,
  ruleId: string,
  cardId: string,
  withinHours: number,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ one: number }>(
      sql`select 1 as one from app.automation_runs
          where department_id = ${departmentId} and rule_id = ${ruleId} and card_id = ${cardId}
            and status = 'applied' and at > now() - (${withinHours} * interval '1 hour')
          limit 1`,
    )
    return rows.length > 0
  })
}
