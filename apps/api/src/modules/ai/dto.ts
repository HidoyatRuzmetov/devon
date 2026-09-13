// Row -> API DTO mapping for the AI module (snake_case Postgres rows -> camelCase wire shapes),
// exactly the same seam every other module's `dto.ts` already draws.
import { checkBudget } from '@devon/ai'
import type { AiSettingsDto, SearchBackendDto, TraceDto } from './schemas.js'
import type { AiSettingsRow, TraceRow } from './repo.js'

/** H8.1 graceful degradation: `available` is the `ai` circuit breaker's read-only state (see
 * `service.ts`'s `isAiAvailable()`) -- true almost always, false only after GLM has failed repeatedly
 * and recently. While `false`, every flag in the response is forced to `false` regardless of what the
 * department head actually configured: the underlying row is untouched (a PATCH still writes and
 * reads back the real values once AI recovers), but every screen that gates an AI entry point on
 * `settings.flags[feature] === true` (`ai-settings-screen.tsx`, `assistant-panel.tsx`,
 * `card-detail.tsx`, `quick-add-bar.tsx`, `project-page-screen.tsx`) already exists and already reads
 * this exact field -- so "AI off -> features hide and say so" (H8.1) falls out of this one change
 * with no edit to any of those files. */
export function settingsToDto(
  row: AiSettingsRow,
  spentUzsThisMonth: number,
  available: boolean,
  extra: {
    /** AI-AUDIT §5 fix 15 -- head-only, stripped again by `service.getSettingsWithUsage` for a member. */
    spendByFeature: Record<string, number>
    /** v1.1 SPEC §8 "Honesty": no key configured, so every answer comes from the offline simulator. */
    simulated: boolean
    search: SearchBackendDto
  },
): AiSettingsDto {
  const budget = checkBudget(spentUzsThisMonth, row.budget_uzs_per_month, row.soft_cap_pct)
  const flags = available
    ? row.flags
    : Object.fromEntries(Object.keys(row.flags).map((key) => [key, false]))
  return {
    departmentId: row.department_id,
    budgetUzsPerMonth: row.budget_uzs_per_month,
    softCapPct: row.soft_cap_pct,
    flags,
    spentUzsThisMonth,
    remainingUzs: budget.remainingUzs,
    budgetStatus: budget.status,
    usedPct: budget.usedPct,
    available,
    unavailableReason: available ? null : 'circuit_open',
    spendByFeature: extra.spendByFeature,
    simulated: extra.simulated,
    search: extra.search,
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
    userName: row.user_name,
  }
}
