# Work item: EPIC-000.9 e2e/: routes.json, Playwright, axe, screenshot + state-forcing + overflow/glyph tests

- **Epic:** EPIC-000   **Owner:** wp-frontend
- **Depends on:** EPIC-000.7   **Parallel-safe:** no
- **Covers:** AC-6, AC-7, AC-14
- **Class:** B

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `e2e/routes.json`
- `e2e/**`

## DOES NOT
- touch `apps/web/src` (only exercises it), `packages/ui`, or `packages/i18n`
- touch `agentic/gates.json` (protected — this item makes the existing gate commands pass, it does not add gates)

## Handoff contract
`e2e/routes.json` entries: `{path, name, auth, requires?}` for `/`, `/login`, `/setup`, `/admin`, `/404`. State forcing reads `?__state=empty|loading|error|forbidden|offline` (behind `DEVON_E2E=1`). Screenshot naming (read exactly by `agentic/scripts/dod.mjs:34-49`): `<route with non-alnum → _>__<width>__<light|dark>__<uz|ru>.png` written to `agentic/ledger/cycles/EPIC-000/qa-visual/`, plus `manifest.json` with `routes[]` and `states_verified:true`. Build the full 132-shot manifest from design.md §12. 390px overflow assertions: `el.scrollWidth <= el.clientWidth + 1` on every `[data-shell-label]`; no `document.documentElement` horizontal scroll; no computed `text-overflow: ellipsis`. Glyph assertions: advance-width comparison of `Oʻ Gʻ ʼ ў ғ қ ҳ` vs. forced fallback; `document.fonts.check()` true. Same-origin network assertion on every shell route. axe zero serious/critical on every route in `routes.json`. `@smoke`-tagged subset must be fast enough to serve as every other item's `e2e-smoke` gate.

## Done when
- gates profile `item` green; full `e2e` and `a11y` gates pass at integration time
- `wp-reviewer` and `wp-qa-visual` have no open SEV1/SEV2
- evidence: 132-shot manifest complete and named per `dod.mjs`; zero overflow/glyph-substitution failures at 390px in uz-Latn and ru
