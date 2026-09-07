import * as React from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { RISE_PX, tweenOut, crossfade } from './tokens.js'

export interface RevealProps {
  children: React.ReactNode
  className?: string
  /** Seconds. */
  delay?: number
  /** Animate when scrolled into view rather than on mount. Once only -- nothing in Devon re-animates
   * on every scroll pass (DESIGN.md §2.5: no decoration). */
  onView?: boolean
}

/** Fade + rise. The plainest entrance in the catalogue; a section header, a card, a chart. */
export function Reveal({
  children,
  className,
  delay = 0,
  onView = false,
}: RevealProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const from = { opacity: 0, y: reduced ? 0 : RISE_PX }
  const to = { opacity: 1, y: 0 }
  const transition = { ...(reduced ? crossfade : tweenOut), delay }

  if (onView) {
    return (
      <motion.div
        className={className}
        initial={from}
        whileInView={to}
        viewport={{ once: true, amount: 0.2 }}
        transition={transition}
      >
        {children}
      </motion.div>
    )
  }
  return (
    <motion.div className={className} initial={from} animate={to} transition={transition}>
      {children}
    </motion.div>
  )
}

export interface BlurFadeProps extends RevealProps {
  /** Pixels of blur to resolve from. Kept small: this is a focus pull, not a glassmorphism effect. */
  blur?: number
}

/** Reveal's richer sibling, for the one or two "first impression" moments per screen (the auth card,
 * the Home greeting). Blur is dropped entirely under reduced motion -- a blur that resolves is
 * motion by another name -- leaving the crossfade. */
export function BlurFade({
  children,
  className,
  delay = 0,
  blur = 6,
  onView = false,
}: BlurFadeProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const from = reduced ? { opacity: 0 } : { opacity: 0, y: RISE_PX, filter: `blur(${blur}px)` }
  const to = reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }
  const transition = { ...(reduced ? crossfade : tweenOut), delay }

  if (onView) {
    return (
      <motion.div
        className={className}
        initial={from}
        whileInView={to}
        viewport={{ once: true, amount: 0.2 }}
        transition={transition}
      >
        {children}
      </motion.div>
    )
  }
  return (
    <motion.div className={className} initial={from} animate={to} transition={transition}>
      {children}
    </motion.div>
  )
}
