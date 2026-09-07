// Regression for the ambient-gradient-hidden-behind-an-opaque-background defect (UI-OVERHAUL.md §2.6,
// this item's handoff): `AmbientGradient` is `position: absolute` with a *negative* `z-index`, and
// `position: relative` alone (no `z-index` set) does not create a new stacking context -- so that
// negative `z-index` escapes to the nearest ancestor stacking context instead of staying local to its
// intended parent. An opaque `background-color` painted on that parent then sits, in stacking terms,
// above the escaped gradient layer and hides it completely, with no console error and no layout
// difference to catch. A screenshot alone does not prove this either -- a human has to *notice* a wash
// is missing. This decodes the actual rendered pixels (`../lib/png-pixel.ts`, no image-diffing
// dependency) and asserts the gradient's own radial center is measurably different from a flat
// reference point -- if the fix regresses, every pixel on the page is identical again and this fails
// outright rather than needing a human to eyeball a screenshot.
import { expect, test } from '../fixtures.js'
import { readPixel } from '../lib/png-pixel.js'

const VIEWPORT = { width: 1440, height: 900 }

function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
}

for (const path of ['/login', '/setup'] as const) {
  test(`@smoke the ambient gradient is actually visible on ${path}`, async ({ browser }) => {
    // `reducedMotion: 'reduce'` makes AmbientGradient's own drift animation stop (its documented
    // behaviour), so the gradient sits at its designed anchor instead of an arbitrary animation frame.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.goto(path)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(300)

    const png = await page.screenshot()

    // The primary layer's own radial centre (ambient-gradient.tsx, variant="auth": `60% 55% at 18%
    // 12%`) should read strongly tinted; a point far from both radial centres (the primary at 18/12
    // and the accent at 84/82) should read close to the flat page background.
    const gradientPeak = readPixel(
      png,
      Math.round(VIEWPORT.width * 0.18),
      Math.round(VIEWPORT.height * 0.12),
    )
    const flatReference = readPixel(
      png,
      Math.round(VIEWPORT.width * 0.5),
      Math.round(VIEWPORT.height * 0.98),
    )

    expect(
      colorDistance(gradientPeak, flatReference),
      `gradient peak ${JSON.stringify(gradientPeak)} is indistinguishable from the flat background ${JSON.stringify(flatReference)} -- the ambient wash is not rendering`,
    ).toBeGreaterThan(6)

    await context.close()
  })
}
