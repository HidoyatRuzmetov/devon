export const meta = {
  name: 'merge-branches',
  description: 'Merge a given list of finished side branches into master with gates green after each, e2e smoke and flows re-run, worktrees removed, branches kept. Generic successor of merge-hd.',
  whenToUse: 'When master is quiet and side branches are DONE. args: {branches: ["st/ops-complete", "st/demo-story"], worktrees: ["st-ops-complete", ...], notes}.',
  phases: [{ title: 'Merge', detail: 'given branches, smallest first, gates after each, e2e re-run' }],
}
const ROOT = 'C:/Users/rpwal/Documents/Work/eGov/WorkPortal'
const BR = (args && args.branches) || []
const WTS = (args && args.worktrees) || []
const DONE = { type: 'object', properties: { status: { type: 'string', enum: ['DONE', 'PARTIAL', 'BLOCKED'] }, summary: { type: 'string' }, merged: { type: 'array', items: { type: 'string' } }, gates_green: { type: 'boolean' }, notes: { type: 'string' } }, required: ['status', 'summary'] }
phase('Merge')
const r = await agent(`You are integrating finished side branches into master in ${ROOT} (WorkPortal / Devon: pnpm monorepo; read CLAUDE.md first — tooling requirements: ToolSearch "select:LSP" then the LSP tool for TypeScript symbols; chrome-devtools MCP for browser checks; agentic/INVARIANTS.md never breached; MODULE-GUIDE.md for demo logins). Nobody else edits master while you work.
BRANCHES to merge, in this order: ${BR.join(', ') || '(none given — stop and report BLOCKED)'}. Worktrees to remove afterwards (keep every branch): ${WTS.map(w => `${ROOT}/.claude/worktrees/${w}`).join(', ') || '(none)'}.
For each branch: git merge --no-ff; resolve conflicts keeping both intents (message files: master's key set with the branch's values where the branch changed them; seeds: the branch's story with any fixture master's tests rely on preserved — run the tests to know; docs: union); then pnpm install, node agentic/scripts/gate.mjs --profile fast (nothing skipped), pnpm --filter @devon/db migrate:verify when packages/db changed, and fix root causes before the next branch. Never weaken a test, gate, policy or invariant.
FINISH: fast gates green; pnpm --filter @devon/web build within the bundle budget; pnpm --filter @devon/db test:seed-idempotence if the seed changed; pnpm --filter @devon/web test:e2e (the whole suite, including the @flow specs — if a flow spec fails only because the demo story renamed a fixture, update the spec's fixture reference to the new story, never its assertions); boot pnpm start --demo once and check /healthz plus a login as demo.boshliq and one as demo.xodim, stop your processes; remove the listed worktrees (git worktree remove --force; if Windows file locks block deletion, git worktree prune and leave the folder); commit. Report merged branches, gates_green, anything left in notes.${(args && args.notes) ? ('\nNOTES FROM THE ORCHESTRATOR: ' + args.notes) : ''}`, { label: 'merge:branches', phase: 'Merge', agentType: 'general-purpose', model: 'opus', effort: 'high', schema: DONE })
log(`merge: ${r ? r.status : 'died'} — ${r ? r.summary.slice(0, 300) : ''}`)
return r
