// Screenshot naming, read exactly by `agentic/scripts/dod.mjs:34-49` (this item's handoff, verbatim):
// `<route with non-alnum -> _>__<width>__<light|dark>__<uz|ru>.png`, written to
// `agentic/ledger/cycles/EPIC-000/qa-visual/` (`lib/env.ts`'s `QA_VISUAL_DIR`). `dod.mjs` derives the
// slug itself with `route.replace(/[^a-z0-9]+/gi, '_')` from whatever `manifest.json`'s `routes[]`
// contains -- every route slug this suite uses (`root`, `login`, `setup`, `admin`, `404`, plus the
// shell-component and storybook pseudo-routes below) is already alphanumeric, so that transform is a
// no-op and there is exactly one place (this file) that has to agree with `dod.mjs` about the format.
export type ScreenshotTheme = 'light' | 'dark'
export type ScreenshotLocaleShort = 'uz' | 'ru'

export function slugify(input: string): string {
  return input.replace(/[^a-z0-9]+/gi, '_')
}

/** The baseline-grid / locale-sweep / forced-state name (spec.md §12 A-C): `dod.mjs`'s exact shape,
 * `<slug>__<width>__<theme>__<locale>.png`. A forced state's kind is appended as a fifth segment
 * (spec.md §12 naming: "...__<state>.png") -- `dod.mjs`'s own baseline check only ever looks for the
 * four-segment `default` form, so appending a fifth segment for a *different* state never collides
 * with, or satisfies, that check by accident. */
export function screenshotName(
  slug: string,
  width: number,
  theme: ScreenshotTheme,
  locale: ScreenshotLocaleShort,
  state?: string,
): string {
  const base = `${slugify(slug)}__${width}__${theme}__${locale}`
  return state ? `${base}__${state}.png` : `${base}.png`
}
