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
 * Returns a **callback ref** rather than a `RefObject`, on purpose: the caller's target element is
 * typically mounted after a loading/skeleton branch (the board renders its skeleton first, then the
 * real scroller once the query resolves), and a `useLayoutEffect` keyed on `ref.current` at mount
 * time would measure `null` once, on the skeleton render, and then never re-run -- effects do not
 * re-fire just because a ref's `.current` changes later. A callback ref re-measures (and re-wires its
 * listeners) exactly when React actually attaches it to a new DOM node, skeleton or not. */
export function useViewportBoundedHeight<T extends HTMLElement>(
  minPx = 320,
): [(node: T | null) => void, number | undefined] {
  const [height, setHeight] = React.useState<number | undefined>(undefined)
  const cleanupRef = React.useRef<() => void>(() => {})

  const measure = React.useCallback(
    (el: T) => {
      const top = el.getBoundingClientRect().top
      const main = el.closest('main')
      const bottomGutter = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      setHeight(Math.max(minPx, window.innerHeight - top - bottomGutter))
    },
    [minPx],
  )

  const setRef = React.useCallback(
    (node: T | null) => {
      cleanupRef.current()
      cleanupRef.current = () => {}
      if (!node || typeof ResizeObserver === 'undefined') return

      const onResize = () => measure(node)
      onResize()
      window.addEventListener('resize', onResize)
      // Anything above the scroller (header tabs wrapping to a second line in a longer locale, a
      // filter chip row growing) moves the element's own top offset -- a ResizeObserver on the
      // element itself plus its previous-sibling chain would be exact, but observing
      // `document.body` catches every such reflow with one observer and no per-ancestor wiring.
      const ro = new ResizeObserver(onResize)
      ro.observe(document.body)
      cleanupRef.current = () => {
        window.removeEventListener('resize', onResize)
        ro.disconnect()
      }
    },
    [measure],
  )

  React.useEffect(() => () => cleanupRef.current(), [])

  return [setRef, height]
}
