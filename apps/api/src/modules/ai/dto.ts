// Row -> API DTO mapping for the AI module (snake_case Postgres rows -> camelCase wire shapes),
// exactly the same seam every other module's `dto.ts` already draws.
import { checkBudget } from '@devon/ai'
import type { AiSettingsDto, TraceDto } from './schemas.js'
import type { AiSettingsRow, TraceRow } from './repo.js'

export function settingsToDto(row: AiSettingsRow, spentUzsThisMonth: number): AiSettingsDto {
  const budget = checkBudget(spentUzsThisMonth, row.budget_uzs_per_month, row.soft_cap_pct)
  return {
    departmentId: row.department_id,
    budgetUzsPerMonth: row.budget_uzs_per_month,
    softCapPct: row.soft_cap_pct,
    flags: row.flags,
    spentUzsThisMonth,
    remainingUzs: budget.remainingUzs,
    budgetStatus: budget.status,
    usedPct: budget.usedPct,
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function traceToDto(row: TraceRow): TraceDto {
  return {
    id: row.id,
    userId: row.user_id,
    feature: row.feature as TraceDto['feature'],
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    costUzs: row.cost_uzs,
    latencyMs: row.latency_ms,
    retried: row.retried,
    status: row.status,
    createdAt: toIso(row.created_at),
  }
}
