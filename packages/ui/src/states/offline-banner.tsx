import * as React from 'react'
import { useT } from '@devon/i18n'
import { CloudOff } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from '../primitives/button.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface OfflineBannerProps {
  /** design.md §8.6, the rule this component exists to enforce: the banner carries its own retry
   * action only when the route still has cached content to show underneath it. When the route has
   * nothing cached, this must be `false` and the caller's `<StateView kind="offline">` below carries
   * the single primary action instead -- rendering both would put two actions on screen at once,
   * which is an AC-7 disproof. */
  hasCachedContent: boolean
  onRetry: () => void
  /** Number of writes queued while offline; rendered as the "pending" count DESIGN.md §4 asks for.
   * Omitted (or 0) renders nothing rather than a "0 pending" that means nothing. */
  pendingCount?: number
  className?: string
}

/** spec.md §8.6: full width, a warning tint, `role="status"`, slide-in 220 ms ease-out, none under
 * reduced motion.
 *
 * Overhaul polish: the banner sits directly under the top bar as a hairline-bordered strip rather
 * than a solid amber slab -- it has to be noticeable without competing with the page's own primary
 * action for the rest of the session, since "offline" can last minutes. */
export function OfflineBanner({
  hasCachedContent,
  onRetry,
  pendingCount = 0,
  className,
}: OfflineBannerProps) {
  const t = useT()
  const reduced = useReducedMotion()
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-10 items-center justify-center gap-3 border-b border-warning/40 bg-warning/15 px-4',
        'text-small text-foreground',
        !reduced && 'animate-[devon-slide-in-top_220ms_var(--ease-out)]',
        className,
      )}
    >
      <CloudOff className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span data-shell-label>{t('state.offline.banner')}</span>
      {pendingCount > 0 ? (
        <span className="rounded-full bg-warning px-2 py-0.5 text-caption tabular-nums text-warning-foreground">
          {pendingCount}
        </span>
      ) : null}
      {hasCachedContent ? (
        <Button data-primary size="sm" variant="secondary" onClick={onRetry} className="h-7 px-2.5">
          {t('state.error.action')}
        </Button>
      ) : null}
    </div>
  )
}
