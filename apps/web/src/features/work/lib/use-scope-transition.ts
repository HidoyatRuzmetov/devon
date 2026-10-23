import * as React from 'react'
import { flushSync } from 'react-dom'
import { DUR_MICRO, DUR_STANDARD } from '@devon/ui'

function opacityOf(surface: HTMLDivElement | null): number {
  if (!surface) return 1
  const opacity = Number.parseFloat(getComputedStyle(surface).opacity)
  return Number.isFinite(opacity) ? opacity : 1
}

/** Replace the complete surface at the fade midpoint. One mounted canvas preserves native scroll
 * and drag ownership; interruptions continue from the visible opacity without flashing the base. */
export function useScopeTransition<T extends string>(
  value: T,
  commit: (value: T) => void,
  surfaceRef: React.RefObject<HTMLDivElement | null>,
): (next: T) => Promise<void> {
  const animation = React.useRef<Animation | null>(null)
  const revision = React.useRef(0)
  const acceptedValue = React.useRef(value)

  // URL/history changes can replace scope independently of this control. Cancel a queued click so
  // its older value cannot overwrite that navigation, and finish revealing the new surface.
  React.useLayoutEffect(() => {
    if (value === acceptedValue.current) return
    acceptedValue.current = value
    const current = ++revision.current
    const surface = surfaceRef.current
    const opacity = opacityOf(surface)
    animation.current?.cancel()
    animation.current = null
    if (
      !surface?.animate ||
      opacity === 1 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return
    const reveal = surface.animate([{ opacity }, { opacity: 1 }], {
      duration: DUR_STANDARD,
      easing: 'ease-out',
      fill: 'forwards',
    })
    animation.current = reveal
    void reveal.finished
      .then(() => {
        if (current === revision.current) {
          reveal.cancel()
          animation.current = null
        }
      })
      .catch(() => undefined)
  }, [value, surfaceRef])

  React.useEffect(
    () => () => {
      revision.current += 1
      animation.current?.cancel()
    },
    [],
  )

  return async (next) => {
    const current = ++revision.current
    const surface = surfaceRef.current
    // Read before cancellation: cancelling WAAPI restores the CSS opacity immediately.
    const opacity = opacityOf(surface)
    animation.current?.cancel()
    animation.current = null
    if (!surface?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (next !== value) commit(next)
      return
    }
    if (next !== value) {
      const outgoing = surface.animate([{ opacity }, { opacity: 0 }], {
        duration: DUR_MICRO,
        easing: 'ease-in',
        fill: 'forwards',
      })
      animation.current = outgoing
      try {
        await outgoing.finished
      } catch {
        return
      }
      if (current !== revision.current) return
      acceptedValue.current = next
      flushSync(() => commit(next))
      // The incoming animation below supersedes this finished fill in the same frame.
      outgoing.cancel()
    } else if (opacity === 1) {
      return
    }
    const incoming = surface.animate([{ opacity: next === value ? opacity : 0 }, { opacity: 1 }], {
      duration: DUR_STANDARD,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards',
    })
    animation.current = incoming
    try {
      await incoming.finished
    } catch {
      return
    }
    if (current === revision.current) {
      incoming.cancel()
      animation.current = null
    }
  }
}
