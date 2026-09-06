// @glyphs -- design.md §4(j), this item's handoff, verbatim: "Glyph assertions: advance-width
// comparison of Oʻ Gʻ ʼ ў ғ қ ҳ vs. forced fallback; document.fonts.check() true." Run against
// `/login` (needs no backend, `--font-sans` is already loaded by the time the form paints) rather than
// Storybook's dedicated glyph page (`packages/ui/src/foundations/glyphs.stories.tsx`,
// `tests/screenshots.spec.ts`'s §12.F shots) -- this is the fast, backend-independent gate check;
// Storybook's page is the human-inspectable evidence artefact.
import { expect, test } from '../fixtures.js'
import { CANARY_GLYPHS, fontsChecked, measureGlyphSubstitution } from '../lib/glyphs.js'

test('@glyphs the shipped --font-sans never falls back for Oʻ Gʻ ʼ ў ғ қ ҳ', async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(() => document.fonts.ready)

  const measurements = await measureGlyphSubstitution(page, 'var(--font-sans)')
  const substituted = measurements.filter((m) => m.substituted)
  expect(
    substituted,
    substituted
      .map(
        (m) =>
          `"${m.glyph}": shipped=${m.shippedWidth}px fallback=${m.fallbackWidth}px (equal -> substituted)`,
      )
      .join('\n'),
  ).toHaveLength(0)
})

test('@glyphs document.fonts.check() is true for every canary glyph in --font-sans', async ({
  page,
}) => {
  await page.goto('/login')
  const checked = await fontsChecked(page, '16px "Devon Sans"')
  const failing = CANARY_GLYPHS.filter((glyph) => !checked[glyph])
  expect(failing, `document.fonts.check() returned false for: ${failing.join(', ')}`).toHaveLength(
    0,
  )
})
