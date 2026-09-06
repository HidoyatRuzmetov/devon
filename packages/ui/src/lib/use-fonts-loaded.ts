import { useEffect, useState } from 'react'

/** One `font-weight 400` face per self-hosted family is enough to prove the subset resolved (the
 * other weights share the same `unicode-range` coverage). Kept here rather than inline so the
 * Storybook glyph page (design.md §12.F) and any future consumer read the same three strings. */
const PROBE_FONTS = ['16px "Devon Sans"', '16px "Devon Display"', '16px "Devon Mono"'] as const

/** `wp-a11y-i18n`/`wp-qa-visual` assert `document.fonts.check(...)` directly, but that only proves
 * the browser resolved a face for the family name -- not that the page has *finished* loading it
 * (a check before the network request settles can pass on the CSS fallback silently). This hook
 * waits on `document.fonts.ready` first, then re-checks, and only then flips `true` -- which is what
 * the item handoff's `data-font-loaded` attribute is required to reflect. */
export function useFontsLoaded(): boolean {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) {
      setLoaded(true) // no FontFaceSet (very old browser / non-DOM test) -- fail open, not blank
      return
    }
    let cancelled = false
    document.fonts.ready
      .then(() => {
        if (cancelled) return
        setLoaded(PROBE_FONTS.every((font) => document.fonts.check(font)))
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return loaded
}
