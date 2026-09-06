# Devon (WorkPortal)

Internal team and work tracking platform for a department of the Ministry of Digital Technologies of
Uzbekistan, built to spread to other ministries: a first-time civil servant understands it without
training, a director gets more from it than from Jira, and it feels good enough to show a friend in
another ministry. Tasks, projects, boards, people, requests, events, onboarding, an inbox, a Telegram
bot, and AI that removes clicks. Not an office suite.

## Read in this order

1. [docs/03-plan/FEATURE-PLAN.md](docs/03-plan/FEATURE-PLAN.md) — what we build and refuse, in four
   paragraphs, plus object model, phases, signature interactions, open decisions.
2. [docs/03-plan/TECH-SPEC.md](docs/03-plan/TECH-SPEC.md) — the technical design: architecture,
   versions, data model, API, authorisation, frontend, design system, AI layer, notifications,
   security, gates, deployment, delivery plan.
3. [DESIGN.md](DESIGN.md) — design system: tokens, type, motion, components, states, copy rules.
4. [docs/03-plan/backlog.json](docs/03-plan/backlog.json) — 25 epics; only `ready` ones run.
5. [docs/01-research/README.md](docs/01-research/README.md) — index of the research reports.
6. [docs/00-reference/reference-site-audit.md](docs/00-reference/reference-site-audit.md) — the
   supervisor's prototype, section by section.
7. [agentic/README.md](agentic/README.md) — the autonomous delivery loop;
   [plugins/wp-agentic/README.md](plugins/wp-agentic/README.md) — the same system as an installable
   Claude Code plugin.

## Getting started (I-18: one command from a fresh clone)

Prerequisites: [Docker](https://docs.docker.com/get-docker/) (Compose v2) and Node ≥ 22.11. Nothing
else -- pnpm itself is provisioned for you.

```bash
git clone <this repo> && cd WorkPortal
cp .env.example .env        # the only manual step; edit values only if you need non-default ports
```

Then run **either** of these two equally valid first commands -- pick whichever matches what is
already on your machine:

```bash
corepack enable && pnpm setup    # machine already has a package-manager shim (npm/pnpm/corepack)
# -- or --
node setup.mjs                   # machine has only Node; this shells corepack itself
```

Both run the same script (`setup.mjs`): it checks your Node version, activates the exact pnpm version
pinned in `package.json#packageManager` via corepack, runs `pnpm install`, copies `.env.example` to
`.env` if you skipped the step above, and checks that Docker is on your PATH.

Then boot the app:

```bash
pnpm start --demo
```

This brings up Postgres 17 and Valkey (Docker), applies migrations, starts the API and web app, and
seeds the demo tenant (super admin + departments + people + boards + events, with realistic Uzbek
names -- TECH-SPEC §14). It prints the URL to open (`http://localhost:5173` by default) once the app
is reachable; the header shows a **Namoyish / Demo** chip so nobody mistakes the demo tenant for a
real one. `pnpm start` (without `--demo`) boots the same stack against whatever is already in the
database, with no seeding and no demo chip. `pnpm dev` is an alias for `pnpm start`.

The demo seed is idempotent: running `pnpm start --demo` a second time against the same database
changes no row counts and exits 0 (ADR-013) -- safe to re-run any time you are unsure what state your
local database is in.

To reset: `pnpm --filter @devon/db seed:reset --demo` removes only the demo rows (refuses under
`NODE_ENV=production`).

### Security scan (`pnpm run security:scan`)

Not part of `pnpm setup`/`pnpm start` and not required for local development. It runs Semgrep (OWASP
Top Ten ruleset) and Trivy (filesystem vuln + secret scan) and is wired into CI's `integration` and
`release` gate profiles, which install both tools before running it (`.github/workflows/ci.yml`). If
you want to run it locally, install `semgrep` and `trivy` yourself first.

## Layout

```
docs/00-reference   reference-site-audit.md
docs/01-research    24 research reports (+ competitive-matrix.md, README.md index)
docs/02-synthesis   (vision drafts land here when that stage is run)
docs/03-plan        FEATURE-PLAN.md, TECH-SPEC.md, backlog.json (+schema)
docs/04-escalations one-question escalations written by the loop      docs/adr  decisions
agentic/            PROTOCOL.md, ROSTER.md, INVARIANTS.md, gates.json, scripts/, hooks/, templates/, ledger/
plugins/            wp-agentic plugin + local marketplace (.claude-plugin/marketplace.json)
.claude/            settings.json (permissions, hooks, plugin registration), agents/, workflows/ (project copies)
DESIGN.md           design system spec
```

## The delivery system

The `wp-agentic` plugin is registered at user scope (`~/.claude/settings.json`) and project scope
(`.claude/settings.json`) from `plugins/`. In a new Claude Code session:

- `/wp-agentic:status` — where are we
- `/wp-agentic:ship` — ship the next ready epics (bounded loop, escalation files, never stalls)
- `/wp-agentic:feature-cycle EPIC-000` — one epic
- `/wp-agentic:review-sweep`, `/wp-agentic:polish-sweep`, `/wp-agentic:escalations`

If the plugin is not listed by `/plugin list`, install it from the local marketplace:
`/plugin marketplace add C:/Users/rpwal/Documents/Work/eGov/WorkPortal/plugins` then
`/plugin install wp-agentic@workportal-local`. The project's own `.claude/agents` and
`.claude/workflows` are equivalent fallbacks (`Workflow({ name: "ship" })`).

Before the first ship run: answer the decisions in TECH-SPEC §19 (or accept the defaults), make sure
`agentic/.unlock` is absent, and run `node agentic/scripts/selftest.mjs`.
