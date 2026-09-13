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

export { goalProgress, isCeilingMetric }
