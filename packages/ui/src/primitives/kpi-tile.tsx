import * as React from 'react'
import NumberFlow from '@number-flow/react'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface KpiTileProps {
  /** Small-caps eyebrow above the number (DESIGN.md §2.3). */
  label: string
  value: number | null
  /** Active locale (DESIGN.md §5: "numbers with locale separators") -- passed straight through to
   * NumberFlow's own `locales`, which formats the ticker with `Intl.NumberFormat` internally.
   * Without it NumberFlow falls back to the browser's own locale, which can silently diverge from
   * the app's chosen one (a `uz-Latn` UI on an `en-US` browser rendering `1,234` instead of the
   * space-grouped `1 234` DESIGN.md asks for). Optional only so existing call sites keep compiling
   * during the sweep; new call sites should always pass it. */
  locale?: Intl.LocalesArgument
  /** Appended to the number inside the ticker, e.g. `%`. */
  suffix?: string
  prefix?: string
  /** Period-over-period change in percentage points. `null` means "no comparison available" and
   * renders nothing rather than a fake 0 %. */
  delta?: number | null
  /** Which direction is *good*. On-time rate rises to improve; overdue count falls to improve --
   * without this a red arrow would be wrong half the time. */
  deltaGoodWhen?: 'up' | 'down'
  /** Reads out the delta, e.g. "12% ko'proq, o'tgan haftaga nisbatan" -- the arrow alone is not a
   * label, and colour is never the only signal (DESIGN.md §2.1). */
  deltaLabel?: string
  /** DESIGN.md §3 "KpiTile (NumberFlow ticker, owner-required)": the question this number answers,
   * so a tile can never be a number with no owner. */
  question?: string
  className?: string
  /** Shown instead of the number when it is genuinely unknown. */
  emptyText?: string
}

/** UI-OVERHAUL.md §3 "Counters, KPI tiles": NumberFlow ticker, delta arrow. Under reduced motion the
 * ticker is disabled and the value simply changes -- NumberFlow's own `animated={false}`, so the
 * tabular figure lands with no per-digit roll. */
export function KpiTile({
  label,
  value,
  locale,
  suffix,
  prefix,
  delta = null,
  deltaGoodWhen = 'up',
  deltaLabel,
  question,
  className,
  emptyText = '—',
}: KpiTileProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const isFlat = delta !== null && Math.abs(delta) < 0.5
  const isGood = delta === null || isFlat ? null : deltaGoodWhen === 'up' ? delta > 0 : delta < 0
  const DeltaIcon =
    delta === null ? ArrowRight : isFlat ? ArrowRight : delta > 0 ? ArrowUpRight : ArrowDownRight

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface-2 p-4 shadow-1',
        className,
      )}
    >
      <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {label}
      </span>
      <span className="font-display text-h1 tabular-nums text-foreground">
        {value === null ? (
          emptyText
        ) : (
          <NumberFlow
            value={value}
            animated={!reduced}
            {...(locale ? { locales: locale } : {})}
            {...(prefix ? { prefix } : {})}
            {...(suffix ? { suffix } : {})}
          />
        )}
      </span>
      {delta !== null ? (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-small tabular-nums',
            isGood === null
              ? 'text-muted-foreground'
              : isGood
                ? 'text-success'
                : 'text-destructive',
          )}
        >
          <DeltaIcon className="size-3.5" aria-hidden="true" />
          <span>{deltaLabel ?? `${delta > 0 ? '+' : ''}${delta}%`}</span>
        </span>
      ) : null}
      {question ? <span className="text-caption text-muted-foreground">{question}</span> : null}
    </div>
  )
}
