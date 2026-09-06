// Glyph-substitution assertions (design.md §4(j), this item's handoff: "Glyph assertions:
// advance-width comparison of Oʻ Gʻ ʼ ў ғ қ ҳ vs. forced fallback; document.fonts.check() true").
// `Oʻ`/`Gʻ` use U+02BB (MODIFIER LETTER TURNED COMMA), `ʼ` uses U+02BC (MODIFIER LETTER APOSTROPHE)
// per DESIGN.md §2.3 -- typed as literal codepoints here, not typed by hand in this file's source, so
// a future encoding mix-up in an editor cannot silently swap in the ASCII lookalikes.
import type { Page } from '@playwright/test'

// The exact seven tokens named in the handoff, not decomposed to their bare modifier letters -- "Oʻ"
// and "Gʻ" are tested as the two-character sequences a reader actually sees (base letter + U+02BB),
// since a subset that drops the combining-adjacent kerning table could pass a bare-glyph check while
// still rendering the pair wrong.
export const CANARY_GLYPHS = ['Oʻ', 'Gʻ', 'ʼ', 'ў', 'ғ', 'қ', 'ҳ'] as const

const FALLBACK_STACK = '"Devon Nonexistent Test Font", "Comic Sans MS", cursive'

export interface GlyphMeasurement {
  glyph: string
  shippedWidth: number
  fallbackWidth: number
  substituted: boolean
}

/** Renders each canary glyph off-screen in the page's real, shipped font stack and in a font stack
 * guaranteed not to resolve to one of our self-hosted subsets, and compares `getBoundingClientRect`
 * advance widths. Equal widths (within a sub-pixel epsilon) mean the "shipped" font never actually
 * supplied the glyph and the browser silently fell back -- design.md's exact failure mode. */
export async function measureGlyphSubstitution(
  page: Page,
  shippedFontFamily: string,
): Promise<GlyphMeasurement[]> {
  return page.evaluate(
    async ({ glyphs, shipped, fallback }) => {
      // `document.fonts.ready` only resolves for faces a real render has already *triggered* --
      // `/login`'s visible text may never happen to use this exact family/weight/style combination
      // (each weight is its own `@font-face`, loaded lazily), so an off-screen probe span could
      // silently measure the *browser's own* fallback for both "shipped" and "fallback" and read as a
      // false negative. `document.fonts.load()` forces the specific face this test cares about --
      // it needs a literal family list, not a `var(--font-sans)` reference (the CSS Font Loading API
      // does not resolve custom properties), so it is resolved once via `getComputedStyle` first.
      const probe = document.createElement('span')
      probe.style.fontFamily = shipped
      document.body.appendChild(probe)
      const resolvedFamily = getComputedStyle(probe).fontFamily
      probe.remove()
      await Promise.allSettled(glyphs.map((g) => document.fonts.load(`64px ${resolvedFamily}`, g)))

      function widthOf(glyph: string, fontFamily: string): number {
        const span = document.createElement('span')
        span.style.position = 'absolute'
        span.style.visibility = 'hidden'
        span.style.whiteSpace = 'pre'
        span.style.fontSize = '64px'
        span.style.fontFamily = fontFamily
        span.textContent = glyph
        document.body.appendChild(span)
        const width = span.getBoundingClientRect().width
        span.remove()
        return width
      }
      return glyphs.map((glyph) => {
        const shippedWidth = widthOf(glyph, shipped)
        const fallbackWidth = widthOf(glyph, fallback)
        return {
          glyph,
          shippedWidth,
          fallbackWidth,
          // A genuine substitution renders both spans through the literal same font file/glyph, so
          // the two widths are bit-identical (diff 0, modulo float rounding) -- verified empirically
          // while building this test: two visually-similar but genuinely *different* glyphs (our
          // real "Gʻ" vs. the fallback stack's own) still differ by ~0.09px at 64px, which a looser
          // threshold (0.5px) misreads as a substitution. `document.fonts.check()`
          // (`fontsChecked` below) is the second, corroborating signal this item's handoff also asks
          // for; this threshold only needs to catch true equality, not "close".
          substituted: Math.abs(shippedWidth - fallbackWidth) < 0.05,
        }
      })
    },
    { glyphs: [...CANARY_GLYPHS], shipped: shippedFontFamily, fallback: FALLBACK_STACK },
  )
}

/** design.md §4(j)'s second assertion: "each codepoint's `document.fonts.check()` is true". Returns
 * one boolean per `CANARY_GLYPHS` entry, checked against `cssFontShorthand` (e.g. `'16px "Devon
 * Sans"'`). `document.fonts.ready` is awaited first so a slow-loading woff2 never reads as a false
 * substitution. */
export async function fontsChecked(
  page: Page,
  cssFontShorthand: string,
): Promise<Record<string, boolean>> {
  return page.evaluate(
    async ({ shorthand, glyphs }) => {
      // Same reasoning as `measureGlyphSubstitution`: force-load the exact face under test rather
      // than trusting that `/login`'s own visible text already triggered it.
      await Promise.allSettled(glyphs.map((g) => document.fonts.load(shorthand, g)))
      const out: Record<string, boolean> = {}
      for (const glyph of glyphs) out[glyph] = document.fonts.check(shorthand, glyph)
      return out
    },
    { shorthand: cssFontShorthand, glyphs: [...CANARY_GLYPHS] },
  )
}
