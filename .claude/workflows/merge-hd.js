export const meta = {
  name: 'merge-hd',
  description: 'Merge the committed hardening branches (hd/*) and the leftover side-session branches into master with gates green, so the feature work of v1.1 starts from the hardened base.',
  whenToUse: 'Once, after the interrupted hardening-blitz wave. args: {ts}.',
  phases: [{ title: 'Merge', detail: 'tests → ops-tooling → graceful-shutdown → web-perf-a11y → resilience → api-data → security' }],
}
const ROOT = 'C:/Users/rpwal/Documents/Work/eGov/WorkPortal'
const DONE = { type: 'object', properties: { status: { type: 'string', enum: ['DONE', 'PARTIAL', 'BLOCKED'] }, summary: { type: 'string' }, merged: { type: 'array', items: { type: 'string' } }, gates_green: { type: 'boolean' }, notes: { type: 'string' } }, required: ['status', 'summary'] }
phase('Merge')
const r = await agent(`You are integrating hardening work into master in ${ROOT} (Devon / WorkPortal: pnpm monorepo, apps/api Fastify, apps/web Vite+React, packages/*, e2e/, infra/). Binding: agentic/INVARIANTS.md (never breach), agentic/HARDENING.md (item ids), MODULE-GUIDE.md. Nobody else edits master while you work; other agents are READING master and running the demo from a separate worktree, so keep the tree compiling between commits.

BRANCHES, merge in this order (least overlap first), each with git merge --no-ff:
1. hd/tests — FIRST commit its uncommitted work inside the worktree ${ROOT}/.claude/worktrees/hd-tests (git add -A && git commit -m "H25/H30: flow e2e specs and integration tests (wip)"); it contains six @flow Playwright specs and apps/api/test/integration.
2. hd/ops-tooling (production Dockerfiles, compose, scanners, CI). claude/exciting-shaw-5b4f05 is a duplicate of its first commit — verify with git diff and skip it.
3. claude/dazzling-wu-97fed9 (graceful shutdown on SIGTERM/SIGINT).
4. hd/web-perf-a11y
5. hd/resilience-observability
6. hd/api-data
7. hd/security
For each merge: resolve conflicts keeping both intents (plugin registration order: security headers and rate limits before routes; package.json: union of scripts/deps; migrations: renumber so filename order stays unique, then pnpm --filter @devon/db migrate:verify); run pnpm install; run node agentic/scripts/gate.mjs --profile fast and fix what broke at the root cause before the next merge. Never weaken or delete a test, gate, policy or invariant to pass; if the tests branch left failing tests that document real product bugs, fix the product. NOTE on this machine: the fast gate false-reds on Vitest 5 s timeouts when Docker builds or other heavy processes run concurrently — if a red shows only timeouts, re-run once on a quieter moment before touching code.

FINISH: node agentic/scripts/gate.mjs --profile fast green with nothing skipped; pnpm --filter @devon/web build; pnpm --filter @devon/db migrate:verify; pnpm start --demo boots (kill your own processes after checking /healthz and one login as demo.boshliq, password in MODULE-GUIDE.md); merge the evidence files the packages wrote under agentic/ledger/hardening/2026-09-08T06-45-00-05-00/ into ${ROOT}/agentic/ledger/hardening/2026-09-08T06-45-00-05-00/evidence.md (one table: H item → status → evidence → commit; items the packages did not reach are listed as "open"). Remove the hd-* worktrees (git worktree remove --force; if Windows file locks block deletion, git worktree prune and leave the folder) and the two claude/* worktrees; keep all branches. Commit. Return DONE with the merged list, gates_green, and the open H items in notes.`, { label: 'merge:hd', phase: 'Merge', agentType: 'general-purpose', model: 'opus', effort: 'high', schema: DONE })
log(`merge: ${r ? r.status : 'died'} — ${r ? r.summary.slice(0, 300) : ''}`)
return r
