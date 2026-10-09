# Supported final browser gates — 2026-10-09

These are the required package browser gates. The frontend build is genuine production React with no forced-state flag. The backend remains the guarded local development API, with synthetic records, local scanner exception and external credentials removed; this does not certify production TLS or live Telegram/AI delivery.

## Exact results

| Run                                      | Result                                                 | Evidence                                                                         |
| ---------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Initial compiled `test:e2e` selection    | 20 passed, 5 failed, zero retries/skips/flaky cases    | `artifacts/qa/2026-10/release-gates/browser-production-final/e2e.json`           |
| Corrected compiled head lifecycle        | 1 passed, zero retries/skips/flaky cases               | `artifacts/qa/2026-10/release-gates/browser-production-final/head-compiled.json` |
| Supported default development `test:e2e` | 25 passed, zero retries/skips/flaky cases; 8.5 minutes | `artifacts/qa/2026-10/release-gates/browser-production-final/e2e-dev.json`       |
| Supported compiled `test:a11y`           | 4 passed, zero retries/skips/flaky cases; 6.7 minutes  | `artifacts/qa/2026-10/release-gates/browser-production-final/a11y.json`          |

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

The compiled accessibility gate passed the existing head, member, superadmin and public journeys. Its final `after-a11y.json` receipt retains the exact source and original 136-file production asset hashes. The development gate's `after-dev-e2e.json` retains those hashes too; that run did not consume the compiled assets. Final `cleanup.json` records zero listeners across all four owned ports after the suites completed. No normal-use failure remains in these required browser checks. No further optional matrices or tiny-screen/enlarged-text release checks are opened.

## Subsequent GitHub group-project selector correction

The GitHub `73b4bc8` compiled flow failed when its global exact `Bekor qilish` selector resolved two Undo buttons. The downloaded trace establishes the actual contexts: `call@1288` contains the milestone receipt `Bosqich oʻchirildi.`; after its Undo, that toast remains `data-removed=true` and `data-visible=true` during exit. At timestamp 52828.252, the new project deletion receipt is mounted while that previous exiting toast remains visible. The global Undo click starts at 52830.261 and fails strict resolution. The later error-context snapshot contains only the surviving project toast, so that snapshot alone does not explain the earlier two-element match.

The test now selects each Undo within the Sonner receipt containing its exact milestone or project deletion message. It deliberately defers milestone Undo until after project Undo, keeping two real actionable deletion receipts overlapping. Every original checkpoint restore, project route, progress and task assertion is retained. No positional `.last()`/`.nth()` workaround, forced click, increased timeout or retry was added.

The single corrected compiled group flow passed in 16.9 seconds, with zero retries, skips or flaky cases. It restored the project route, 100% progress and objective task, then restored the checkpoint through its separate receipt. Report: `artifacts/qa/2026-10/release-gates/browser-production-final/group-undo.json`.

This replay uses the root's subsequent genuine production build, source SHA-256 `cc486d1dd63b18e07bb1db9fd29e53254f5f2cb891892b9f4ad79416f127ebfb`, after the separately owned expired-session repair. Its 136-file asset manifest is `7826f8583e03866fd05f3b23200ec0db4153ddd4b4eb33d7eb5f0c4ddd4bc766`. The earlier 25/4 gate results above remain bound to their original `f87cfe16…` build; this targeted replay does not relabel those earlier reports as a full rerun on the later build.

The final `group-undo-after.json` verifies those source and asset hashes against `group-undo-before.json`. `group-undo-cleanup.json` records zero listeners on the owned API/web ports 48991/48992. Both receipts are retained beside the group-flow report.
