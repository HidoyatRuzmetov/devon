import * as React from 'react'
import { Bell } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { CountFlow } from '../motion/count-flow.js'

export interface InboxBellProps {
  count: number
  /** Accessible name; the caller interpolates the count, e.g. `t('shell.inbox.unreadAria', { count })` --
   * "3 ta oʻqilmagan xabar". A bare "Inbox" would hide the number from a screen reader. */
  label: string
  onClick: () => void
  /** Renders the bell as the active item when the inbox itself is on screen. */
  active?: boolean
  className?: string
  /** Active locale, so the badge's digits are grouped the way the rest of the shell groups numbers.
   * Optional -- a two-digit badge never needs a separator, but the prop keeps the ticker honest in
   * the rare department where it does. */
  locale?: Intl.LocalesArgument
}

/** UI-OVERHAUL.md §3 "Inbox badge": pop on increment, at `--dur-micro`, and -- v1.1 motion pass --
 * the number inside it *ticks* rather than being replaced.
 *
 * The two are deliberately different signals doing different jobs: the pop says "something arrived"
 * and fires only when the count rises (a badge that pops every time the poll returns, or on every
 * re-render, is noise); the ticker says "it is this many now" and runs in both directions, so
 * reading three notifications counts the badge down instead of cutting to a smaller number.
 *
 * Under reduced motion the number still changes and the badge still updates; the pop and the roll
 * are the only things dropped. */
export function InboxBell({
  count,
  label,
  onClick,
  active = false,
  className,
  locale,
}: InboxBellProps) {
  const reduced = useReducedMotion()
  const [pop, setPop] = React.useState(false)
  const previous = React.useRef(count)

  React.useEffect(() => {
    if (count > previous.current) {
      setPop(true)
      const timer = window.setTimeout(() => setPop(false), 300)
      previous.current = count
      return () => window.clearTimeout(timer)
    }
    previous.current = count
    return undefined
  }, [count])

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'relative inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-sm px-1 py-0.5',
        'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active ? 'bg-accent text-foreground' : 'text-foreground',
        className,
      )}
    >
      <Bell className="size-4.5" aria-hidden="true" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex min-w-4 items-center justify-center rounded-full',
            'bg-attention px-1 text-caption font-medium tabular-nums text-attention-foreground',
            pop && !reduced && 'animate-[devon-badge-pop_300ms_var(--ease-out)]',
          )}
        >
          <CountFlow value={count} max={99} {...(locale ? { locale } : {})} />
        </span>
      ) : null}
    </button>
  )
}
