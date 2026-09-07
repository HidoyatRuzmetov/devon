import * as React from 'react'
import { startViewTransition, supportsViewTransitions } from './view-transition.js'

/** Where the reveal starts. Pass the toggle button's own bounding box centre so the new theme
 * appears to spread out of the button the user just pressed. */
export interface RevealOrigin {
  x: number
  y: number
}

/** UI-OVERHAUL.md §3 "Theme toggle": icon morph, plus a circular reveal from the button when View
 * Transitions exist.
 *
 * Returns a function the toggle calls with (a) the DOM update that actually switches the theme and
 * (b) the element the press came from. The clip-path animation is applied to the incoming
 * `::view-transition-new(root)` layer via a Web Animations call -- CSS alone cannot know where the
 * button was.
 *
 * With no View Transitions support, or under reduced motion, the theme simply changes: the switch is
 * its own feedback, so there is nothing left to replace (DESIGN.md §2.5). */
export function useViewTransitionTheme(): (
  apply: () => void,
  origin?: RevealOrigin | null,
) => void {
  return React.useCallback((apply: () => void, origin?: RevealOrigin | null) => {
    if (!supportsViewTransitions()) {
      apply()
      return
    }

    const point = origin ?? {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }
    const radius = Math.hypot(
      Math.max(point.x, window.innerWidth - point.x),
      Math.max(point.y, window.innerHeight - point.y),
    )

    void startViewTransition(apply).then(() => undefined)

    // `startViewTransition` above already ran `apply` inside the transition; the clip animation is
    // attached on the next frame, once the pseudo-elements exist. `document.documentElement.animate`
    // targets them by pseudo-selector -- guarded because not every engine that ships the API also
    // ships pseudo-element animation targets.
    requestAnimationFrame(() => {
      try {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${point.x}px ${point.y}px)`,
              `circle(${radius}px at ${point.x}px ${point.y}px)`,
            ],
          },
          {
            duration: 300,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        )
      } catch {
        // No pseudo-element animation support -- the plain crossfade the browser does by default is
        // already a correct, complete transition.
      }
    })
  }, [])
}

/** Centre of an element, in viewport coordinates -- what the toggle passes as the reveal origin. */
export function originOf(el: Element | null): RevealOrigin | null {
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
