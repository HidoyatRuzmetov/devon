// Pure budget math (TECH-SPEC §8: "per-department monthly budget in UZS ... with a soft cap, an
// admin alert and a hard stop"). No I/O here at all -- the department's configured cap and its spend
// so far this month are read by `apps/api/src/modules/ai/repo.ts` and handed in; this file only
// decides what to do with the numbers, so it is exhaustively unit-testable without Postgres.
import { DEFAULT_PRICE_PER_MILLION_UZS } from './config.js'

/** UZS cost of `totalTokens` at the configured per-million-token price, rounded to the nearest whole
 * so`.js` never has to carry fractional UZS around (there is no such thing as a fractional som). */
export function tokensToCostUzs(
  totalTokens: number,
  pricePerMillionUzs: number = DEFAULT_PRICE_PER_MILLION_UZS,
): number {
  return Math.round((totalTokens / 1_000_000) * pricePerMillionUzs)
}

export type BudgetStatus = 'ok' | 'soft_cap' | 'hard_stop'

export type BudgetCheck = {
  status: BudgetStatus
  spentUzs: number
  capUzs: number
  remainingUzs: number
  /** 0-100+, i.e. can exceed 100 once the hard stop has actually been crossed (a trace written in the
   * same request that pushed spend over the cap is never retroactively deleted -- see repo.ts). */
  usedPct: number
}

/** `softCapPct` is a fraction of `capUzs` (TECH-SPEC default: 80%, department-configurable). A cap of
 * `0` means "no budget configured yet" and is treated as an implicit hard stop -- a department must
 * set a real number before any feature can spend anything, never an accidental unlimited default. */
export function checkBudget(
  spentUzs: number,
  capUzs: number,
  softCapPct: number = 80,
): BudgetCheck {
  const usedPct = capUzs > 0 ? (spentUzs / capUzs) * 100 : 100
  const remainingUzs = Math.max(0, capUzs - spentUzs)
  let status: BudgetStatus = 'ok'
  if (capUzs <= 0 || spentUzs >= capUzs) status = 'hard_stop'
  else if (usedPct >= softCapPct) status = 'soft_cap'
  return { status, spentUzs, capUzs, remainingUzs, usedPct }
}

/** Whether a new call estimated to cost `estimatedCostUzs` may proceed at all -- the hard stop is
 * enforced *before* the call is made (an estimate from `maxTokens`, the worst case), not only after
 * the fact from the real usage the response reports back. A soft-cap department still gets to spend
 * right up to (and slightly over, on the call that crosses it) its cap; a hard-stop department cannot
 * start a new call once `spentUzs` has already reached `capUzs`. */
export function canAffordCall(spentUzs: number, capUzs: number): boolean {
  if (capUzs <= 0) return false
  return spentUzs < capUzs
}
