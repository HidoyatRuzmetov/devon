# Structure authoring repair and bounded verification

This pass covers ordinary department-head unit authoring at 1366 × 900, in English and the light theme, using an isolated synthetic department. It does not establish every Structure role, theme, locale, keyboard alternative, concurrent edit or chart export state.

## Reproduced defects and repairs

| Defect                                          | Reproduction and expected result                                                                                                                                      | Root cause and repair                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed unit creation discards the draft         | Create a named unit, interrupt the actual local POST, then retry. The unsuccessful request must leave the dialog and name available.                                  | The screen closed immediately after calling the mutation. It now closes only after success, retains the draft and displays the failure, and disables form controls while saving.        | `development-before/results.json` contains the original closed-dialog failure. `development-completed/results.json` proves the retained name, no stored unit after refusal, successful retry and reload in all three engines.                                                                 |
| Unit assignment leaves an obsolete people count | Assign a member as deputy to a child unit. Independent roster and unit-role reads must agree with the displayed count; removing the role must refresh that count too. | Mutations invalidated unit and role queries but left the roster cached. The common invalidation now includes the member query.                                                          | `development-unblocked/results.json` reached POST 201 and the independent roster assertion, then failed because the displayed count remained zero. `compiled/results.json` passes assignment, count one, chart-sheet removal, independent roster removal and count zero in all three engines. |
| Native row drop also moves the unit to the root | Drag a child row onto another unit. One move should persist that parent and the complete descendant path.                                                             | The row's drop bubbled into the surrounding list's root-drop handler, issuing a second conflicting PATCH. Row drops now stop propagation.                                               | The new browser assertion records the actual mutation bodies and requires exactly one PATCH to the selected parent. All three native-drag cases passed in `development-completed/results.json`.                                                                                               |
| Reparenting fails with HTTP 500                 | Move a child with a grandchild to another parent, then back to the root. Preserve unrelated paths and reject cycles.                                                  | PostgreSQL inferred the bound substring offset as text, selecting regex substring and producing NULL. `substring(path from $offset::integer)` selects the intended positional overload. | New real-Postgres regression failed before the cast with 500 / `units.path` NOT NULL, then passed both tests after the cast. `artifacts/qa/2026-10/structure-author/api-after.json` records the passing independent SQL/API reads and cycle guards.                                           |

The earlier claim that the Add a sub-unit menu was inaccessible was retracted: the test's exact textbox label was wrong. The unrelated nonmodal menu change was reverted. No menu workaround is part of this repair.

## Real browser journeys

`apps/web/test/e2e/structure-author.qa.spec.ts` uses real local frontend/API/Postgres with a same-origin browser transport guard and the existing API network guard. It creates only synthetic fixtures in `devon_flow_e2e_structure_author`, on API 48991 / web 48992. External AI, Telegram and email are unavailable; real-time and scanning are not asserted by this suite. Each test performs independent API reads, and the reparent integration test additionally reads PostgreSQL directly.

The three distinct journeys are:

1. Create a root unit, rename it, add a child, collapse/expand it, assign a deputy, open its org-chart sheet, remove that role, delete/Undo the subtree, reload, and confirm the department head retains department-wide management scope.
2. Use native row drag to move a child and its grandchild under a different parent, assert exactly one parent mutation, inspect persisted paths, then reload both descendants.
3. Interrupt the real create request, confirm the named draft and error remain and no unit exists, retry the actual request, then reload the persisted result.

The completed development run executed all nine browser cases with zero retries: six passed. The lifecycle cases stopped at an ambiguous text locator because Avatar includes the same name in a screen-reader span beside the visible name. This is recorded as a test-locator failure, not a product failure. A visible-only filter still included the 1px screen-reader span. The corrected assertion explicitly excludes that span while preserving the visible-name check. An anchored grep invocation selected no tests and provides no passing evidence. These intermediate results remain available and are not relabeled.

The full current-spec compiled replay passed **9/9 cases** in Chromium, Firefox and WebKit, with zero retries, skipped, unexpected, flaky or top-level errors. `compiled/results.json` records the final run. All twelve final native PNGs were opened: assigned child count, department-wide head status after the full lifecycle, persisted reparented subtree and retained failed-create draft in each engine. The stable production frontend receipt is `10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`, with identical before/after input hashes and the forced-state build flag disabled. Both package type checks and scoped ESLint passed; formatting checks passed. No production mutation, dist build, commit, push, deploy or recording was performed by this subtask.

## Reproduction commands

From the repository root, with local Docker Desktop running and the existing local `devon-postgres` container healthy:

```powershell
$env:FLOW_DB_NAME = 'devon_flow_e2e_structure_author'
$env:FLOW_API_PORT = '48991'
$env:FLOW_WEB_PORT = '48992'
$env:FLOW_REALTIME = '0'
$env:FLOW_SCANNER = '0'
$env:FLOW_PRODUCTION_BUILD = '1'
$env:STRUCTURE_QA_RUN = 'compiled-replay'
pnpm --filter @devon/web exec playwright test --config test/e2e/structure-author-qa.config.ts --workers=1 --retries=0
pnpm --filter @devon/api exec vitest run --config test/vitest.config.ts test/integration/structure-reparent.test.ts
```

Use a unique `STRUCTURE_QA_RUN` only after the repository release builder produces a current `tools/perf/lighthouse/out/production-build.json` receipt. The test config refuses stale source receipts and never reuses an unrelated server.

Reports and native PNGs are under `artifacts/qa/2026-10/structure-author/`. The six opened development before/after captures and twelve opened final compiled captures are listed separately in `structure-authoring-pixels.json`; capture generation alone is not visual review.
