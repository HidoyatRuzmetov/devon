# People board navigation and quick-add repair

The requested repair addresses reaching distant colleagues, the hard cut at the viewport edges, coupled scrolling, and Add card being buried beneath a long column. It preserves the member/group ordering, card ordering and existing native drag implementation.

## Observed problem and resulting behavior

The read-only production capture at `artifacts/qa/2026-10/board-navigation/production-before.png` is 1707 × 889. The board viewport measured 1265 × 427 while its content measured 6672 × 1189. The fifth column was abruptly cut off, the user's distant column needed substantial horizontal navigation, and Add card was below the long columns.

The board now provides a searchable **Jump to a person** control, a direct **My column** button and previous/next buttons that disable at their respective boundaries. Choosing a colleague while Mine is active first returns to Everyone and then positions that column. The canvas keeps one native scroll region, with subtle themed scrollbar styling and separate left/right edge fades that do not mask the scrollbar. Each column's existing quick-add form is in its sticky member header, so it remains usable after vertical scrolling. Wheel, trackpad and native arrow-key scrolling remain available; no wheel interception or per-column scroll regions were introduced.

The source scope is `board-screen.tsx`, `board-column.tsx`, new `board-navigation.tsx` and `board-scroller.css`, plus the four `board-navigation` locale module fragments. The named scroll region is keyboard focusable with a focused, justified ESLint exception for native scrolling. Existing card detail actions remain unchanged.

## Bounded real-browser verification

`apps/web/test/e2e/board-navigation.qa.spec.ts` creates an actual local synthetic department with a head and eight colleagues, then creates 22 real cards through the API. The same-origin transport guard and fixture environment strip external AI, Telegram and mail credentials. The test namespace is `devon_flow_e2e_board_navigation`; final API/web ports are 49021/49022. No production data is created or edited.

Two journeys are executed in Chromium, Firefox and WebKit:

1. At 1366 × 900, start with the user's column offscreen; use native wheel scrolling and verify quick add remains visible; jump to the user's column; actually create a card and independently verify its assignment; search for a colleague, test the empty search and Escape focus return, navigate in both directions; then perform a native card drag as the head and independently verify both affected card orders and stable column order after reload.
2. At 390 × 844 with emulated touch capability, tap My column; switch to Mine; search and tap a colleague; confirm Everyone returns and the destination quick-add control is visible; use previous navigation and native arrow-key scrolling; verify no horizontal page overflow, no per-column vertical scrollers, and unchanged stored card count.

The initial development Chromium run reached the full desktop creation and native drag checks. Its last assertion captured column order before the head's board finished loading. The phone journey reached the searched colleague; its previous-button assertion incorrectly expected a fixed absolute scroll offset instead of a decrease from the current position. Both test assertions were corrected without changing product source or removing the behavior checks. The previous-button animation is allowed to reach its destination before testing native keyboard scrolling. The intermediate report remains under `development/results.json` and is not counted as a passing run.

The final compiled run passed **6/6 cases** in Chromium, Firefox and WebKit, with zero retries, skipped, unexpected, flaky or top-level errors. `compiled/results.json` records the actual final run. It used the stable production frontend receipt `10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`, with equal before/after input hashes and the forced-state build flag disabled.

The production-before capture, five development captures and all fifteen final compiled captures listed in `board-navigation-pixels.json` were opened at native resolution. The final captures in each engine show the initial desktop board, sticky quick-add after native wheel scrolling, the actual card created in the distant own column, and normal phone own-column/colleague search. No layout obstruction was observed in these captured states. Capture generation alone is not visual review. These bounded checks do not establish every filter, locale, theme, simultaneous editor, physical touch device or external integration.

Scoped ESLint and the web type check passed. This subtask did not build dist, mutate production, commit, push, deploy or record a tutorial.

## Reproduction

Use the root's current stable production build receipt at `tools/perf/lighthouse/out/production-build.json`, with local Docker Desktop and the existing local test fixtures healthy:

```powershell
$env:FLOW_DB_NAME = 'devon_flow_e2e_board_navigation'
$env:FLOW_API_PORT = '49021'
$env:FLOW_WEB_PORT = '49022'
$env:FLOW_REALTIME = '0'
$env:FLOW_SCANNER = '0'
$env:FLOW_PRODUCTION_BUILD = '1'
$env:BOARD_NAV_QA_RUN = 'compiled'
pnpm --filter @devon/web exec playwright test --config test/e2e/board-navigation-qa.config.ts --workers=1 --retries=0
```

The config checks the source receipt before starting its own servers and does not attach to an unrelated running application. Reports and native captures are under `artifacts/qa/2026-10/board-navigation/<run>/`.
