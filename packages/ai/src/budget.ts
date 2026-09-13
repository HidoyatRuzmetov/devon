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

/**
 * Whether a new call may proceed at all -- the hard stop enforced *before* the call is made, from the
 * worst case the gateway could actually request, rather than only afterwards from the usage the
 * response reports back.
 *
 * v1.1 (AI-AUDIT G-4): this function existed, was exported, and was never called; the only gate in
 * front of a provider call was `checkBudget`, i.e. "have you already exceeded the cap". The
 * consequence was that the single call which crosses a department's monthly budget always went
 * through, at up to `maxMaxTokens`. Passing `estimatedTokens` makes the question the right one:
 * *would* this call exceed the cap.
 *
 * `estimatedTokens` of `0` keeps the old meaning exactly ("is there anything left at all"), which is
 * what a caller that genuinely cannot estimate should pass.
 */
export function canAffordCall(
  spentUzs: number,
  capUzs: number,
  estimatedTokens = 0,
  pricePerMillionUzs: number = DEFAULT_PRICE_PER_MILLION_UZS,
): boolean {
  if (capUzs <= 0) return false
  if (spentUzs >= capUzs) return false
  return spentUzs + tokensToCostUzs(estimatedTokens, pricePerMillionUzs) <= capUzs
}
