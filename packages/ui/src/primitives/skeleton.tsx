import * as React from 'react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

/** DESIGN.md §4/§8.2: blocks in `--color-muted`, matched to the *real* dimensions of what is
 * coming (a caller passes `className="h-9 w-70"` etc. -- there is no default size, because a
 * default size is how "header-and-footer-only" skeletons happen). Shimmer 1.4s, static under
 * `prefers-reduced-motion` (opacity blocks 0.6, never fully invisible). */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, style, ...props }, ref) => {
    const reduced = useReducedMotion()
    return (
      <div
        ref={ref}
        role="presentation"
        aria-hidden="true"
        className={cn(
          'rounded-sm bg-muted',
          !reduced && 'animate-[devon-shimmer_1.4s_linear_infinite]',
          className,
        )}
        style={reduced ? { opacity: 0.6, ...style } : style}
        {...props}
      />
    )
  },
)
Skeleton.displayName = 'Skeleton'
