# Supported final browser gates — 2026-10-09

These are the required package browser gates, rather than another audit matrix. The frontend build is genuine production React with no forced-state flag. The backend remains the guarded local development API, with synthetic records, local scanner exception and external credentials removed; this does not certify production TLS or live Telegram/AI delivery.

## Exact results

| Run | Result | Evidence |
| --- | --- | --- |
| Initial compiled `test:e2e` selection | 20 passed, 5 failed, zero retries/skips/flaky cases | `artifacts/qa/2026-10/release-gates/browser-production-final/e2e.json` |
| Corrected compiled head lifecycle | 1 passed, zero retries/skips/flaky cases | `artifacts/qa/2026-10/release-gates/browser-production-final/head-compiled.json` |
| Supported default development `test:e2e` | 25 passed, zero retries/skips/flaky cases; 8.5 minutes | `artifacts/qa/2026-10/release-gates/browser-production-final/e2e-dev.json` |
| Supported compiled `test:a11y` | Pending | `artifacts/qa/2026-10/release-gates/browser-production-final/a11y.json` |

The initial compiled report remains unchanged. Four failures occur before their UI assertions because three component-fixture files inject TSX through Vite's development-only `/@fs` endpoint: Avatar readability (one case), Badge contrast/native controls (two cases) and Dialog scroll (one case). Production preview does not serve that endpoint. Those four checks remain in the full default development gate. Explicit compiled verification ignores only those three exact files, retaining all 21 ordinary application flows and all four accessibility cases. The config/helper has four passing unit regressions and passing scoped ESLint/Prettier checks; actual config-selection guards are recorded by the release gate owner.

The fifth initial failure was a stale test selector, rather than a 45-second performance failure. Its trace shows `selectOption({ label: 'Test Head' })` waiting for the rest of the test. The real head option now includes its role suffix. The corrected test selects the authenticated actor's actual `/me` user ID and passed the complete compiled head journey in 18.3 seconds: card creation, checklist completion/edit/deletion, card deletion and persisted Undo, and FAQ search. The 20 ordinary initial successes plus this one targeted corrected success provide bounded successful coverage of those 21 distinct ordinary flows; they are not represented as a new unfiltered 21-case report.

## Source and artifact receipts

The stable production input SHA-256 is `f87cfe16a5a97ce2b951d5c5794772e2fd08f8f4adecbe49696e27663248e932`. The original 136-file served-build manifest SHA-256 is `c8ca5ec676b92d052473c8b27a307cf221a5a6de16645edd3cd11e10314ee6ad`. The actual builder's `productionBuildInputs` validates the source; no approximation or weakened filter is used.

The first literal full-directory after check refused because a concurrent completed typecheck added only `dist/tsconfig.tsbuildinfo`. Every original asset retained its byte hash. The refused comparison is preserved in `after-e2e-refused.json`, and that generated compiler cache was moved to `typecheck-added-tsconfig.tsbuildinfo` under the ignored gate artifacts. The restored 136-file manifest and source hash then passed the original check in `after-e2e.json`.

An unrelated Node harness test temporarily left embedded Git fixtures in an unignored scratch location, causing the source stager to refuse a nonregular candidate. Its owner moved the fixture base to the verified ignored test scratch directory and cleaned only the exact owned fixtures. The source guard was retained.

## Local isolation and commands

The base development and compiled accessibility runs use `devon_flow_e2e_release`, API `127.0.0.1:48991` and web `127.0.0.1:48992`. The one corrected compiled head run uses its separate `devon_flow_e2e_release_head`, API `48993` and web `48994`; actual local PostgreSQL capacity was checked before overlapping that single case with the development gate. Each run has one worker and zero retries, unique report/output directories and suite-owned cleanup.

The actual package commands are `pnpm test:e2e --workers=1 --retries=0` and `pnpm test:a11y --workers=1 --retries=0`, with list/JSON reporters and separate absolute output paths. `FLOW_PRODUCTION_BUILD=0` selects the existing development transport; `1` requires the current stable build receipt and serves production preview. No production fixture transport or fixture assets were added.

An initial unquoted PowerShell comma in the reporter argument failed before config/test execution. The CLI diagnostic remains `cli-reporter-argument-before.log`; the actual commands quote `'--reporter=list,json'`. This invocation error is not counted as a test failure or retry.

The default development gate completed with zero remaining listeners on its ports. Its after receipt retained the exact source and original 136-file production asset hashes; that development run did not consume the compiled assets. Final accessibility and cleanup counts will replace the pending row after its actual report completes. No further optional matrices or tiny-screen/enlarged-text release checks are opened.
