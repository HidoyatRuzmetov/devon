// Postgres-backed data access for the AI module (MODULE-GUIDE.md "API modules": "never a direct
// `@devon/db` import from a route handler" -- only this file and `service.ts` touch `Tx`). Every
// function takes the already-open `Tx` (opened by `service.ts`'s `withContext()` call, exactly like
// the events module's `repo.ts`/`service.ts` split) and never opens a connection itself.
//
// `ai_traces` never carries prompt/response text (`packages/db/src/schema/ai.ts`'s header) -- every
// insert below writes only the fields this file's own `InsertTraceInput` type declares, which has no
// content field to accidentally pass one through even if a future caller tried.
import { sql } from 'drizzle-orm'
import type { Tx } from '@devon/db'

export type AiSettingsRow = {
  department_id: string
  budget_uzs_per_month: number
  soft_cap_pct: number
  flags: Record<string, boolean>
}

/**
 * Lazily creates the department's settings row on first read (same "singleton row, upserted on first
 * touch" shape `apps/api/src/modules/personal/repo.ts`'s `getPomodoroSettings` already uses) -- a
 * department that has never touched its AI settings still gets a real row back (`budgetUzsPerMonth:
 * 0`, which `@devon/ai`'s `checkBudget` treats as an implicit hard stop) rather than a special-cased
 * "not configured yet" shape the caller would have to branch on separately.
 */
export async function getSettings(
  tx: Tx,
  departmentId: string,
  /** v1.1: only a head may CREATE the row (`ai_department_settings_write`, migration 0904 -- and the
   * matrix, which says budget and flags are the head's). A member reading a department that has never
   * touched its AI settings gets the same defaults in memory instead of a 500 from an RLS-refused
   * insert: the read is not the place to discover that nobody has configured anything yet. */
  mayInitialise = true,
): Promise<AiSettingsRow> {
  const existing = await tx.raw<AiSettingsRow>(sql`
    select department_id, budget_uzs_per_month, soft_cap_pct, flags
    from app.ai_department_settings where department_id = ${departmentId}
  `)
  if (existing[0]) return existing[0]
  if (!mayInitialise) {
    return {
      department_id: departmentId,
      budget_uzs_per_month: 0,
      soft_cap_pct: 80,
      flags: {},
    } as AiSettingsRow
  }

  const inserted = await tx.raw<AiSettingsRow>(sql`
    insert into app.ai_department_settings (department_id) values (${departmentId})
    on conflict (department_id) do nothing
    returning department_id, budget_uzs_per_month, soft_cap_pct, flags
  `)
  if (inserted[0]) return inserted[0]

  // Lost the insert race to a concurrent request: the row exists now, read it back.
  const retry = await tx.raw<AiSettingsRow>(sql`
    select department_id, budget_uzs_per_month, soft_cap_pct, flags
    from app.ai_department_settings where department_id = ${departmentId}
  `)
  return retry[0]!
}

export type PatchSettingsInput = {
  budgetUzsPerMonth?: number | undefined
  softCapPct?: number | undefined
  flags?: Record<string, boolean> | undefined
}

export async function patchSettings(
  tx: Tx,
  departmentId: string,
  patch: PatchSettingsInput,
): Promise<AiSettingsRow> {
  // Ensure the row exists first (same lazy-create as getSettings) so a head can turn a flag on before
  // anyone has ever made a call -- an `update ... where department_id = x` against a row that does not
  // exist yet would silently affect zero rows.
  const current = await getSettings(tx, departmentId)

  const nextBudget = patch.budgetUzsPerMonth ?? current.budget_uzs_per_month
  const nextSoftCap = patch.softCapPct ?? current.soft_cap_pct
  const nextFlags = patch.flags ? { ...current.flags, ...patch.flags } : current.flags

  const rows = await tx.raw<AiSettingsRow>(sql`
    update app.ai_department_settings
    set budget_uzs_per_month = ${nextBudget},
        soft_cap_pct = ${nextSoftCap},
        flags = ${JSON.stringify(nextFlags)}::jsonb,
        updated_at = now()
    where department_id = ${departmentId}
    returning department_id, budget_uzs_per_month, soft_cap_pct, flags
  `)
  return rows[0]!
}

