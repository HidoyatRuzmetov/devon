export const meta = {
  name: 'ship',
  description: 'Master delivery loop: takes the next ready epic from docs/03-plan/backlog.json and runs feature-cycle on it, repeatedly, until the backlog has no ready epics, the per-run cap is reached, or the token budget is nearly spent. Writes agentic/ledger/run-summary.md. Never blocks on a human: escalations are files.',
  whenToUse: 'Run to ship the product autonomously. args: {max: 5, ts: "<ISO timestamp>", parallel: false}.',
  phases: [
    { title: 'Loop', detail: 'next ready epic → feature-cycle → status' },
    { title: 'Summary', detail: 'ledger summary + open escalations' },
  ],
}

const MAX = (args && args.max) || 5
const TS = (args && args.ts) || 'unstamped'
const RESERVE = 400_000 // tokens kept back so a cycle never dies mid-flight

const tiny = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
const run = (cmd, schema, label, extract) => agent(`Run this exact command from the repository root with Bash and wait for it:\n\n${cmd}\n\n${extract || 'Return the JSON it printed as the structured output, verbatim.'}`, { label, phase: 'Loop', model: 'haiku', effort: 'low', agentType: 'general-purpose', schema })
const NEXT_SCHEMA = { type: 'object', properties: { epic_id: { type: 'string' }, title: { type: 'string' }, waiting_on_deps: { type: 'array', items: { type: 'string' } }, in_progress: { type: 'array', items: { type: 'string' } } }, required: ['epic_id', 'waiting_on_deps', 'in_progress'] }

phase('Loop')
const results = []
let stopReason = 'backlog empty'
for (let i = 0; i < MAX; i++) {
  if (budget.total && budget.remaining() < RESERVE) { stopReason = `budget reserve reached (${Math.round(budget.remaining() / 1000)}k left)`; break }
  const nxt = await run('node agentic/scripts/backlog.mjs next --json', NEXT_SCHEMA, `next:${i + 1}`, 'Return epic_id (the epic.id, or "" if epic is null), title, waiting_on_deps, in_progress.')
  if (!nxt || !nxt.epic_id) { if (nxt && nxt.waiting_on_deps.length) stopReason = `no runnable epic; waiting on deps for ${nxt.waiting_on_deps.join(', ')}`; if (nxt && nxt.in_progress.length) stopReason += `; in-progress (crashed earlier?): ${nxt.in_progress.join(', ')}`; break }
  log(`ship: epic ${i + 1}/${MAX} → ${nxt.epic_id} ${nxt.title}`)
  await run(`node agentic/scripts/backlog.mjs set-status ${nxt.epic_id} in-progress --note "ship run ${TS}"`, tiny, `status:${nxt.epic_id}`)
  let r = null
  try { r = await workflow('feature-cycle', { epic: nxt.epic_id, ts: TS, parallel: !!(args && args.parallel) }) }
  catch (e) { log(`ship: feature-cycle threw for ${nxt.epic_id}: ${String(e && e.message || e).slice(0, 300)}`); await run(`node agentic/scripts/backlog.mjs set-status ${nxt.epic_id} blocked --note "feature-cycle crashed: ${String(e && e.message || e).replace(/"/g, "'").slice(0, 200)}"`, tiny, `crash:${nxt.epic_id}`) }
  results.push({ epic: nxt.epic_id, verdict: r ? r.verdict : 'CRASHED', escalations: r ? r.escalations.length : 0, release: r && r.release && r.release.status })
  if (r && r.verdict !== 'PASS') log(`ship: ${nxt.epic_id} ended ${r.verdict} with ${r.escalations.length} escalation(s); continuing with the next runnable epic`)
}
if (results.length >= MAX) stopReason = `per-run cap of ${MAX} epics reached`

phase('Summary')
const summary = await agent(`Produce agentic/ledger/run-summary.md for ship run ${TS}. Run: node agentic/scripts/ledger.mjs summary; node agentic/scripts/backlog.mjs list; and list docs/04-escalations/*.md whose Status is OPEN (read each, quote the one question). Results this run: ${JSON.stringify(results)}. Stop reason: ${stopReason}. Write the file with: a 5-line status for the human (what shipped, what is blocked, what needs an answer), the table from ledger summary, the open escalations with their questions and defaults, and the next three ready epics. Return {"ok":true}.`, { label: 'run-summary', phase: 'Summary', model: 'sonnet', effort: 'low', agentType: 'general-purpose', schema: tiny })
log(`ship: done. ${results.filter(r => r.verdict === 'PASS').length}/${results.length} epics PASS. Stop reason: ${stopReason}. See agentic/ledger/run-summary.md`)
return { results, stopReason, summaryWritten: !!(summary && summary.ok) }
