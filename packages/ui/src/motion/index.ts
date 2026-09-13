/** The motion foundation the whole UI overhaul stands on -- one piece per row of
 * UI-OVERHAUL.md §3, every one of them replacing (never deleting) its motion under
 * `prefers-reduced-motion`. Re-exported from the package root; nothing outside `packages/ui`
 * imports `motion` (motion.dev) directly. */

export * from './tokens.js'
export { MotionProvider, type MotionProviderProps } from './motion-provider.js'
// `AnimatePresence` itself, unlike everything else here, has no Devon-specific wrapper -- a caller
// that needs an *exit* animation on a list whose members come and go (a to-do that lingers,
// strikes through, then leaves once completed, rather than being yanked out of the DOM the instant
// it is removed from the array) reaches for this directly around `Stagger`/`StaggerItem`.
export { AnimatePresence } from 'motion/react'
export {
  startViewTransition,
  supportsViewTransitions,
  PAGE_VIEW_TRANSITION_NAME,
  THEME_VIEW_TRANSITION_NAME,
} from './view-transition.js'
export { PageTransition, type PageTransitionProps } from './page-transition.js'
export { Stagger, StaggerItem, type StaggerProps, type StaggerItemProps } from './stagger.js'
export { Reveal, BlurFade, type RevealProps, type BlurFadeProps } from './reveal.js'
export { HoverLift, PressScale, type HoverLiftProps, type PressScaleProps } from './hover-lift.js'
export { Collapsible, type CollapsibleProps } from './collapsible.js'
export { Shimmer, type ShimmerProps } from './shimmer.js'
export { Celebrate, useCelebrate, type CelebrateProps } from './celebrate.js'
// `Celebrate`'s counterparts: the product's "no" (`Shake`), its "taken" (`FlashOnChange`), its
// quieter "done" (`SettlePulse`), its "somebody is here" (`LivePulse`), the third beat of a
// completed task (`Strikethrough`), the ticker every count that changes now uses (`CountFlow`) and
// the jump-free skeleton→content crossfade (`Swap`).
export { Shake, useShake, type ShakeProps } from './shake.js'
export { FlashOnChange, type FlashOnChangeProps } from './flash.js'
export {
  SettlePulse,
  useSettlePulse,
  LivePulse,
  type SettlePulseProps,
  type LivePulseProps,
} from './pulse.js'
export { Strikethrough, strikethroughClass, type StrikethroughProps } from './strikethrough.js'
export { CountFlow, type CountFlowProps } from './count-flow.js'
export { Swap, type SwapProps } from './swap.js'
export { AnimatedCheck, type AnimatedCheckProps } from './animated-check.js'
export { ProgressRing, type ProgressRingProps } from './progress-ring.js'
export {
  AmbientGradient,
  HubAmbientWash,
  IdleFloat,
  type AmbientGradientProps,
  type IdleFloatProps,
} from './ambient-gradient.js'
export { useViewTransitionTheme, originOf, type RevealOrigin } from './use-view-transition-theme.js'
export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  type HoverCardProps,
  type HoverCardContentProps,
} from './hover-card.js'
