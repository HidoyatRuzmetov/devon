import * as React from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { tweenMicro } from './tokens.js'

export interface HoverLiftProps {
  children: React.ReactNode
  className?: string
  /** Disable for a row that is not itself clickable -- lift is a "this is a target" signal. */
  disabled?: boolean
}

/** UI-OVERHAUL.md §3 "Cards": hover lift −2 px + a shadow step, at `--dur-micro`. Under reduced
 * motion the card does not travel; the shadow step still happens (a CSS transition the reduced-motion
 * backstop in `tokens.css` collapses to an instant change), so hovering still reads as "this reacts". */
export function HoverLift({
  children,
  className,
  disabled = false,
}: HoverLiftProps): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={cn(
        'transition-shadow duration-(--dur-micro) ease-out',
        !disabled && 'hover:shadow-2',
        className,
      )}
      {...(disabled || reduced ? {} : { whileHover: { y: -2 } })}
      transition={tweenMicro}
    >
      {children}
    </motion.div>
  )
}

export interface PressScaleProps {
  children: React.ReactNode
  className?: string
  disabled?: boolean
}

/** UI-OVERHAUL.md §3 "Cards": press scale 0.98. Reduced motion replaces the scale with a brief
 * opacity dip -- the press still confirms itself. */
export function PressScale({
  children,
  className,
  disabled = false,
}: PressScaleProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const press = reduced ? { opacity: 0.7 } : { scale: 0.98 }
  return (
    <motion.div
      className={className}
      {...(disabled ? {} : { whileTap: press })}
      transition={tweenMicro}
    >
      {children}
    </motion.div>
  )
}
