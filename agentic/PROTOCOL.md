# WorkPortal Agentic Delivery Protocol

This document is binding for every agent in `.claude/agents/` and every workflow in `.claude/workflows/`.
It exists to make one thing true: **the loop always terminates in a shipped, verified increment or a
precise, single-question escalation. Never in a stalemate.**

---

## §0 The one-sentence model

`Backlog epic → frozen acceptance criteria → design → work items → (implement → deterministic gates →
review → bounded fix) per item → integration gates → QA → adjudicate against the frozen criteria →
ship + ledger → next epic.`

Humans are consulted **only** through the escalation file (§7), and the loop keeps moving on the
other items while it waits.

---

## §1 Roles and the two walls

There are two walls that are never crossed:

1. **Makers do not verify their own work.** `wp-backend`, `wp-frontend`, `wp-ui`, `wp-devops`,
   `wp-fixer` implement. They may run tests to see if they are done. Their opinion that it works is not
   evidence.
2. **Verifiers cannot edit code.** `wp-reviewer`, `wp-security`, `wp-qa`, `wp-qa-visual`,
   `wp-a11y-i18n`, `wp-scout` have no `Edit`/`Write`. They produce findings with evidence. A verifier
   who could fix things would stop recording them.

Decision roles: `wp-pm` freezes acceptance criteria and adjudicates; `wp-architect` decides contracts
and data shapes; `wp-lead` decomposes and sequences; `wp-designer` writes visual specs.
`wp-release` ships and records.

Roles are defined in `agentic/ROSTER.md`.

---

## §2 Acceptance criteria are frozen before code

Every epic gets numbered criteria **before** any implementation begins. Each criterion must carry its
**disproof**: the concrete observation that would show it is not met.

```
AC-3  A specialist can request leave from the "Request" button in ≤ 3 clicks and sees their remaining balance before submitting
      DISPROOF: any path from Home → submitted request that takes > 3 clicks, or a submit screen with no balance shown
```

Rules:
- Criteria are written by `wp-pm` from the epic in `docs/03-plan/backlog.json` and the plan.
- Once `BUILD` starts, criteria **freeze**. A change is allowed only by logging
  `AC-CHANGE: <id> | <old> → <new> | <reason>` in the cycle ledger and re-running verification for it.
- **Loosening a criterion to make a build pass is forbidden.** If a criterion is wrong, change it on the
  record with a reason, never quietly.
- New wants discovered mid-cycle are **not** new criteria. They become new backlog items
  (`docs/03-plan/backlog.json`, status `proposed`). This is the main defence against scope creep and
  against the "one more thing" redo loop.

---

## §3 Deterministic gates decide most of it

Model opinions are the weakest evidence in this system. Scripts are the strongest.
`agentic/scripts/gate.mjs` runs the gates declared in `agentic/gates.json` and writes
`agentic/ledger/last-gate.json`:

| Gate | What | Blocking |
|---|---|---|
| `typecheck` | `tsc --noEmit` across the monorepo | yes |
| `lint` | eslint + prettier check | yes |
| `unit` | vitest, with coverage threshold from `gates.json` | yes |
| `build` | production build of every app | yes |
| `migrate` | migrations apply cleanly on an empty DB, then again (idempotence) | yes |
| `e2e` | Playwright suite (smoke tag on item level, full on integration) | yes |
| `a11y` | axe on every route in `e2e/routes.json`, zero serious/critical | yes |
| `i18n` | every `t()` key exists in `uz`, `ru`, `en`; no hard-coded UI strings in `apps/web` | yes |
| `bundle` | main bundle under the budget in `gates.json` | yes |
| `secrets` | no secrets / private keys in the tree | yes |
| `deps` | `npm audit --audit-level=high` clean, licence allowlist | warn → blocking on release |

A gate that fails is a fact, not a finding. The maker fixes it before any reviewer is spawned.
**No reviewer is ever asked to judge code that does not pass the gates.** This alone removes most
redo cycles.

Gates are **never** weakened by an agent. `gates.json` and the test files that gates depend on are
protected by the hooks in `.claude/settings.json` (§8). If a gate is genuinely wrong, that is an
escalation (§7), not an edit.

---

## §4 Findings: the only currency verifiers deal in

A finding has this shape and nothing less:

```
SEV2 | apps/web/src/routes/leave/request.tsx:88 | balance shown after submit, not before
     | AC: AC-3
     | REPRO: open /leave/new as demo specialist → balance card renders only on the confirmation step
     | EVIDENCE: screenshot ledger/cycles/<cycle>/qa-visual/leave-new.png
```

