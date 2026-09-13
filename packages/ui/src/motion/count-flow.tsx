import * as React from 'react'
import NumberFlow from '@number-flow/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'

export interface CountFlowProps {
  value: number
  /** Active locale, forwarded to NumberFlow's own `Intl.NumberFormat` so a count is grouped the way
   * the rest of the screen groups numbers (DESIGN.md §5). Without it NumberFlow silently falls back
   * to the *browser's* locale, which is how a `uz-Latn` UI ends up rendering `1,234`. */
  locale?: Intl.LocalesArgument
  className?: string
  /** Counts above this render as `<max>+` and stop ticking — a badge that rolls from 98 to 99 is
   * information, one that rolls through four digits is a slot machine. `0` disables the cap. */
  max?: number
}

/** `KpiTile` taught the product that a number which *changed* should be seen changing. A KPI is not
 * the only number that changes, though: a board column's count, the inbox badge, a sidebar entry's
 * count and a filter chip's tally all move as a direct result of something the person just did, and
 * every one of them used to simply be a different number on the next frame.
 *
 * This is that ticker at the size those numbers are actually rendered — tabular figures, so a 9
 * becoming a 10 does not shove the label beside it.
 *
 * Reduced motion hands NumberFlow `animated={false}`: the value lands, nothing rolls. */
export function CountFlow({
  value,
  locale,
  className,
  max = 0,
}: CountFlowProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const capped = max > 0 && value > max

  if (capped) {
    return <span className={cn('tabular-nums', className)}>{`${max}+`}</span>
  }

  return (
    <NumberFlow
      value={value}
      animated={!reduced}
      {...(locale ? { locales: locale } : {})}
      className={cn('tabular-nums', className)}
    />
  )
}
