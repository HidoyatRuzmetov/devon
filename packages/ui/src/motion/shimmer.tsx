import * as React from 'react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface ShimmerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Match the *real* shape of what is coming (DESIGN.md §4: "skeleton matching final layout").
   * There is deliberately no default size. */
  className?: string
}

/** UI-OVERHAUL.md §3 "Skeleton → content": a light sweep travelling across a muted block, then a
 * crossfade to the real thing. The sweep is a pure-CSS keyframe (`devon-shimmer-sweep` in
 * `styles/tokens.css`) so a page full of skeletons costs no JS at all.
 *
 * Under reduced motion the sweep is dropped and the block sits at a steady, clearly-visible tint --
 * "something is loading here" is still legible, it just does not move. */
export function Shimmer({ className, style, ...props }: ShimmerProps): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <div
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
}
