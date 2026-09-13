// v1.1 SPEC §7 (A11) -- presentation-only lookups for a goal, kept out of the screen for the same
// reason `format.ts` holds the card ones: a component should never carry "which colour for 80 %"
// logic inline, and a tone map is a lookup, not markup.
import { goalProgress, isCeilingMetric, type GoalMetric } from '@devon/contracts'

/**
 * The `Progress` tone for a goal's bar.
 *
 * A ceiling goal ("no more than 10 open") is full at zero and empty at the target, so its ratio is
 * already inverted by `goalProgress` -- which is exactly why the colour is chosen from the *ratio*
 * and never from the raw numbers. Two cards side by side, one counting up and one counting down,
 * must not show green for opposite situations.
 */
export function goalProgressTone(
  metric: GoalMetric,
  currentValue: number,
  targetValue: number,
): 'success' | 'warning' | 'destructive' | 'primary' {
  const ratio = goalProgress(metric, currentValue, targetValue)
  if (ratio >= 1) return 'success'
  if (ratio >= 0.6) return 'primary'
  if (ratio >= 0.3) return 'warning'
  return 'destructive'
}

/** What a goal counts, in words. Lives here rather than in `goals-screen.tsx` because the head
 * dashboard's Maqsadlar tile names the same metric (SPEC §3.2) and two copies of this map would be
 * two chances to disagree about what `open_cards_max` is called. */
export const GOAL_METRIC_LABEL_KEYS: Readonly<Record<GoalMetric, string>> = {
  cards_done: 'work.goals.metric.cardsDone',
  on_time_rate: 'work.goals.metric.onTimeRate',
  estimate_hours: 'work.goals.metric.estimateHours',
  open_cards_max: 'work.goals.metric.openCardsMax',
}

export { goalProgress, isCeilingMetric }
