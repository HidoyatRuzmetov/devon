# wp-agentic — the WorkPortal agentic delivery system, as a plugin

A bounded, evidence-gated loop that ships backlog epics end to end and never stalls in approval/redo
cycles. Sixteen role agents, five workflows, four guard hooks, deterministic gate scripts, ledgers,
templates, and a vendoring command that makes any project self-contained.

## Install (user scope, available in every project on this machine)

```bash
claude plugin marketplace add C:/Users/rpwal/Documents/Work/eGov/WorkPortal/plugins
claude plugin install wp-agentic@workportal-local --scope user
claude plugin validate C:/Users/rpwal/Documents/Work/eGov/WorkPortal/plugins/wp-agentic
```
Inside Claude Code the same works as `/plugin marketplace add …`, `/plugin install wp-agentic@workportal-local`.
After editing plugin files run `/reload-plugins`.

## What it contains

| Part | Where | Notes |
|---|---|---|
| Agents | `agents/wp-*.md` | Invoked as `wp-agentic:wp-pm`, `wp-agentic:wp-backend`, … |
| Workflows | `workflows/*.js` | `/wp-agentic:ship`, `feature-cycle`, `review-sweep`, `polish-sweep`, `research-sweep` |
| Hooks | `hooks/hooks.json` + `hooks/*.mjs` | Edit/Bash guards, formatter, stop-gate. They defer to a project's own vendored hooks to avoid double runs. |
| Skills | `skills/*/SKILL.md` | `/wp-agentic:init`, `ship`, `feature-cycle`, `review-sweep`, `polish-sweep`, `research-sweep`, `status`, `escalations` |
| Runtime to vendor | `scaffold/agentic/*`, `scripts/*.mjs` | Copied into a project by `/wp-agentic:init` (PROTOCOL, ROSTER, INVARIANTS, gates.json, templates, scripts, hooks) |

## Using it in a new project

1. `/wp-agentic:init` — vendors `agentic/` and `.claude/settings.json` into the repo.
2. Adjust `agentic/gates.json` commands and `agentic/INVARIANTS.md`.
3. Add epics with `node agentic/scripts/backlog.mjs add '…'` (only `ready` epics with `outcomes` run).
4. `/wp-agentic:ship` (or `feature-cycle EPIC-001`). Read `agentic/ledger/run-summary.md` and
   `docs/04-escalations/` afterwards; answer with `/wp-agentic:escalations`.

## The guarantees (see `scaffold/agentic/PROTOCOL.md`)

Frozen acceptance criteria with disproofs before code; deterministic gates before any reviewer; findings
need a reproduction and a fingerprint; closed fingerprints cannot be re-raised; 3 fix rounds per item,
2 per epic, 2 gate attempts, identical-findings detection; makers never verify, verifiers cannot edit;
escalations are files with a safe default and the loop continues; Definition of Done is a script.

## Model tiers

Research/review/QA on Sonnet, architecture/design/adjudication/security on Opus, haiku runners for
scripts and file persistence. Set in each agent's frontmatter and each workflow's `model:` options.
