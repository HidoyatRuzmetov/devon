# The WorkPortal delivery system

An agentic, end-to-end loop that takes epics from a backlog and returns shipped, verified increments,
without stalemates. This folder is the system; `.claude/agents/` and `.claude/workflows/` are its
executable parts.

```
 backlog.json ──► ship.js ──► feature-cycle.js (per epic)
                                │
                                ├─ Spec        wp-pm        → ac.md (frozen criteria + disproofs, class A/B/C)
                                ├─ Design      wp-architect → design.md (+ADR)   wp-designer → spec.md (+screenshot manifest)
                                ├─ Decompose   wp-lead      → items.json, items/*.md (TOUCHES / DOES NOT / handoff)
                                ├─ Build       per item, waves by dependency:
                                │     maker (wp-backend|frontend|ui|devops)
                                │     ► gate.mjs --profile item     (red → maker retries ≤2 → else escalate)
                                │     ► diff-guard --touches         (violations → fix once → else revert)
                                │     ► commit
                                │     ► wp-reviewer (+wp-security if C) → fingerprinted findings
                                │        blocking? → wp-fixer (≤3 rounds, same-fingerprints ⇒ stop) → diff-guard --forbid fixer → gates
                                │     item ends VERIFIED | BLOCKED-ESCALATED
                                ├─ Integrate   gate.mjs --profile integration (fixer ≤2 → else escalate)
                                ├─ Verify      wp-qa ∥ wp-qa-visual ∥ wp-a11y-i18n ∥ wp-security(C)
                                ├─ Adjudicate  wp-pm → adjudication.json (AC → evidence; NO-EVIDENCE = FAIL)
                                │              FAIL → epic fix round (≤2, non-convergence ⇒ escalate) → re-verify
                                ├─ Ship        dod.mjs → wp-release (release gates, version, CHANGELOG uz/ru/en, tag, deploy+smoke, ledger)
                                └─ Scout       wp-scout → proposals appended to backlog (status: proposed)
```

## Why it cannot stall

| Failure mode | Defence |
|---|---|
| "One more thing" redo loops | Criteria freeze before code (§2). New wants → backlog `proposed`, never mid-cycle. |
| Reviewer and fixer ping-pong | Findings need REPRO + fingerprint; closed fingerprints cannot be re-raised; identical finding sets across rounds stop the loop (§4, §5). |
| Infinite retries | Numeric caps everywhere: 3 fix rounds/item, 2 epic rounds, 2 gate attempts (§11). |
| Waiting for the human | Escalation = one question + safe default in a file; the loop continues with other items (§7). |
| Agents gaming the checks | Tests/gates/invariants/hooks are protected; fixer's forbidden edits are reverted deterministically; `stop-gate` refuses "done" while fast gates are red (§3, §8). |
| "Looks done" syndrome | PASS needs evidence from a verifier or a gate; makers' claims are not evidence; NO-EVIDENCE = FAIL (§6). |
| Silent skips | `gate.mjs` reports skipped gates loudly and DoD refuses them; `NOT-SCOPE` is mandatory in reports. |
| Memory loss between cycles | JSONL ledgers for cycles and findings; repeated findings become invariants (§9). |
| Cost blow-ups | Model tiers per role (§12); `ship` keeps a token reserve and a per-run epic cap. |

## Files

| Path | Purpose |
|---|---|
| `PROTOCOL.md` | Binding rules (§0–§13). Every agent reads it first. |
| `ROSTER.md` | 16 agents, tools, models, change classes. |
| `INVARIANTS.md` | 20 truths every commit keeps (tenancy, privacy, permissions, product, engineering). |
| `gates.json` | Gate commands, profiles, limits, protected paths, fixer-forbidden globs. |
| `scripts/gate.mjs` | Runs a gate profile, writes `ledger/last-gate.json`, exit 0/1. |
| `scripts/diff-guard.mjs` | Scope guard: TOUCHES, fixer-forbidden, protected; `--revert`. |
| `scripts/ledger.mjs` | Cycles/findings JSONL, fingerprints, close, summary. |
| `scripts/dod.mjs` | Definition-of-Done checker (10 items) → exit 0/1. |
| `scripts/backlog.mjs` | list / next / get / set-status / add / validate over `docs/03-plan/backlog.json`. |
| `scripts/check-i18n.mjs`, `check-secrets.mjs`, `check-bundle.mjs` | Gate implementations. |
| `hooks/guard-edit.mjs`, `guard-bash.mjs`, `post-edit-format.mjs`, `stop-gate.mjs` | Wired in `.claude/settings.json`. |
| `templates/` | acceptance-criteria, work-item, adr, verification-report, escalation. |
| `ledger/` | `cycles.jsonl`, `findings.jsonl`, `last-gate.json`, `cycles/<EPIC>/…`, `run-summary.md`. |

## Running it

```bash
# 1. make sure the backlog has ready epics with outcomes
node agentic/scripts/backlog.mjs list --status ready
# 2. in Claude Code (this repo), with the timestamp passed in because workflow scripts cannot read the clock:
#    Workflow({ name: "ship", args: { max: 3, ts: "2026-09-05T09:00:00+05:00" } })
# 3. read what happened
cat agentic/ledger/run-summary.md
ls docs/04-escalations/
```

One epic only: `Workflow({ name: "feature-cycle", args: { epic: "EPIC-012", ts: "…" } })`.
Bug hunt: `Workflow({ name: "review-sweep", args: { scope: "apps/api", fix: true } })`.
Polish: `Workflow({ name: "polish-sweep", args: { maxFixes: 8 } })`.

## Tuning knobs
`gates.json → limits` (round caps, coverage, bundle budget, widths), `ROSTER.md` (models), the
`RESERVE` constant in `ship.js`, `args.parallel` for worktree-parallel builds (off by default; the
merge step is the least battle-tested part of the loop).

## Known limits (honest)
- Workflow scripts cannot touch the filesystem, so a cheap `haiku` runner executes scripts and
  persists read-only roles' output. The authoritative record is always the file the script wrote
  (`last-gate.json`, ledgers), not the runner's words.
- Hooks in `.claude/settings.json` took effect immediately in the authoring session (they refused the
  author's own protected-file edit and a test command containing a force-push), but Claude Code may
  snapshot them at startup in other builds: after editing `settings.json`, run
  `node agentic/scripts/selftest.mjs` and, if in doubt, start a new session.
- Guards are disarmed while `agentic/.unlock` exists. Delete it before running `ship`.
- The parallel build path merges worktrees via `wp-devops`; keep it off until the first epics have
  shipped sequentially.
- Gate commands assume the pnpm monorepo layout from `TECH-SPEC.md`; EPIC-000 finalises them.
