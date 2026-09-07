import * as React from 'react'
import { motion, type Variants } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { RISE_PX, STAGGER_STEP, tweenOut, crossfade } from './tokens.js'

export interface StaggerProps {
  children: React.ReactNode
  className?: string
  /** Re-runs the stagger when it changes -- pass the filter/query so a filtered list re-enters
   * (UI-OVERHAUL.md §3: "on first render and on filter change"). */
  animateKey?: string | number
  /** Seconds before the first child enters. */
  delay?: number
  as?: 'div' | 'ul' | 'ol' | 'section'
}

export interface StaggerItemProps {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'li' | 'article'
}

function containerVariants(reduced: boolean, delay: number): Variants {
  return {
    hidden: {},
    shown: {
      transition: {
        // Reduced motion keeps the sequence (so the eye still reads "these arrived in order") but
        // collapses the step so a long list is not a slow reveal.
        staggerChildren: reduced ? 0 : STAGGER_STEP,
        delayChildren: delay,
      },
    },
  }
}

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: RISE_PX },
  shown: { opacity: 1, y: 0, transition: tweenOut },
}

const ITEM_VARIANTS_REDUCED: Variants = {
  hidden: { opacity: 0, y: 0 },
  shown: { opacity: 1, y: 0, transition: crossfade },
}

const StaggerReducedContext = React.createContext(false)

/** UI-OVERHAUL.md §3 "Lists, grids, tiles": 24 ms stagger, fade + rise 8 px. Wrap the list, wrap
 * each row in `<StaggerItem>`. Under reduced motion the rise is dropped and each item crossfades in
 * place -- the arrival is still visible, it just does not travel. */
export function Stagger({
  children,
  className,
  animateKey,
  delay = 0,
  as = 'div',
}: StaggerProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const Comp = motion[as]
  return (
    <StaggerReducedContext.Provider value={reduced}>
      <Comp
        key={animateKey}
        className={className}
        variants={containerVariants(reduced, delay)}
        initial="hidden"
        animate="shown"
      >
        {children}
      </Comp>
    </StaggerReducedContext.Provider>
  )
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: StaggerItemProps): React.JSX.Element {
  const reduced = React.useContext(StaggerReducedContext)
  const Comp = motion[as]
  return (
    <Comp className={className} variants={reduced ? ITEM_VARIANTS_REDUCED : ITEM_VARIANTS}>
      {children}
    </Comp>
  )
}
