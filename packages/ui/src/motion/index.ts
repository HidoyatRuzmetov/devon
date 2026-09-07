/** The motion foundation the whole UI overhaul stands on -- one piece per row of
 * UI-OVERHAUL.md §3, every one of them replacing (never deleting) its motion under
 * `prefers-reduced-motion`. Re-exported from the package root; nothing outside `packages/ui`
 * imports `motion` (motion.dev) directly. */

export * from './tokens.js'
export { MotionProvider, type MotionProviderProps } from './motion-provider.js'
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
