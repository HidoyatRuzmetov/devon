import * as React from 'react'
import { Bell } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface InboxBellProps {
  count: number
  /** Accessible name; the caller interpolates the count, e.g. `t('inbox.bell.aria', { count })` --
   * "3 ta oʻqilmagan xabar". A bare "Inbox" would hide the number from a screen reader. */
  label: string
  onClick: () => void
  /** Renders the bell as the active item when the inbox itself is on screen. */
  active?: boolean
  className?: string
}

/** UI-OVERHAUL.md §3 "Inbox badge": pop on increment, at `--dur-micro`.
 *
 * The pop fires only when the count *rises* -- a badge that pops every time the poll returns, or on
 * every re-render, is noise. Under reduced motion the number still changes; only the pop is dropped
 * (the change itself is the feedback). */
export function InboxBell({ count, label, onClick, active = false, className }: InboxBellProps) {
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
        'relative inline-flex size-9 shrink-0 items-center justify-center rounded-sm',
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
            'absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full',
            'bg-attention px-1 text-caption font-medium tabular-nums text-attention-foreground',
            pop && !reduced && 'animate-[devon-badge-pop_300ms_var(--ease-out)]',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  )
}
