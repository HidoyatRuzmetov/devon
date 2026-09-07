import * as React from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { S_MICRO, S_STANDARD, EASE_OUT, crossfade } from './tokens.js'

export interface AnimatedCheckProps {
  checked: boolean
  className?: string
  /** Stroke width in the 24×24 viewBox. */
  strokeWidth?: number
}

/** UI-OVERHAUL.md §3 "Checkbox / task done": the check *draws in* rather than appearing. Used by
 * `Checkbox`, the Button success morph, and anywhere a task flips to done.
 *
 * Reduced motion crossfades the finished check in -- the tick is still the feedback, it just is not
 * drawn stroke by stroke. */
export function AnimatedCheck({
  checked,
  className,
  strokeWidth = 3,
}: AnimatedCheckProps): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('size-4', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <motion.path
        d="M5 12.5 L10 17.5 L19 7"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={
          reduced
            ? { opacity: checked ? 1 : 0, pathLength: 1 }
            : { pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }
        }
        transition={
          reduced ? crossfade : { duration: checked ? S_STANDARD : S_MICRO, ease: EASE_OUT }
        }
      />
    </svg>
  )
}