Severity is fixed vocabulary:
- **SEV1**: data loss, security/tenant/privacy breach, crash on a core path, an AC disproved.
  Blocks acceptance.
- **SEV2**: a user-visible defect on a core path with a reproduction. Blocks acceptance.
- **SEV3**: defect on an edge path, or a maintainability problem with a concrete cost. Does **not**
  block; goes to backlog as `tech-debt` with the finding attached.
- **NIT**: style, preference, wording. Never blocks. Never argued. Recorded, not fixed in-cycle.

Rules that keep the loop honest:
- A finding **without a reproduction path or evidence is an observation** and is automatically NIT.
  Reviewers may not inflate.
- A finding must reference an AC or an invariant from `agentic/INVARIANTS.md`. "I would have done it
  differently" is not a finding.
- Findings are fingerprinted (`file + normalised summary`). Fingerprints live in the cycle ledger.
  A finding closed as `WONTFIX-BY-DECISION` or `ACCEPTED-DEBT` **cannot be re-raised** in the same
  epic. This is the second defence against redo loops.
- A verifier that finds nothing on a non-trivial change must list **three specific things it tried to
  break**. "Looks clean" is a void report and is discarded.

---

## §5 The bounded fix loop

Per work item, after gates pass:

```
round = 0
loop:
  findings = review(item)                       # wp-reviewer (+ wp-security if item is class C)
  blocking = findings where SEV1|SEV2 and fingerprint not closed
  if blocking is empty → item VERIFIED, exit
  round += 1
  if round > MAX_FIX_ROUNDS (3) → escalate(item, findings), mark item BLOCKED-ESCALATED, exit
  if fingerprints(blocking) == fingerprints(previous round's blocking) → escalate as NO-CONVERGENCE, exit
  wp-fixer fixes ONLY the blocking findings (scope = the findings, nothing else)
  gates must pass again, else the fixer keeps going (its own inner cap: 2 gate attempts)
```

Three hard stops: round cap, non-convergence, gate exhaustion. A work item can therefore end in exactly
one of `VERIFIED`, `BLOCKED-ESCALATED`. There is no third state and no "try again" without a change.

The fixer never touches tests to make them pass, never deletes a failing test, never widens a gate.
Hooks enforce this (§8); the reviewer double-checks the diff of the fix against the findings.

---

## §6 Adjudication is mechanical

`wp-pm` builds the criterion → evidence map. Every AC gets exactly one row:

```
AC-1 | PASS | gate:e2e leave.spec.ts "request in 3 clicks" + qa-visual: leave-new.png
AC-2 | PASS | gate:unit balance.test.ts + reviewer: DIFF apps/api/src/leave/balance.ts:41
AC-3 | FAIL | qa: REPRO … | SEV2 #f3a9
AC-4 | NO-EVIDENCE → FAIL
```

Rules:
- PASS needs evidence produced by a **verifier or a gate**, never by the maker.
- NO-EVIDENCE is FAIL. Absence is not a pass.
- The verdict is `PASS` (all AC pass, no open SEV1/2), `FAIL` (returns to §5 for the items named, with
  the epic-level round counter, max 2 epic-level rounds), or `BLOCKED` (escalated).
- `wp-pm` cannot add criteria at adjudication. It may only judge the frozen ones. Anything it wishes had
  been a criterion becomes a `proposed` backlog item.

An epic that ends `PASS` is shipped by `wp-release`: version bump, changelog entry, ledger entry,
demo data refreshed, and, if a deploy target is configured, deployed and smoke-tested.

---

## §7 Escalation: one question, a safe default, and the loop keeps moving

Agents never ask the human in chat. They write to `docs/04-escalations/<date>-<slug>.md` using
`agentic/templates/escalation.md`:

- **one** precise question,
- the **default we will proceed with** if unanswered,
- the evidence,
- what changes if the answer is different.

Then the loop proceeds with the default on everything that can safely proceed, marks what cannot as
`BLOCKED-ESCALATED`, and continues with the next item/epic. The human answers escalations in batches
(they can also answer inline in chat; `wp-pm` then updates the file and the backlog).

What qualifies for escalation: a contradiction between two frozen criteria; a legal/policy fact that
cannot be established (e.g. is OneID available); a decision that materially changes the data model; a
non-converging fix loop; a gate that is wrong. What does **not** qualify: taste, naming, which
library, how to phrase a label. Those are decided by the role that owns them and recorded as an ADR
or in the ledger.

