# WorkPortal Agent Roster

Sixteen project-scoped agents live in `.claude/agents/wp-*.md`. Names are prefixed `wp-` so they never
collide with user-level agents from other projects. Every agent reads `agentic/PROTOCOL.md` first.

| Agent | Kind | Model | Can edit code | Purpose |
|---|---|---|---|---|
| `wp-pm` | decide | opus | no | Freeze falsifiable acceptance criteria per epic; adjudicate PASS/FAIL/BLOCKED from evidence. The only agent that may accept work. |
| `wp-architect` | decide | opus | no | Contracts, data model, migrations strategy, tenant/permission shape, failure modes, ADRs. |
| `wp-designer` | decide | opus | no | Visual + interaction spec precise enough to build and to check. Owns `DESIGN.md` and design tokens direction. |
| `wp-lead` | decide | sonnet | no | Decompose an epic into ordered work items with `TOUCHES` / `DOES NOT` and handoff contracts. |
| `wp-backend` | make | sonnet | yes | API, domain logic, schema, migrations, jobs, integrations (`apps/api`, `packages/db`). |
| `wp-frontend` | make | sonnet | yes | Client logic: routes, data fetching, state, forms, i18n wiring (`apps/web` logic). |
| `wp-ui` | make | sonnet | yes | Visual layer: components, layout, motion, responsive, accessibility, against the designer's spec. |
| `wp-devops` | make | sonnet | yes | Docker/Compose, CI, migrations tooling, env/secrets wiring, backups, deploy scripts. |
| `wp-fixer` | make | sonnet | yes (not tests/gates) | Applies review findings only. Scope = the findings. Cannot touch tests or gates (hook-enforced). |
| `wp-reviewer` | verify | sonnet | no | Independent code review: correctness, contracts, error paths, tenant scoping, scope discipline. |
| `wp-security` | verify | opus | no | Adversarial: auth, tenant isolation, privacy tiers, injection, secrets, audit completeness. |
| `wp-qa` | verify | sonnet | no | Runs the system: tests, endpoints, edge cases, failure paths. Evidence = pasted output. |
| `wp-qa-visual` | verify | sonnet | no | Drives the running UI in the browser: screenshots at 3 widths × light/dark × uz/ru; forces empty/error states. |
| `wp-a11y-i18n` | verify | sonnet | no | Keyboard-only walkthrough, axe results, screen-reader labels, Uzbek/Russian string quality and plural forms. |
| `wp-scout` | verify | sonnet | no | End-of-epic "what is broken, ugly, confusing, missing that nobody asked about". Files backlog items. |
| `wp-release` | make | sonnet | yes (release files only) | Version, changelog, ledger, demo seed refresh, deploy + smoke test. |

## Tool allowlists (enforced by frontmatter `tools:`)

- decide roles: `Read, Grep, Glob, Bash, WebSearch, WebFetch` (Bash for `git log`, `ls`, gate reads only)
- make roles: `Read, Write, Edit, Grep, Glob, Bash`
- verify roles: `Read, Grep, Glob, Bash` (+ browser tools for `wp-qa-visual` and `wp-a11y-i18n`)

## Who calls whom

Agents never call each other. Workflows in `.claude/workflows/` sequence them; the main session (or the
`ship` workflow) is the only orchestrator. This keeps the call graph a tree, which is what makes the loop
bounded and auditable.

## Class of change (set by `wp-pm`, drives which verifiers run)

- **A**: copy, styling, isolated UI with no data change → reviewer + qa-visual
- **B**: feature touching data or contracts → + architect (design) + qa + a11y-i18n
- **C**: auth, permissions, tenant scoping, personal data, migrations that drop/alter, deploy config,
  integrations with national systems → + security (mandatory), and `wp-pm` requires an ADR

When torn between B and C, choose C.
