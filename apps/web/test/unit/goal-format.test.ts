// v1.1 critique SEV2 #8 -- the two goals that rendered wrong, locked down.
//
// The demo department's own three goals were the report: "Muddatida bajarish 85% dan past tushmasin"
// showed "98 / 85" (a percentage expressed as a fraction of a percentage), and "Ochiq «Muhim» ishlar
// 100 tadan oshmasin" drew a RED bar at 22% while the department sat comfortably inside its cap --
// because `goalProgress` inverts a ceiling metric (1 - 78/100 = 0.22) and both the bar and its
// colour were taken from that inverted number.
//
// The inversion is correct for "how achieved is this goal" and wrong for "how full is the bar", so
// those are now two functions. These are the cells that matter.
import { describe, expect, it } from 'vitest'
import {
  goalBarFill,
  goalCardsHref,
  goalProgress,
  goalProgressTone,
  isCeilingMetric,
  isPercentMetric,
} from '../../src/features/work/lib/goal-format.js'

describe('SEV2 #8 -- a cap fills towards the limit and is green while there is room', () => {
  it('78 open against a cap of 100 draws a bar at 78%, not 22%', () => {
    expect(Math.round(goalBarFill('open_cards_max', 78, 100) * 100)).toBe(78)
    // The achievement ratio is still the inverted one -- it answers a different question.
    expect(Math.round(goalProgress('open_cards_max', 78, 100) * 100)).toBe(22)
  })

  it('is green comfortably inside the cap', () => {
    expect(goalProgressTone('open_cards_max', 10, 100)).toBe('success')
    expect(goalProgressTone('open_cards_max', 78, 100)).toBe('success')
  })

  it('turns amber only as it approaches the limit', () => {
    expect(goalProgressTone('open_cards_max', 80, 100)).toBe('warning')
    expect(goalProgressTone('open_cards_max', 99, 100)).toBe('warning')
  })

  it('is red only past the limit -- exactly at the cap is still met', () => {
    expect(goalProgressTone('open_cards_max', 100, 100)).toBe('warning')
    expect(goalProgressTone('open_cards_max', 101, 100)).toBe('destructive')
  })

  it('never draws more than a full bar however far past the cap it goes', () => {
    expect(goalBarFill('open_cards_max', 400, 100)).toBe(1)
  })

  it('a cap of zero is exceeded by anything at all', () => {
    expect(goalProgressTone('open_cards_max', 1, 0)).toBe('destructive')
    expect(goalProgressTone('open_cards_max', 0, 0)).toBe('success')
    expect(goalBarFill('open_cards_max', 1, 0)).toBe(1)
    expect(goalBarFill('open_cards_max', 0, 0)).toBe(0)
  })
})

describe('SEV2 #8 -- a counting goal is unchanged', () => {
  it('fills as it is achieved', () => {
    expect(Math.round(goalBarFill('cards_done', 82, 120) * 100)).toBe(68)
  })

  it('keeps its four-step tone', () => {
    expect(goalProgressTone('cards_done', 0, 120)).toBe('destructive')
    expect(goalProgressTone('cards_done', 40, 120)).toBe('warning')
    expect(goalProgressTone('cards_done', 82, 120)).toBe('primary')
    expect(goalProgressTone('cards_done', 120, 120)).toBe('success')
  })
})

describe('SEV2 #8 -- a percentage is a percentage', () => {
  it('knows which metric carries one', () => {
    expect(isPercentMetric('on_time_rate')).toBe(true)
    expect(isPercentMetric('cards_done')).toBe(false)
    expect(isPercentMetric('open_cards_max')).toBe(false)
    expect(isPercentMetric('estimate_hours')).toBe(false)
  })

  it('98 against a target of 85 is met, not 115% of a fraction', () => {
    expect(goalProgressTone('on_time_rate', 98, 85)).toBe('success')
    expect(goalBarFill('on_time_rate', 98, 85)).toBe(1)
  })

  it('and a percentage target is not a ceiling', () => {
    expect(isCeilingMetric('on_time_rate')).toBe(false)
  })
})

describe('SEV2 #8 -- the click-through opens the goal’s own cards', () => {
  it('carries the goal’s filter into the table', () => {
    expect(goalCardsHref('status:done label:muhim')).toBe(
      '/work/table?q=status%3Adone%20label%3Amuhim',
    )
  })

  it('a goal with no filter opens the unfiltered table rather than a broken query', () => {
    expect(goalCardsHref(null)).toBe('/work/table')
    expect(goalCardsHref('   ')).toBe('/work/table')
  })
})
