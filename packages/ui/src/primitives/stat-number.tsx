import * as React from 'react'
import NumberFlow from '@number-flow/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface StatNumberProps {
  value: number
  /** DESIGN.md §5: "numbers with locale separators" -- forwarded to NumberFlow's own `locales`
   *  (`Intl.NumberFormat` under the hood), same convention as `KpiTile`. Without it NumberFlow falls
   *  back to the browser's own locale rather than the app's chosen one. */
  locale?: Intl.LocalesArgument
  prefix?: string
  suffix?: string
  className?: string
}

/** A bare NumberFlow ticker with no card chrome, for call sites that need UI-OVERHAUL.md's
 * "lead with the number" treatment inside their own layout rather than `KpiTile`'s
 * eyebrow/label/question card (e.g. Home's "due from me" / "around me" tiles, which keep an icon and
 * a prose line KpiTile has no slot for). Reduced motion drops the per-digit roll, same as `KpiTile`. */
export function StatNumber({
  value,
  locale,
  prefix,
  suffix,
  className,
}: StatNumberProps): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <NumberFlow
      value={value}
      animated={!reduced}
      className={className}
      {...(locale ? { locales: locale } : {})}
      {...(prefix ? { prefix } : {})}
      {...(suffix ? { suffix } : {})}
    />
  )
}
