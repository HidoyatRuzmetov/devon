import * as React from 'react'

/** UI-OVERHAUL.md's "pin the board to the viewport" fix: the app shell's `<main>` has no bounded
 * height of its own (only the sidebar does, via `h-dvh`), so a plain `h-full`/`min-h-0`/`flex-1`
 * chain inside it resolves against an `auto`-height ancestor and does nothing -- the board's columns
 * grow to their content height, the *document* scrolls, and the sticky column heads scroll away with
 * it. A hardcoded `h-[calc(100dvh-56px-…)]` would need one magic number per surrounding chrome
 * element (topbar, PageHeader, quick-add bar, filter bar) and a second set for every locale, since Uz
 * and Ru text wraps the header tabs differently -- so this measures the real remaining space instead:
 * the element's own top offset plus the nearest `<main>`'s bottom padding, live across resizes and
 * content changes (a filter chip wrapping to a second line, the header growing).
 *
 * Returns a ref to attach to the element that should fill the rest of the viewport, and its computed
 * height in pixels (`undefined` before the first measurement, e.g. during SSR/first paint -- callers
 * should pair it with a `min-h-*` Tailwind class so nothing collapses to 0 in that instant). */
export function useViewportBoundedHeight<T extends HTMLElement>(
  minPx = 320,
): [React.RefObject<T | null>, number | undefined] {
  const ref = React.useRef<T | null>(null)
  const [height, setHeight] = React.useState<number | undefined>(undefined)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    function measure() {
      if (!el) return
      const top = el.getBoundingClientRect().top
      const main = el.closest('main')
      const bottomGutter = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      setHeight(Math.max(minPx, window.innerHeight - top - bottomGutter))
    }

    measure()
    window.addEventListener('resize', measure)
    // Anything above the scroller (header tabs wrapping to a second line in a longer locale, a
    // filter chip row growing) moves `top` -- a ResizeObserver on the element itself plus its
    // previous sibling chain would be exact, but observing `document.body` catches every such
    // reflow with one observer and no per-ancestor wiring.
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [minPx])

  return [ref, height]
}
