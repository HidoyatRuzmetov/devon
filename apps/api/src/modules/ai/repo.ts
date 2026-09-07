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
export async function getSettings(tx: Tx, departmentId: string): Promise<AiSettingsRow> {
  const existing = await tx.raw<AiSettingsRow>(sql`
    select department_id, budget_uzs_per_month, soft_cap_pct, flags
    from app.ai_department_settings where department_id = ${departmentId}
  `)
  if (existing[0]) return existing[0]

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

export type TraceRow = {
  id: string
  user_id: string
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

export async function listTraces(tx: Tx, departmentId: string, limit: number): Promise<TraceRow[]> {
  return tx.raw<TraceRow>(sql`
    select id, user_id, feature, model, prompt_tokens, completion_tokens, total_tokens, cost_uzs,
           latency_ms, retried, status, created_at
    from app.ai_traces
    where department_id = ${departmentId}
    order by created_at desc
    limit ${limit}
  `)
}
