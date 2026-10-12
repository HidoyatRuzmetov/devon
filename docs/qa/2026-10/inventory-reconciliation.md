# Current source and bounded evidence reconciliation

On 2026-10-12 the TypeScript census discovered 48 routes, 414 source files (410 parsed TypeScript files) and 2,057 JSX/composed surfaces. The current 17 authored evidence documents reconcile 374 exact records and 746 state bindings with **zero selector/cardinality/evidence issues**. They provide bounded evidence on 353 source surfaces and 734 distinct named states. Other source states remain explicitly pending; these counts do not certify the entire platform, every role or every environment combination.

`inventory.json`, `traceability.csv` and `evidence-reconciliation.json` retain the exact source, component, state, author, report and scope. Workflow-only descriptions remain separate rather than automatically granting coverage to nested controls. The merger removes withdrawn author bindings and refuses ambiguous source matches. All 12 inventory/applicability guard regressions passed during this reconciliation.

Exactly 100 Storybook-only surface records are inapplicable to ordinary colleague application routes. Each record has an applicability reason and references the source-boundary proof. The proof parses actual TypeScript imports, the feature-manifest glob, UI package exports and the separate Storybook entry; hashes identify those entry sources. Their real shared components remain separately in the census. This classification establishes no Storybook behavior or pixel pass and withdraws if an incoming story import, broader runtime glob or package export is discovered.

The latest user steering prioritizes normal-use release closure and defers tiny-screen/enlarged-text release cases. Their historical failures remain failures; no new pass or fix is inferred from the changed acceptance scope. No new optional matrix is opened. Already completed environmental evidence remains bounded to its report.

The Events overlay retains 67 exact records/112 states from the actual **101/101** unretried candidate: 93 functional/motion executions across Chromium, Firefox and WebKit plus eight already-running Chromium visual journeys. Its archived report is `artifacts/qa/2026-10/events-nested/complete-anchored/results.json`; the separate pixel ledger identifies 21 actually opened images/56 native viewport regions with explicit crop limits. Original failures remain preserved.

The two newly reconciled control overlays add 19 exact records/30 named bindings from the existing final invitation **6/6** and department-decision **3/3** compiled-web replays, across all three engines. Their genuine production frontend input hash is `10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`; the API is the guarded local development API with actual PostgreSQL. Separate pixel ledgers record the 12 invitation and nine decision originals that were actually opened, including masking/crop/loading limits. No blanket pixel flag is granted to their source controls, and no compiled API image or live-production proof is inferred. The decision repair additionally has 2/2 actual PostgreSQL regressions for requested-unit persistence, empty-unit approval and duplicate refusal. See `invitation-password.md` and `department-decisions.md` for exact provenance.

`work-workers-evidence.json` is also supplied to this reconciliation. Its two actual report hashes were checked: the initial compiled run retains 11 passes/one startup failure, and the exact subsequent Chromium after-done replay passed 1/1. Together they establish the twelve named engine/workflow cases, **not one all-green twelve-case report**. This document has no `records` or `entries` in the merger schema; its owner is retained, but it adds no inferred source bindings. Worker scope remains documented in its own ledger and the workflow qualification list.

Existing work, calendar, settings and newer compiled board/Structure receipts are qualified in `distinct-workflow-gaps.md` and their author ledgers. A workflow documented there receives no additional source binding unless an exact authored overlay supplies it. The remaining root release checks are separate from this completed source reconciliation.

Reproduce after source and author overlays stabilize. The explicit list is required: the merger's default list omits the new invitation, decision and worker evidence documents.

```powershell
node tools/qa/inventory.mjs
$qaOverlays = @(
  'events-management-admin-evidence.json',
  'visual-controls-evidence.json',
  'knowledge-nested-evidence.json',
  'account-settings-evidence.json',
  'calendar-fields-evidence.json',
  'calendar-shell-evidence.json',
  'fields-current-evidence.json',
  'knowledge-publication-evidence.json',
  'sidebar-evidence.json',
  'head-scope-evidence.json',
  'shell-recovery-evidence.json',
  'goals-evidence.json',
  'work-controls-evidence.json',
  'events-nested-evidence.json',
  'invitation-password-evidence.json',
  'department-decisions-evidence.json',
  'work-workers-evidence.json'
)
node tools/qa/merge-inventory-evidence.mjs $qaOverlays
node --test tools/qa/test/merge-inventory-evidence.test.mjs tools/qa/test/source-applicability.test.mjs
```

A successful generation is source reconciliation, not another browser or pixel inspection. All work in this reconciliation is local. External Telegram/application AI calls and walkthroughs remain excluded; no production, commit, push, deployment or video action is performed by this agent. The root owns required release gates and release operations. Video work awaits explicit user approval after the release handoff.
