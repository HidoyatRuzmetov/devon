# Complete platform QA and tutorial

The authoritative objective is the user-provided goal attachment dated October 8, 2026.
This pass preserves the full scope: local visual implementation, local functional repair,
then a finished live-production instructional video. The previous repair release is a baseline,
not proof that this new assignment is complete.

## Current boundaries and authorization

- Branch: `codex/platform-qa-2026-10`. Preserve existing Claude workflow and newly installed skill files.
- All destructive tests, debugging and schema development use explicit loopback test databases.
- Local tests strip inherited Telegram/AI/email credentials and use their own local storage.
  Telegram/AI network integrations remain excluded from local end-to-end execution.
- October 8 user steering authorizes commits, push and deployment after complete local repairs/gates.
- The final tutorial must follow that deployment, in English, using the user's logged-in production
  account. It may include Telegram/AI. A separate demo account is not required by the user.
- Latest October 8 steering requires a readiness handoff after all pre-video requirements and
  release verification. Wait for the user's explicit approval before starting video making or
  production recording. Existing editor preparation remains available; no live footage exists.
- Recording still protects private contacts, credentials and colleagues' records. Mutations must be
  safe owned examples; no exploratory/destructive production testing.
- October9 steering adds a department-head role review: retain personal task ownership and ordinary
  work capabilities, but distinguish the department-wide head from employees genuinely awaiting
  unit assignment. Inspect structure, people, workload, assignment/filter controls and other
  affected head views; do not silently assign the head to an arbitrary unit.
- Later October 9 steering defers unrealistic tiny-screen and enlarged-text combinations. This
  release focuses on ordinary desktop/laptop/tablet and 390px phone use at normal text size.
  Existing 320px/200% failures are retained as deferred, not relabeled as fixed or passing.

## Evidence and completion rules

`inventory.json` lists actual route manifests and JSX controls. Source discovery is only a starting
point. `traceability.csv` exposes the source item IDs. Neither file establishes browser coverage.
Each item retains applicable state evidence and an explicit pending/tested/fixed-and-retested/
not-applicable-with-reason/excluded/blocked disposition. Do not label uninspected pixels as reviewed.
Add runtime controls found by exploration rather than relying on the static inventory alone.

Capture and inspect screens, nested surfaces and distinct controls. Current release environments cover
desktop/laptop, 768/390 widths, ordinary short viewports, both themes and all four locales.
Tiny-screen, enlarged-text and extreme-zoom expansion is deferred by the user's latest instruction.
System theme resolves to light/dark; test
the preference transition separately. Exercise keyboard/focus/Escape, touch, errors, recovery,
concurrent edits and persisted effects. Real local services and synthetic fixtures are required.

Browser evidence must identify the role, data, viewport, locale, theme, route/surface, state,
assertions, screenshot path, and whether a human-like pixel inspection actually occurred.
Screenshots/recordings stay outside Git when large; manifests and commands remain durable.

## Work streams

1. Local safety and service harness, route/control census, visual/interaction exploration (root).
2. Event wizard, RSVP persistence/freshness and group-dispatch source/boundary regressions.
3. Shared/card/project visual controls, touch targets, contextual affordances and regression captures.
4. Editable tutorial pipeline, qualified production captures, English narration/captions, full render
   and playback/frame/audio quality evidence after local completion and deployment.

## Known scope gaps at start

The old 13 browser journeys/four accessibility scenarios do not prove complete control/state coverage.
The original root suite can skip missing services and uses forced screen states; these are not accepted
as proof of the actual full application. No finished tutorial exists. Firefox/WebKit availability,
full rendering/recording tooling and narration review need explicit evidence.

## Reproducible commands

Generate source inventory: `node tools/qa/inventory.mjs`.
Safety regressions: `pnpm --filter @devon/web exec vitest run --config test/vitest.config.ts test/unit/flow-safety.test.ts`.
Per-run browser databases and ports: `FLOW_DB_NAME=devon_flow_e2e_<slice>` with separate
`FLOW_API_PORT` and `FLOW_WEB_PORT`; roles, credentials and scratch directories are namespace-specific.
Use the application's supported pnpm scripts for final gates. Further live-service/capture commands
are added when executed, not advertised as passing in advance.

## Completion audit

Pending. This goal stays active until the full inventory/state/role coverage, implemented repairs,
fresh regression sweep and all video artifacts/quality gates have authoritative evidence.
