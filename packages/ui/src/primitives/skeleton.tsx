import * as React from 'react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

/** DESIGN.md §4/§8.2: blocks in `--color-muted`, matched to the *real* dimensions of what is
 * coming (a caller passes `className="h-9 w-70"` etc. -- there is no default size, because a
 * default size is how "header-and-footer-only" skeletons happen).
 *
 * UI-OVERHAUL.md §3 "Skeleton → content": a shimmer sweep, then a crossfade to the real content.
 * The sweep is the same pure-CSS `devon-shimmer` the `<Shimmer>` motion piece uses -- `Skeleton` is
 * the layout-matched, `role="presentation"` form of it that every loading state composes; under
 * `prefers-reduced-motion` the sweep is replaced by a steady, still-visible tint. */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, style, ...props }, ref) => {
    const reduced = useReducedMotion()
    return (
      <div
        ref={ref}
        role="presentation"
        aria-hidden="true"
        className={cn(
          'relative overflow-hidden rounded-sm bg-muted',
          !reduced && 'devon-shimmer',
          className,
        )}
        style={reduced ? { opacity: 0.75, ...style } : style}
        {...props}
      />
    )
  },
)
Skeleton.displayName = 'Skeleton'