---

## §8 Hooks: the things agents physically cannot do

`.claude/settings.json` wires `agentic/hooks/*.mjs`:

- `guard-edit.mjs` (PreToolUse on Edit/Write/MultiEdit): blocks edits to `agentic/gates.json`,
  `agentic/INVARIANTS.md`, `agentic/PROTOCOL.md`, hooks, `.claude/settings.json`, applied (git-tracked)
  migration files, any path outside the repo, and `*.test.*` / `*.spec.*` / e2e / migrations when
  `WP_ROLE=wp-fixer` is set. Because workflows cannot set env per agent, the fixer restriction is
  enforced deterministically by the workflow itself: after every fixer run,
  `agentic/scripts/diff-guard.mjs --forbid fixer --revert` restores any forbidden file. The human can
  disarm the guards for a manual session by creating the empty file `agentic/.unlock` (delete it to
  re-arm). `node agentic/scripts/selftest.mjs` proves the guards and scripts behave.
- `guard-bash.mjs` (PreToolUse on Bash): blocks `git push --force`, `rm -rf` outside the scratchpad,
  `git reset --hard`, `git checkout -- .`, dropping databases, editing `.env` with secrets.
- `post-edit-format.mjs` (PostToolUse on Edit/Write): runs prettier on the touched file so lint noise
  never becomes a "finding".
- `stop-gate.mjs` (Stop): when a maker agent finishes, it runs the fast gates (`typecheck`, `lint`,
  `unit` for touched packages) and, if they fail, returns the failures so the maker keeps going instead
  of reporting "done".

Hooks are guardrails, not judges. They never ask for permission; they either allow or refuse with a
reason.

---

## §9 Ledger: memory across cycles

`agentic/ledger/cycles.jsonl`: one line per epic cycle: epic id, ACs, verdict, rounds used,
findings (with fingerprints and closure), gates timing, escalations, cost. `agentic/ledger/findings.jsonl`:
every finding ever raised, with status. `agentic/scripts/ledger.mjs` appends/queries.

Before starting an epic, `wp-lead` reads the last 5 cycles for that area. Repeated findings become
invariants (`agentic/INVARIANTS.md`), repeated escalations become decisions in `docs/adr/`.

---

## §10 Definition of Done (per epic)

An epic is done when **all** of the following are true, and `agentic/scripts/dod.mjs` says so:

1. Every AC is `PASS` with verifier/gate evidence.
2. All gates green on the integrated branch.
3. No open SEV1/SEV2; SEV3s filed as backlog items.
4. Visual QA screenshots exist for every new/changed route at 1440, 1024, 390 widths, light and dark,
   `uz` and `ru`.
5. Empty, loading, error and permission-denied states exist for every new screen (`wp-qa-visual`
   verifies by forcing them).
6. Keyboard-only walkthrough of the primary flow recorded by `wp-a11y-i18n`.
7. Demo tenant seed updated so the feature is visible with realistic Uzbek data on a fresh install.
8. `CHANGELOG.md` entry in plain language (what a civil servant can now do).
9. ADRs written for any contract/schema decision.
10. Ledger entry appended.

---

## §11 Convergence guarantees, stated plainly

- Every loop has a numeric cap (`MAX_FIX_ROUNDS=3` per item, `MAX_EPIC_ROUNDS=2` per epic,
  `MAX_GATE_ATTEMPTS=2` per fix).
- Every loop has a non-convergence detector (identical finding fingerprints → stop).
- Every stop has a next action that is not "ask and wait": proceed with default, or park as
  `BLOCKED-ESCALATED` and continue with the next item.
- No role can both raise and resolve the same finding; no role can both write and pass criteria.
- The backlog is the only place new scope enters; it is never entered during BUILD.
- The master loop (`ship`) ends when the backlog has no `ready` epics or the budget is exhausted, and
  writes `agentic/ledger/run-summary.md` either way.

---

## §12 Model tiers (cost discipline)

Research, critique, review, QA and gap-filling run on **Sonnet**. Taste-heavy synthesis, architecture
and adjudication run on **Opus**. Fable is reserved for the main session (orchestration) and for a
single final "does this hang together" pass per epic. Workflows pass `model:` explicitly; agents never
upgrade themselves.

---

## §13 Tone

Agents write like careful colleagues: short, specific, evidence first, no praise, no hedging, no
apologies. Reports are for the ledger and the next agent, not for the human's feelings.
