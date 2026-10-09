# Card permissions, drafts and narrow layout

Partial local slice; no release or full-platform completion is implied.

| Finding | Expected and actual before | Repair | Evidence |
| --- | --- | --- | --- |
| Unrelated reader property edits | API correctly returned canEdit=false, but description, person, priority and date controls remained editable. | Read-only description, disabled property pickers and no translation apply controls. Person pickers name both property and current value. Existing personal watching/focus actions remain available. | Actual missing readonly before failure: `results/platform/card-read-only-before`. After browser checks and independent403/no-change API assertions pass3/3 engines. |
| Failed draft autosave | Title/description blur could reject unhandled; a later property's optimistic rollback overwrote the earlier failed draft. | Keep dirty drafts separate from server refreshes/optimistic snapshots. Clear dirty status only for a successfully saved current draft; reset on card change. Shared mutation reports failures once; failed translation acceptance retains its preview. | Actual retained-title retry failed before the dirty-draft correction in `card-focused-diagnostics`. Controlled503, retained drafts, independent unchanged read, real successful retry and zero pageerrors passed3/3 engines. |
| Card description tools overflow | Actual member320 route exceeded the viewport at335px; translation label/select/action refused to wrap. | Named description group with explicit textarea label, wrapping bounded Field actions and translation picker. | Original route-sweep-two pixels reviewed. After320/390/768 and200% text checks passed3/3 engines. |
| Time-entry delete clipping | Nonshrinking duration/person/date columns pushed deletion beyond narrow content. | Wrap details inside a shrinking content region, keep delete target reachable, show the complete note; retain stable list entrance key when entries change. | Real browser adds45minutes, verifies persisted note/total, reloads, measures24px target at320/390/768/text200, deletes and independently verifies zero entries/total. All3 engines pass. |
| Repeated saves overtook older requests | With an earlier title request deliberately held, a second title PATCH reached the server concurrently. | Serialize this client's short card-patch queue while keeping optimistic cache behavior and retained newer drafts. | Actual before failure in `personal-card-order-before`; ordered held503 then successful newer save, independent read and reload pass3/3 engines in `personal-card-order-after`. |

Final scoped report: `artifacts/qa/2026-10/results/platform/card-inbox-final-focused/summary.json`
(15 cases: three card journeys and two inbox journeys, each Chromium/Firefox/WebKit; zero skips/retries).
Newer scoped report: `artifacts/qa/2026-10/results/platform/personal-card-order-after/summary.json`
(24 cases: four card journeys and four personal navigation journeys across all three engines; zero skips/retries).
Card captures: `artifacts/qa/2026-10/card-reflow/`. Root opened Chromium320 normal and200% text,
Firefox320200% text and WebKit320200% text. Translation label/selected locale and time-entry
note/delete reflow correctly in these captures. Firefox's title is clipped after font-only enlargement;
that new finding was sent to the shared-control owner and its final repair/pixels remain pending.
Avatar initials also clip at200% text; the shared-control owner is repairing that independently.

Two initial test labels incorrectly guessed “Deadline”/“Start date” and a save-error sentence;
they were corrected from the actual catalogue. These failures are test mistakes, not product findings.
The initial html-font-size enlargement doubled rem geometry while the typography tokens stayed in px;
it was invalid as text-only evidence and replaced with actual doubled typography/line-height tokens.
The corrected test is text enlargement, not browser-UI zoom or real-device testing.

Complete input-boundary validation, cross-tab concurrent saves, every permission role/state,
all locale/theme combinations and final production-build sweeps remain in the parent inventory.
