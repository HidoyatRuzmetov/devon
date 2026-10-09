// v1.1 SPEC §7 (A11) -- presentation-only lookups for a goal, kept out of the screen for the same
// reason `format.ts` holds the card ones: a component should never carry "which colour for 80 %"
// logic inline, and a tone map is a lookup, not markup.
//
// **v1.1 critique SEV2 #8.** Two of the three demo goals rendered wrong, in opposite directions:
//
//   * "Muddatida bajarish 85% dan past tushmasin" showed "98 / 85" -- a percentage expressed as a
//     fraction of a percentage, which is not a sentence anybody reads.
//   * "Ochiq «Muhim» ishlar 100 tadan oshmasin — 100 dan 78 ta" drew a RED bar at 22%, because
//     `goalProgress` inverts a ceiling metric (1 - 78/100 = 0.22) and the tone was chosen from that
//     inverted ratio. A head comfortably *inside* a cap read both the colour and the number as
//     failure.
//
// The inversion is right for "how much of this goal is achieved", and wrong for what a bar draws. So
// there are now two questions with two answers: `goalProgress` (achievement, unchanged, still what
// the percentage text reports) and `goalBarFill` (what the bar draws). For a ceiling goal the bar
// fills *towards* the limit -- 78 out of a cap of 100 is a bar at 78% -- and the colour is green
// below 80% of the cap, amber as it approaches, red only past it.
import { goalProgress, isCeilingMetric, type GoalMetric } from '@devon/contracts'

/** The metrics whose value IS a percentage, so it must be printed with a `%` and compared against a
 * target that is also a percentage -- never rendered as `98 / 85` (SEV2 #8). */
export function isPercentMetric(metric: GoalMetric): boolean {
  return metric === 'on_time_rate'
}

/**
 * How full the bar is drawn, which is not the same question as how close the goal is to being met.
 *
 * A ceiling goal fills towards its limit: 78 open cards against a cap of 100 is a bar at 78%, and it
 * is the *bar reaching the end* that means trouble. `goalProgress` answers the other question ("this
 * goal is 22% achieved") and stays the source of the percentage in the text.
 */
export function goalBarFill(metric: GoalMetric, currentValue: number, targetValue: number): number {
  if (isCeilingMetric(metric)) {
    if (targetValue <= 0) return currentValue > 0 ? 1 : 0
    return Math.max(0, Math.min(1, currentValue / targetValue))
  }
  return goalProgress(metric, currentValue, targetValue)
}

/**
 * The `Progress` tone for a goal's bar, chosen from the same fill the bar draws.
 *
 * Counting up: red until a third, amber to 60%, primary until met, green when met. Counting down to
 * a cap: green while there is room, amber in the last fifth before the limit, red only once the cap
 * is actually exceeded -- SEV2 #8's "green below, amber near and red only past the limit".
 */
export function goalProgressTone(
  metric: GoalMetric,
  currentValue: number,
  targetValue: number,
): 'success' | 'warning' | 'destructive' | 'primary' {
  if (isCeilingMetric(metric)) {
    // Strictly past the cap, not merely at it: a goal that says "no more than 100" is still met at
    // exactly 100.
    if (currentValue > targetValue) return 'destructive'
    const used = goalBarFill(metric, currentValue, targetValue)
    if (used >= 0.8) return 'warning'
    return 'success'
  }
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

/** SEV2 #8: "a click-through that opens /work filtered by the goal's own filter". A goal with no
 * filter counts every open card, so the destination is the unfiltered table -- still the right list,
 * just not narrowed. */
export function goalCardsHref(filter: string | null): string {
  const query = (filter ?? '').trim()
  return query.length > 0 ? `/work/table?q=${encodeURIComponent(query)}` : '/work/table'
}

export { goalProgress, isCeilingMetric }
