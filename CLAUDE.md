# Devon (WorkPortal)

Self-hosted platform where a department runs its week: a board with a column per person, group
projects, a private personal workspace (sprints, nested tasks, canvas, Pomodoro), events with RSVP,
carpooling and polls, an inbox and a Telegram bot, analytics for everyone, AI helpers on the
government's GLM-5.2, one super admin with pause and wipe switches. Anyone registers; a fresh account
creates a department (approved once by the super admin, creator becomes head) or joins one with a key
and a password. Four locales, uz-Latn default. No ministry layer, no HR, no documents, no chat.

## Where things are (binding documents)
- `docs/03-plan/TECH-SPEC.md` — the technical design (v2, final): §2 accounts/departments/roles,
  §3 data model, §4 API, §5 frontend, §6 backend, §7 Telegram, §8 AI, §9 analytics, §10 admin,
  §11 pause/wipe, §12 gates, §13 ops, §14 demo, §15 epics, §16 coding standards, §19 decisions.
- `docs/03-plan/FEATURE-PLAN.md` (v3) — product intent and refusals. `docs/03-plan/TASKS.md` — work
  items per epic. `docs/03-plan/backlog.json` — the only place scope enters; all 21 epics are ready.
- `DESIGN.md` — tokens (Palette B), type, motion, components, states, copy rules.
- `agentic/HARDENING.md` — the 30-section production checklist; verifiers cite item ids; EPIC-014 runs it in full.
- `agentic/PROTOCOL.md` (binding), `ROSTER.md`, `INVARIANTS.md`, `gates.json`, `scripts/`, `hooks/`, `ledger/`.
- `plugins/wp-agentic/` — the delivery system as a plugin (`/wp-agentic:ship`, `status`, `escalations`).
- `docs/01-research/` — 25 research reports (cite them). `docs/03-plan/integrations/glm-api-instruction.md` — the AI API (key never in repo).

## How work happens (summary of `agentic/PROTOCOL.md`)
1. `ship` takes the next ready epic and runs `feature-cycle`: freeze criteria (incl. HARDENING items)
   → design → decompose (TASKS.md) → build (gates → review → bounded fix) → integrate → verify →
   adjudicate → release → scout. Loops are bounded; stalemates become escalation files with a default.
2. Deterministic gates decide; model verdicts add fingerprinted findings with a REPRO.
3. Makers never verify their own work; verifiers cannot edit; tests and gates are never edited to pass.

## Conventions (TECH-SPEC §16)
- pnpm monorepo: `apps/web`, `apps/api`, `packages/{db,contracts,ui,i18n,ai,config}`, `e2e/`, `infra/`.
  Package scope `@devon/*`.
- Every department table has `department_id` + RLS; personal workspace rows are owner-only; every
  write emits audit + outbox in one transaction; every endpoint checks `can()`; every string through
  i18n in four locales; every screen has empty/loading/error/no-permission/offline states; undo over
  confirm; `Ctrl/⌘+K` reaches everything; tokens only; no query in a loop; timeouts on every outbound call.
- Pin exact versions (TECH-SPEC §1.2). Never edit an applied migration. Never force-push. No secrets.
- Model tiers: research/review/QA on Sonnet; architecture/design/adjudication/security on Opus;
  haiku runners for scripts; the orchestrating session on Fable.

## Tooling (installed 2026-09-12 — use it, do not re-derive it)
- **TypeScript language server** (`typescript-lsp` plugin, global `typescript-language-server@6.0.0`
  + `typescript@5.9.3`, matching the repo pin). Use the `LSP` tool — `findReferences`,
  `goToDefinition`, `hover`, `documentSymbol`, `incomingCalls` — for every TS/TSX symbol instead of
  `grep`. It resolves across `@devon/*` package boundaries (`packages/contracts` → `apps/api` →
  `apps/web`), so a contract change enumerates real call sites rather than string matches. Zero token
  cost: the server runs out of process.
- **`frontend-design` skill** — fires automatically on UI work. Craft only; precedence is
  `DESIGN.md` > the epic's spec > the skill. See the Tooling section in `wp-designer.md` / `wp-ui.md`
  for exactly what to take from it and what to ignore.
- **`mcp__chrome-devtools__*`** — performance traces, `lighthouse_audit`, CPU/network `emulate`.
  Use it for every HARDENING web-vitals item: measure, never describe. `wp-qa-visual`, `wp-scout` and
  `wp-a11y-i18n` are wired to it.
- **`mcp__playwright__*`** — deterministic, replayable browser capture for evidence that must be
  identical every cycle, and for sequences that belong in `e2e/`. Runs `--isolated`, so parallel
  worktrees do not fight over a browser profile.
- **`higgsfield-video-explainer` skill** (`.claude/skills/`, CLI `@higgsfield/cli@1.1.24` global) — narrated
  explainer video built from 10-second blocks, for the management/intro demo only. Needs `higgsfield
  auth login` (browser OAuth, paid credits). It uploads prompts and any supplied frames to
  Higgsfield's cloud, so use invented or already-public demo data, never a real department's screen.
  The other eight higgsfield skills (brandkit, product shots, games, websites, thumbnails, soul-id,
  cards, generate) are deliberately not installed — irrelevant here and pure context cost.
- **Registered but deliberately disabled** in `.claude/settings.json`: `semgrep@semgrep-marketplace`
  (authenticates to `semgrep.dev` and uploads scanned code — an unresolved data-egress question for a
  government codebase) and `security-guidance@claude-plugins-official` (adds `Stop` + `SubagentStop`
  LLM review hooks on top of the four hooks here, one per subagent in a blitz run). Do not enable
  either without filing an escalation first.
- Agents are defined **twice**: `plugins/wp-agentic/agents/*.md` (loaded by workflows, which address
  them as `wp-agentic:wp-ui`) and `.claude/agents/*.md` (shadows bare names). Change the plugin copy
  and copy it across, or the two drift silently.
- The CLI is installed (`@anthropic-ai/claude-code`). `claude plugin list`, `claude plugin details
  <name>` and `claude mcp list` answer plugin/MCP questions deterministically — do not guess.

## Commands
```bash
node agentic/scripts/selftest.mjs                     # guards + scripts behave
node agentic/scripts/gate.mjs --profile fast          # typecheck, lint, unit, i18n, secrets
node agentic/scripts/backlog.mjs list --status ready  # what will run next
node agentic/scripts/ledger.mjs summary               # what happened
node agentic/scripts/dod.mjs --epic EPIC-000          # is it done
```

## Do not
- Do not add scope mid-epic; file it as `proposed` in the backlog.
- Do not ask the human in chat from inside a workflow; write an escalation file.
- Do not report "gates green" while any gate is `skipped`.
- Do not read `.env`; use `.env.example`. Do not send personal contact details to Telegram. Do not
  call any AI endpoint other than the configured GLM.
