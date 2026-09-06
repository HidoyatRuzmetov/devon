import * as React from 'react'
import { useT } from '@devon/i18n'
import { WifiOff } from 'lucide-react'
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
  className?: string
}

/** spec.md §8.6: full width, 40px (48px at 390 -- the caller controls height via `className`), a
 * warning tint, `role="status"`, slide-in 220ms ease-out / out 140ms ease-in, none under reduced
 * motion. This is the one new component in the epic (design.md §13). */
export function OfflineBanner({ hasCachedContent, onRetry, className }: OfflineBannerProps) {
  const t = useT()
  const reduced = useReducedMotion()
  return (
    <div
      role="status"
      className={cn(
        'flex h-10 items-center justify-center gap-3 bg-warning px-4 text-small text-warning-foreground',
        !reduced && 'animate-[devon-slide-in-top_220ms_var(--ease-out)]',
        className,
      )}
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <span data-shell-label>{t('state.offline.banner')}</span>
      {hasCachedContent ? (
        <Button data-primary size="sm" variant="secondary" onClick={onRetry} className="h-7 px-2.5">
          {t('state.error.action')}
        </Button>
      ) : null}
    </div>
  )
}
