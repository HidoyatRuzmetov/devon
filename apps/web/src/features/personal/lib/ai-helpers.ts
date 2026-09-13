// Small shared helpers for the AI wiring points across this feature's screens (quick-add parse on
// the quick-add row, the step breakdown on a to-do row, the period plan on an active period, the
// catch-up briefing in the history section, translate on a note). Kept here rather than duplicated
// four times, since `features/ai` is import-only from this module (UI-OVERHAUL.md: a wave agent never
// edits another feature's folder).
import { formatNumber, formatUzs, type useT, type Locale } from '@devon/i18n'

/** Moved to `features/ai/lib/errors.ts` in v1.1, where every host screen that runs an AI feature can
 * reach it -- re-exported here so this module's four call sites keep their existing import. */
export { aiErrorMessageKey } from '../../ai/lib/errors.js'

/**
 * The `costLine` every `<AiPreviewPanel>` shows in its footer (TECH-SPEC §8: "the cost of every run
 * is visible").
 *
 * v1.1 (AI-AUDIT §5 fix 9): the price leads, in soʻm. A ministry signs off on money, not on tokens --
 * "2 100 token" is a number nobody in the building can act on, and "41 soʻm" is. The token count
 * stays after it, because a head asking *why* an answer cost that much needs it.
 *
 * A simulated answer has no cost line at all: the caller passes `simulated` and gets `null` back,
 * because printing "0 soʻm" for an answer no provider was paid for reads as "AI is free", which is
 * the opposite of honest (SPEC §8 "Honesty").
 *
 * Every number goes through `formatNumber`/`formatUzs` before it reaches `t()` -- `t()`'s own
 * interpolation is a bare `String()` (packages/i18n/src/t.ts), so a locale-formatted string has to be
 * built first and handed in as the param.
 */
export function aiCostLine(
  t: ReturnType<typeof useT>,
  meta: { totalTokens: number; latencyMs: number; costUzs?: number; simulated?: boolean },
  locale: Locale,
): string | null {
  if (meta.simulated) return null
  return t('ai.result.costLine', {
    cost: formatUzs(meta.costUzs ?? 0, locale),
    tokens: formatNumber(meta.totalTokens, locale),
    ms: formatNumber(meta.latencyMs, locale),
  })
}