/** Sum of `cost_uzs` for every trace this department has recorded since the first of the current
 * calendar month, in the database's own clock (`date_trunc`, not an app-computed boundary) -- the same
 * "let Postgres own the calendar math" choice `notifications`' quiet-hours logic makes. */
export async function spentThisMonthUzs(tx: Tx, departmentId: string): Promise<number> {
  const rows = await tx.raw<{ total: number | null }>(sql`
    select coalesce(sum(cost_uzs), 0)::int as total
    from app.ai_traces
    where department_id = ${departmentId}
      and created_at >= date_trunc('month', now())
  `)
  return rows[0]?.total ?? 0
}

export type InsertTraceInput = {
  departmentId: string
  userId: string
  feature: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUzs: number
  latencyMs: number
  retried: boolean
  status:
    | 'ok'
    | 'empty_after_retry'
    | 'schema_invalid_after_retry'
    | 'provider_error'
    | 'blocked_budget'
    | 'blocked_flag'
}

export async function insertTrace(tx: Tx, input: InsertTraceInput): Promise<string> {
  const rows = await tx.raw<{ id: string }>(sql`
    insert into app.ai_traces (
      department_id, user_id, feature, model, prompt_tokens, completion_tokens, total_tokens,
      cost_uzs, latency_ms, retried, status
    ) values (
      ${input.departmentId}, ${input.userId}, ${input.feature}, ${input.model},
      ${input.promptTokens}, ${input.completionTokens}, ${input.totalTokens},
      ${input.costUzs}, ${input.latencyMs}, ${input.retried}, ${input.status}
    )
    returning id
  `)
  return rows[0]!.id
}

/**
 * AI-AUDIT §5 fix 15: this month's spend broken down per feature, so `/ai` can show a head *which*
 * helper is expensive instead of only how much is left. One grouped aggregate, never one query per
 * feature (I-9).
 */
export async function spentThisMonthByFeature(
  tx: Tx,
  departmentId: string,
): Promise<Record<string, number>> {
  const rows = await tx.raw<{ feature: string; total: number }>(sql`
    select feature, coalesce(sum(cost_uzs), 0)::int as total
    from app.ai_traces
    where department_id = ${departmentId}
      and created_at >= date_trunc('month', now())
    group by feature
  `)
  return Object.fromEntries(rows.map((row) => [row.feature, row.total]))
}

export type TraceRow = {
  id: string
  user_id: string
  user_name: string
  feature: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_uzs: number
  latency_ms: number
  retried: boolean
  status: InsertTraceInput['status']
  created_at: Date | string
}

/** `onlyUserId` non-null narrows the list to one person's own runs (v1.1 SPEC §2.2, D2b). A single
 * parameterised predicate rather than two query strings, so the index
 * (`ai_traces_department_created_idx`) is used either way and there is one statement to read. */
export async function listTraces(
  tx: Tx,
  departmentId: string,
  limit: number,
  onlyUserId: string | null = null,
): Promise<TraceRow[]> {
  // SPEC §12 "the AI trace has a 'who ran it' column": joined here, in the same statement, rather
  // than resolved per row by the caller (I-9). `left join` because a trace outlives the person --
  // a xodim who has left the department must not make their own history unreadable.
  return tx.raw<TraceRow>(sql`
    select t.id, t.user_id,
           coalesce(nullif(trim(concat_ws(' ', u.family_name, u.given_name)), ''), '') as user_name,
           t.feature, t.model,
           t.prompt_tokens, t.completion_tokens, t.total_tokens, t.cost_uzs,
           t.latency_ms, t.retried, t.status, t.created_at
    from app.ai_traces t
    left join app.memberships m
      on m.user_id = t.user_id and m.department_id = t.department_id and m.deleted_at is null
    left join app.users u on u.id = m.user_id
    where t.department_id = ${departmentId}
      and (${onlyUserId}::uuid is null or t.user_id = ${onlyUserId}::uuid)
    order by t.created_at desc
    limit ${limit}
  `)
}
