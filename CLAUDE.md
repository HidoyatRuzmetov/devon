# Devon (WorkPortal)

Internal team and work tracking platform for a department of Uzbekistan's Ministry of Digital
Technologies, built to spread across ministries because it is simple for a first-time civil servant,
powerful for a director, and humane. Tasks/projects/boards, people & org, requests, events & team
building, onboarding, inbox, Telegram, AI that removes clicks. Uzbek (Latin) first; Russian and English
complete. Not an office suite, not a document registry.

## Where things are
- `docs/03-plan/FEATURE-PLAN.md` — the product plan (taste rules, refusals, phases).
- `docs/03-plan/TECH-SPEC.md` — the technical design (binding for makers: §1 layout, §1.2 versions,
  §3 data model, §4 API, §5 authorisation, §7 frontend, §9 AI, §10 notifications, §12 gates, §16 coding standards).
- `DESIGN.md` — design tokens, type, motion, components, states, copy rules (binding for wp-ui).
- `docs/03-plan/backlog.json` — the only place scope enters (`node agentic/scripts/backlog.mjs`).
- `docs/01-research/` — 24 verified research reports; cite them. `docs/00-reference/` — the prototype audit.
- `docs/04-escalations/` — one-question escalations; `docs/adr/` — decisions.
- `agentic/` — delivery runtime: `PROTOCOL.md` (binding), `ROSTER.md`, `INVARIANTS.md`, `gates.json`,
  `scripts/`, `hooks/`, `templates/`, `ledger/`.
- `plugins/wp-agentic/` — the delivery system as a plugin (agents `wp-agentic:wp-*`, workflows
  `wp-agentic:ship|feature-cycle|review-sweep|polish-sweep|research-sweep`, skills `/wp-agentic:*`).
  `.claude/agents` and `.claude/workflows` hold equivalent project-local copies as fallback.

## How work happens (summary of `agentic/PROTOCOL.md`)
1. Scope enters only through `backlog.json`. Ready epics carry outcomes; phase 2/3 stay draft.
2. `/wp-agentic:ship` (or `Workflow({name:"wp-agentic:ship", args:{max, ts, pluginRoot}})`) runs
   `feature-cycle` per epic: freeze ACs → design → decompose → build (gates → review → bounded fix) →
   integrate → verify → adjudicate → release → scout.
3. Deterministic gates (`node agentic/scripts/gate.mjs --profile fast|item|integration|release`)
   decide most things; model verdicts only add fingerprinted findings with a REPRO.
4. Loops are bounded (3 fix rounds/item, 2 epic rounds, 2 gate attempts) with non-convergence
   detection. Stalemates become escalation files with a safe default; work continues.
5. Makers never verify their own work; verifiers cannot edit. Tests and gates are never edited to pass.

## Conventions (see TECH-SPEC §16)
- pnpm monorepo: `apps/web`, `apps/api`, `packages/{db,contracts,ui,i18n,ai,config}`, `e2e/`, `infra/`.
- Every table has `tenant_id`; every write emits audit + outbox in one transaction; every endpoint calls
  `can()`; every string through i18n; every screen has empty/loading/error/no-permission states; undo
  over confirm; `Ctrl/⌘+K` reaches everything; no raw colours, tokens only.
- Pin exact versions (TECH-SPEC §1.2). Never edit an applied migration. Never force-push.
- Model tiers: research/review/QA on Sonnet; architecture/design/adjudication/security on Opus;
  haiku runners for scripts and persistence; the orchestrating session on Fable.

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
- Do not read `.env`; use `.env.example`. Do not send restricted data to Telegram or an external AI API.
