// Small shared helpers for the AI wiring points across this feature's screens (quick-add parse on
// the task quick-add row, subtask breakdown on a task row, plan-sprint on an active sprint, weekly
// summary in the sprints history section, translate on a note). Kept here rather than duplicated four
// times -- same convention as `apps/web/src/features/ai/assistant-panel.tsx`'s own local helper,
// which this mirrors, since `features/ai` is import-only from this module (UI-OVERHAUL.md: a wave
// agent never edits another feature's folder).
import { formatNumber, type useT, type Locale } from '@devon/i18n'
import { ApiError } from '../../../lib/api-client.js'

/** Maps a failed `useRunAiFeatureMutation` call to one of the generic `ai.errors.*` message keys the
 * `ai` module's own message files already ship (reused here rather than duplicated under
 * `personal.*` -- one wording for "the AI could not answer" across the whole product). */
export function aiErrorMessageKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'validation_failed') return 'ai.errors.invalidInput'
    if (err.code === 'forbidden') return 'ai.errors.forbidden'
    if (err.code === 'internal') return 'ai.errors.runFailed'
  }
  return 'toast.saveError'
}

/** The `costLine` every `<AiPreviewPanel>` shows in its footer (TECH-SPEC §8: "the cost of every run
 * is visible") -- tokens and latency, reusing the `ai` module's own generic wording. Both numbers go
 * through `formatNumber` before they reach `t()` -- `t()`'s own interpolation is a bare `String()`
 * (packages/i18n/src/t.ts), so a locale-formatted string has to be built first and handed in as the
 * param, exactly like `formatUzs` already is at every other AI cost-line call site. */
export function aiCostLine(
  t: ReturnType<typeof useT>,
  meta: { totalTokens: number; latencyMs: number },
  locale: Locale,
): string {
  return `${t('ai.result.tokens', { count: formatNumber(meta.totalTokens, locale) })} · ${t('ai.result.latency', { ms: formatNumber(meta.latencyMs, locale) })}`
}
