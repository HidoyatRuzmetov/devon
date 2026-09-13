import * as React from 'react'
import {
  AnimatePresence,
  motion,
  type TargetAndTransition,
  type Variants,
  type VariantLabels,
} from 'motion/react'
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
  as?: 'div' | 'ul' | 'ol' | 'section' | 'tbody'
  /** Opt in when rows are *removed* from this list while it is on screen -- an archived
   * notification, a deleted reminder, a card dropped out of focus.
   *
   * `AnimatePresence` only animates the exit of its own DIRECT children. Wrapping it *around*
   * `<Stagger>` (the shape twelve call sites used to have) makes its only child the `motion` element
   * this component renders, and that element never unmounts -- so every `StaggerItem`'s `exit` and
   * `layout` were grandchildren, and inert. The boundary has to live *inside* the container, which is
   * what this prop does. `mode="popLayout"` pops the leaving row out of flow so the survivors slide
   * up to close the gap instead of snapping.
   *
   * Pass `exit="hidden"` and `layout` on each `<StaggerItem>` to actually see it. */
  presence?: boolean
}

export interface StaggerItemProps {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'li' | 'article' | 'tr'
  /** Opt-in only -- omit for the ordinary case (a parent that just adds/removes children with no
   * animated exit). Pass `"hidden"` (the same variant this item already enters from) to reverse it
   * on the way out instead, when the immediate parent provides a presence boundary -- either
   * `<Stagger presence>` (the supported way; the boundary is then this item's direct parent) or a
   * hand-rolled `AnimatePresence` whose direct child this item is (e.g. a to-do list row that
   * should hold, strike through, then animate away
   * once completed, rather than being yanked out of the DOM the instant it is removed from the
   * array). Layout-shifts the remaining siblings into place at the same time. */
  exit?: TargetAndTransition | VariantLabels
  layout?: boolean
  /** For `as="tr"` (an admin table's own rows are the row's whole click target, not one cell in
   * it) -- the handful of DOM props an interactive row needs, kept as an explicit, narrow list
   * rather than a blanket `HTMLAttributes` extension (which pulls in an optional `style` whose
   * `CSSProperties | undefined` this package's `exactOptionalPropertyTypes` rejects against
   * `motion`'s own `MotionStyle`). */
  onClick?: React.MouseEventHandler<HTMLElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>
  tabIndex?: number
  role?: React.AriaRole
  'aria-label'?: string
  /** Forwarded to the underlying motion element. Needed because `<Stagger presence>` mounts
   * framer-motion's `mode="popLayout"`, whose `PopChild` measures the leaving row by cloning the
   * presence child with a ref -- so a call site that wraps its row in its own memoised component
   * (the inbox does, to keep a tab switch from re-rendering sixty rows) has to be able to pass that
   * ref through to the real DOM node, or the pop-out sizing silently does nothing. */
  ref?: React.Ref<HTMLElement>
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
  presence = false,
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
        {presence ? (
          <AnimatePresence initial={false} mode="popLayout">
            {children}
          </AnimatePresence>
        ) : (
          children
        )}
      </Comp>
    </StaggerReducedContext.Provider>
  )
}

export function StaggerItem({
  children,
  className,
  as = 'div',
  exit,
  layout,
  ref,
  ...rest
}: StaggerItemProps): React.JSX.Element {
  const reduced = React.useContext(StaggerReducedContext)
  const Comp = motion[as]
  return (
    <Comp
      className={className}
      {...(ref ? { ref: ref as React.Ref<never> } : {})}
      variants={reduced ? ITEM_VARIANTS_REDUCED : ITEM_VARIANTS}
      {...(exit !== undefined ? { exit } : {})}
      {...(layout !== undefined ? { layout } : {})}
      {...rest}
    >
      {children}
    </Comp>
  )
}
