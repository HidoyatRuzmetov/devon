import { describe, expect, it } from 'vitest'
import { settingsToDto, traceToDto } from '../../../src/modules/ai/dto.js'
import type { AiSettingsRow, TraceRow } from '../../../src/modules/ai/repo.js'

describe('settingsToDto', () => {
  const row: AiSettingsRow = {
    department_id: '11111111-1111-1111-1111-111111111111',
    budget_uzs_per_month: 1_000_000,
    soft_cap_pct: 80,
    flags: { translate: true, plan_sprint: false },
  }

  it('reports ok well under the soft cap', () => {
    const dto = settingsToDto(row, 10_000)
    expect(dto.budgetStatus).toBe('ok')
    expect(dto.remainingUzs).toBe(990_000)
    expect(dto.flags).toEqual({ translate: true, plan_sprint: false })
  })

  it('reports soft_cap at or above the configured percentage', () => {
    const dto = settingsToDto(row, 850_000)
    expect(dto.budgetStatus).toBe('soft_cap')
  })

  it('reports hard_stop once spend reaches the cap, with zero remaining', () => {
    const dto = settingsToDto(row, 1_000_000)
    expect(dto.budgetStatus).toBe('hard_stop')
    expect(dto.remainingUzs).toBe(0)
  })

  it('reports hard_stop when no budget has been configured (cap = 0)', () => {
    const dto = settingsToDto({ ...row, budget_uzs_per_month: 0 }, 0)
    expect(dto.budgetStatus).toBe('hard_stop')
  })
})

describe('traceToDto', () => {
  it('maps snake_case columns to the camelCase wire shape and ISO-stamps the date', () => {
    const row: TraceRow = {
      id: '22222222-2222-2222-2222-222222222222',
      user_id: '33333333-3333-3333-3333-333333333333',
      feature: 'translate',
      model: 'glm-5.2',
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost_uzs: 3,
      latency_ms: 900,
      retried: false,
      status: 'ok',
      created_at: '2026-09-08T07:00:00.000Z',
    }
    const dto = traceToDto(row)
    expect(dto).toEqual({
      id: row.id,
      userId: row.user_id,
      feature: 'translate',
      model: 'glm-5.2',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUzs: 3,
      latencyMs: 900,
      retried: false,
      status: 'ok',
      createdAt: '2026-09-08T07:00:00.000Z',
    })
  })

  it('accepts a real Date object for created_at as well as a string', () => {
    const row: TraceRow = {
      id: '4',
      user_id: 'u',
      feature: 'translate',
      model: 'glm-5.2',
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      cost_uzs: 0,
      latency_ms: 1,
      retried: false,
      status: 'ok',
      created_at: new Date('2026-09-08T00:00:00.000Z'),
    }
    expect(traceToDto(row).createdAt).toBe('2026-09-08T00:00:00.000Z')
  })
})
