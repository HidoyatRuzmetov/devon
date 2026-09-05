export const meta = {
  name: 'feature-cycle',
  description: 'Ship one backlog epic end to end: freeze ACs → design → decompose → build with gates and bounded review/fix loops → verify → adjudicate → release → scout. Terminates in PASS or a single-question escalation, never a stalemate.',
  whenToUse: 'Run for one epic id from docs/03-plan/backlog.json (args: {epic: "EPIC-012"}). The ship workflow calls this per epic.',
  phases: [
    { title: 'Spec', detail: 'wp-pm freezes acceptance criteria and class' },
    { title: 'Design', detail: 'wp-architect (class B/C) + wp-designer (UI) in parallel' },
    { title: 'Decompose', detail: 'wp-lead → ordered work items with TOUCHES' },
    { title: 'Build', detail: 'per item: maker → gates → scope guard → review → bounded fix loop' },
    { title: 'Integrate', detail: 'integration gates on the combined result' },
    { title: 'Verify', detail: 'wp-qa, wp-qa-visual, wp-a11y-i18n, wp-security as class requires' },
    { title: 'Adjudicate', detail: 'wp-pm maps every AC to evidence' },
    { title: 'Ship', detail: 'DoD script → wp-release' },
    { title: 'Scout', detail: 'wp-scout files proposals for the backlog' },
  ],
}

// ---------- configuration ----------
const EPIC = (args && args.epic) || null
if (!EPIC) throw new Error('feature-cycle needs args.epic (e.g. {"epic":"EPIC-012"})')
const RUN_TS = (args && args.ts) || 'unstamped'
const MAX_FIX_ROUNDS = (args && args.maxFixRounds) || 3
const MAX_EPIC_ROUNDS = (args && args.maxEpicRounds) || 2
const MAX_GATE_ATTEMPTS = (args && args.maxGateAttempts) || 2
const CYCLE = `agentic/ledger/cycles/${EPIC}`
const PRE = `Read agentic/PROTOCOL.md first. Epic: ${EPIC}. Cycle folder: ${CYCLE}/. Run timestamp: ${RUN_TS}.`

// ---------- schemas ----------
const AC_SCHEMA = { type: 'object', properties: {
  epic: { type: 'string' }, class: { type: 'string', enum: ['A', 'B', 'C'] }, has_ui: { type: 'boolean' }, area: { type: 'string' },
  criteria: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, disproof: { type: 'string' }, evidence_expected: { type: 'string' } }, required: ['id', 'text', 'disproof'] } },
  markdown: { type: 'string', description: 'the full ac.md content' }, split_recommended: { type: 'boolean' }, notes: { type: 'string' } },
  required: ['epic', 'class', 'has_ui', 'criteria', 'markdown'] }
const TEXT_SCHEMA = { type: 'object', properties: { markdown: { type: 'string' }, summary: { type: 'string' }, adr_markdown: { type: 'string' }, routes: { type: 'array', items: { type: 'string' } } }, required: ['markdown', 'summary'] }
const ITEMS_SCHEMA = { type: 'object', properties: { epic: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, title: { type: 'string' }, owner: { type: 'string', enum: ['wp-backend', 'wp-frontend', 'wp-ui', 'wp-devops'] }, class: { type: 'string' },
  covers: { type: 'array', items: { type: 'string' } }, depends_on: { type: 'array', items: { type: 'string' } }, parallel_safe: { type: 'boolean' },
  touches: { type: 'array', items: { type: 'string' } }, does_not: { type: 'array', items: { type: 'string' } }, handoff: { type: 'string' }, markdown: { type: 'string' } },
  required: ['id', 'title', 'owner', 'covers', 'depends_on', 'touches', 'markdown'] } } }, required: ['epic', 'items'] }
const MAKER_SCHEMA = { type: 'object', properties: { status: { type: 'string', enum: ['DONE', 'BLOCKED'] }, changed: { type: 'array', items: { type: 'string' } }, tests: { type: 'array', items: { type: 'string' } }, handoff: { type: 'string' }, notes: { type: 'string' }, blocked_reason: { type: 'string' }, screens: { type: 'array', items: { type: 'string' } } }, required: ['status'] }
const GATE_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' }, profile: { type: 'string' }, failed: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'string' } }, tail: { type: 'string' } }, required: ['ok', 'failed', 'skipped'] }
const GUARD_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' }, violations: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'violations'] }
const FINDING = { type: 'object', properties: { sev: { type: 'string', enum: ['SEV1', 'SEV2', 'SEV3', 'NIT'] }, path: { type: 'string' }, summary: { type: 'string' }, ac: { type: 'string' }, repro: { type: 'string' }, evidence: { type: 'string' }, fingerprint: { type: 'string' } }, required: ['sev', 'path', 'summary', 'fingerprint'] }
const FINDINGS_SCHEMA = { type: 'object', properties: { findings: { type: 'array', items: FINDING }, tried_to_break: { type: 'array', items: { type: 'string' } }, not_scope: { type: 'array', items: { type: 'string' } }, evidence_for_acs: { type: 'array', items: { type: 'object', properties: { ac: { type: 'string' }, evidence: { type: 'string' } }, required: ['ac', 'evidence'] } }, markdown: { type: 'string' } }, required: ['findings', 'markdown'] }
const FIX_SCHEMA = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { fingerprint: { type: 'string' }, status: { type: 'string', enum: ['FIXED', 'NOT-REPRODUCED', 'TEST-DISPUTED'] }, detail: { type: 'string' } }, required: ['fingerprint', 'status'] } }, gates_green: { type: 'boolean' } }, required: ['results', 'gates_green'] }
const ADJ_SCHEMA = { type: 'object', properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] }, rows: { type: 'array', items: { type: 'object', properties: { ac: { type: 'string' }, verdict: { type: 'string' }, evidence: { type: 'string' }, evidence_source: { type: 'string' } }, required: ['ac', 'verdict'] } }, reopen_items: { type: 'array', items: { type: 'string' } }, blocking_fingerprints: { type: 'array', items: { type: 'string' } }, proposed_backlog: { type: 'array', items: { type: 'string' } }, contract_change: { type: 'boolean' }, demo_seed_updated: { type: 'boolean' }, json: { type: 'string', description: 'adjudication.json content' } }, required: ['verdict', 'rows', 'json'] }
const DOD_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' }, failed_items: { type: 'array', items: { type: 'string' } }, output: { type: 'string' } }, required: ['ok', 'failed_items'] }
const RELEASE_SCHEMA = { type: 'object', properties: { status: { type: 'string', enum: ['RELEASED', 'BLOCKED'] }, version: { type: 'string' }, note: { type: 'string' } }, required: ['status'] }
const SCOUT_SCHEMA = { type: 'object', properties: { proposals: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, persona: { type: 'string' }, evidence: { type: 'string' }, value: { type: 'string' }, complexity: { type: 'string' }, why: { type: 'string' } }, required: ['title', 'why'] } }, summary: { type: 'string' } }, required: ['proposals', 'summary'] }

// ---------- helpers ----------
// scribe: the only way read-only roles get their output persisted. Cheap, literal, no judgement.
const scribe = (path, content, label) => agent(
  `Write EXACTLY the following content to the file "${path}" (create directories as needed; overwrite if it exists). Do not change, summarise or reformat it. Then return {"ok":true}.\n\n<<<CONTENT\n${content}\nCONTENT>>>`,
  { label: `scribe:${label}`, phase: 'Build', model: 'haiku', effort: 'low', agentType: 'general-purpose', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } })
// runner: executes one deterministic command and returns its machine-readable result. Cheap and literal.
const runner = (cmd, schema, label, phase, extract) => agent(
  `Run this exact command from the repository root with Bash and wait for it to finish:\n\n${cmd}\n\n${extract || 'Then return the JSON it printed (or the file it wrote) as the structured output, verbatim. If the command failed to run at all, return ok=false with the error text in tail/output.'}`,
  { label: `run:${label}`, phase, model: 'haiku', effort: 'low', agentType: 'general-purpose', schema })
const gates = (profile, label) => runner(`node agentic/scripts/gate.mjs --profile ${profile} --json`, GATE_SCHEMA, `gates-${profile}:${label}`, 'Build',
  'Then Read agentic/ledger/last-gate.json and return: ok, profile, failed (names), skipped (names), tail (the concatenated tails of failed gates, max 3000 chars). A skipped gate is NOT a pass.')
const guard = (base, touches, forbidFixer, label) => runner(`node agentic/scripts/diff-guard.mjs --since ${base} ${touches ? `--touches "${touches.join(',')}"` : ''} ${forbidFixer ? '--forbid fixer' : ''} --json`, GUARD_SCHEMA, `guard:${label}`, 'Build',
  'Return ok and violations as "file — why" strings.')
const revert = (base, touches, forbidFixer, label) => runner(`node agentic/scripts/diff-guard.mjs --since ${base} ${touches ? `--touches "${touches.join(',')}"` : ''} ${forbidFixer ? '--forbid fixer' : ''} --revert --json`, GUARD_SCHEMA, `revert:${label}`, 'Build', 'Return ok and the violations with their action.')
const headSha = (label) => runner('git rev-parse HEAD', { type: 'object', properties: { sha: { type: 'string' } }, required: ['sha'] }, `head:${label}`, 'Build', 'Return {"sha": "<the 40-char hash>"}. If there is no commit yet, run: git add -A && git commit -q -m "chore: baseline" and then return the new HEAD sha.')
const commit = (msg, label) => runner(`git add -A && git -c user.name="workportal-bot" -c user.email="bot@workportal.local" commit -q -m "${msg.replace(/"/g, '\\"')}" || echo "nothing to commit"`, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, `commit:${label}`, 'Build', 'Return {"ok": true} when the command finished (even if nothing to commit).')
const ledgerFinding = (f, item) => runner(`node agentic/scripts/ledger.mjs append findings '${JSON.stringify({ epic: EPIC, item, sev: f.sev, path: f.path, summary: f.summary, ac: f.ac || '', repro: f.repro || '', evidence: f.evidence || '', fingerprint: f.fingerprint, status: 'open' }).replace(/'/g, "'\\''")}'`, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, `ledger:${f.fingerprint}`, 'Build')
const closedFingerprints = async (label) => { const r = await runner(`node agentic/scripts/ledger.mjs closed ${EPIC}`, { type: 'object', properties: { fingerprints: { type: 'array', items: { type: 'string' } } }, required: ['fingerprints'] }, `closed:${label}`, 'Build', 'Return {"fingerprints": [each line printed]} (empty array if none).'); return new Set((r && r.fingerprints) || []) }
const escalate = async (slug, kind, question, defaultAction, evidence, label) => {
  const content = `# Escalation: ${slug}\n\n- **Date:** ${RUN_TS}\n- **Raised by:** feature-cycle workflow on epic ${EPIC}\n- **Kind:** ${kind}\n- **Status:** OPEN\n\n## The one question\n\n${question}\n\n## Default we are proceeding with\n\n${defaultAction}\n\n## Evidence\n\n${evidence}\n\n## What changes if the answer is different\n\n- Reopen the named item(s) and re-run feature-cycle for ${EPIC}.\n\n## Answer\n\n_(pending)_\n`
  await scribe(`docs/04-escalations/${EPIC}-${slug}.md`, content, `escalation:${label}`)
  escalations.push({ slug, kind, question })
  log(`ESCALATION ${EPIC}/${slug}: ${question}`)
}
const fp = (f) => `${f.sev}:${f.fingerprint}`
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))
const escalations = []

// ---------- Phase: Spec ----------
phase('Spec')
const ac = await agent(`${PRE}\nJob 1 (SPEC). Read docs/03-plan/backlog.json → ${EPIC}, docs/03-plan/FEATURE-PLAN.md and docs/03-plan/TECH-SPEC.md (if present), and node agentic/scripts/ledger.mjs recent <area> 5. Produce the frozen acceptance criteria per agentic/templates/acceptance-criteria.md. Return class, has_ui, area, criteria with disproofs, and the full markdown.`,
  { label: `pm-spec:${EPIC}`, phase: 'Spec', agentType: 'wp-agentic:wp-pm', schema: AC_SCHEMA, effort: 'high' })
if (!ac) throw new Error('wp-pm produced no acceptance criteria')
await scribe(`${CYCLE}/ac.md`, ac.markdown, 'ac')
log(`${EPIC}: ${ac.criteria.length} criteria frozen, class ${ac.class}, ui=${ac.has_ui}${ac.split_recommended ? ' (pm recommends splitting)' : ''}`)
const acText = ac.criteria.map(c => `${c.id}: ${c.text}\n   DISPROOF: ${c.disproof}`).join('\n')

// ---------- Phase: Design ----------
phase('Design')
const designJobs = []
if (ac.class !== 'A') designJobs.push(() => agent(`${PRE}\nProduce the design for this epic per your role. Frozen criteria:\n${acText}\nRead ${CYCLE}/ac.md, docs/03-plan/TECH-SPEC.md, docs/adr/*.md, agentic/INVARIANTS.md. Return markdown (design.md), summary, and adr_markdown if a decision needs an ADR.`,
  { label: `architect:${EPIC}`, phase: 'Design', agentType: 'wp-agentic:wp-architect', schema: TEXT_SCHEMA, effort: 'high' }).then(async r => { if (r) { await scribe(`${CYCLE}/design.md`, r.markdown, 'design'); if (r.adr_markdown) await scribe(`docs/adr/${EPIC}-${RUN_TS.replace(/[^0-9]/g, '').slice(0, 8) || 'adr'}.md`, r.adr_markdown, 'adr') } return r }))
if (ac.has_ui) designJobs.push(() => agent(`${PRE}\nProduce the visual/interaction spec for this epic per your role. Frozen criteria:\n${acText}\nRead ${CYCLE}/ac.md, DESIGN.md, docs/00-reference/reference-site-audit.md. Include the screenshot manifest (routes) and the uz/ru/en copy tables. Return markdown (spec.md), summary, routes.`,
  { label: `designer:${EPIC}`, phase: 'Design', agentType: 'wp-agentic:wp-designer', schema: TEXT_SCHEMA, effort: 'high' }).then(async r => { if (r) await scribe(`${CYCLE}/spec.md`, r.markdown, 'spec'); return r }))
const designs = designJobs.length ? (await parallel(designJobs)).filter(Boolean) : []
const routes = designs.flatMap(d => d.routes || [])

// ---------- Phase: Decompose ----------
phase('Decompose')
const plan = await agent(`${PRE}\nDecompose the epic per your role. Read ${CYCLE}/ac.md${ac.class !== 'A' ? `, ${CYCLE}/design.md` : ''}${ac.has_ui ? `, ${CYCLE}/spec.md` : ''}, docs/03-plan/TECH-SPEC.md. Frozen criteria:\n${acText}\nReturn items.json fields plus each item's markdown (agentic/templates/work-item.md).`,
  { label: `lead:${EPIC}`, phase: 'Decompose', agentType: 'wp-agentic:wp-lead', schema: ITEMS_SCHEMA, effort: 'high' })
if (!plan || !plan.items.length) throw new Error('wp-lead produced no work items')
await scribe(`${CYCLE}/items.json`, JSON.stringify(plan, null, 2), 'items')
for (const it of plan.items) await scribe(`${CYCLE}/items/${it.id}.md`, it.markdown, it.id)
// topological waves; within a wave items run sequentially (safe default) unless args.parallel
const waves = []; const placed = new Set()
while (placed.size < plan.items.length) {
  const wave = plan.items.filter(it => !placed.has(it.id) && (it.depends_on || []).every(d => placed.has(d)))
  if (!wave.length) { log(`WARNING: dependency cycle among ${plan.items.filter(it => !placed.has(it.id)).map(it => it.id).join(', ')}; running them in listed order`); wave.push(...plan.items.filter(it => !placed.has(it.id))) }
  wave.forEach(it => placed.add(it.id)); waves.push(wave)
}
log(`${EPIC}: ${plan.items.length} items in ${waves.length} wave(s)`)

// ---------- Phase: Build ----------
phase('Build')
const itemResults = []
async function buildItem(it) {
  const res = { id: it.id, owner: it.owner, status: 'PENDING', rounds: 0, findings: [], gate_attempts: 0 }
  const base = (await headSha(it.id)).sha
  const itemPrompt = `${PRE}\nWork item ${it.id}: ${it.title}. Read ${CYCLE}/items/${it.id}.md, ${CYCLE}/ac.md${ac.class !== 'A' ? `, ${CYCLE}/design.md` : ''}${ac.has_ui ? `, ${CYCLE}/spec.md` : ''}. TOUCHES: ${it.touches.join(', ')}. DOES NOT: ${(it.does_not || []).join(', ') || '(none listed)'}. Handoff you must honour: ${it.handoff || '(see item)'}. Base commit: ${base}. Implement exactly this item, run the fast gates, run diff-guard with your TOUCHES, and return the envelope.`
  let maker = await agent(itemPrompt, { label: `${it.owner}:${it.id}`, phase: 'Build', agentType: 'wp-agentic:' + it.owner, schema: MAKER_SCHEMA, effort: 'high' })
  if (!maker || maker.status === 'BLOCKED') { res.status = 'BLOCKED-ESCALATED'; await escalate(`${it.id}-blocked`, 'data-model-decision', `Item ${it.id} could not be completed within its TOUCHES: ${(maker && maker.blocked_reason) || 'maker died'}. Should the item's scope be widened as it proposes, or the design changed?`, 'Skipping this item; dependent items still run; epic will not PASS until resolved.', (maker && maker.notes) || '', it.id); return res }
  // gates with bounded retry
  let g = await gates('item', it.id); res.gate_attempts = 1
  while ((!g || !g.ok) && res.gate_attempts < MAX_GATE_ATTEMPTS) {
    maker = await agent(`${itemPrompt}\n\nThe item gates are RED: failed=[${(g && g.failed.join(', ')) || '?'}] skipped=[${(g && g.skipped.join(', ')) || ''}]. Output tail:\n${(g && g.tail) || ''}\nFix the causes (never the tests or gates) and re-run node agentic/scripts/gate.mjs --profile item.`, { label: `${it.owner}:${it.id}:gates${res.gate_attempts + 1}`, phase: 'Build', agentType: 'wp-agentic:' + it.owner, schema: MAKER_SCHEMA, effort: 'high' })
    g = await gates('item', it.id); res.gate_attempts++
  }
  if (!g || !g.ok) { res.status = 'BLOCKED-ESCALATED'; await escalate(`${it.id}-gates`, 'wrong-gate', `Item ${it.id} cannot make gates green after ${res.gate_attempts} attempts (failed: ${(g && g.failed.join(', ')) || '?'}). Is the gate wrong, or is the item mis-scoped?`, 'Reverting nothing; item parked; continuing with other items.', (g && g.tail) || '', it.id); return res }
  // scope guard
  let gd = await guard(base, it.touches, false, it.id)
  if (gd && !gd.ok) {
    await agent(`${itemPrompt}\n\nSCOPE VIOLATIONS (files outside TOUCHES): ${gd.violations.join('; ')}. Move the change inside TOUCHES or drop it. If a file outside TOUCHES is genuinely required, return BLOCKED with the reason.`, { label: `${it.owner}:${it.id}:scope`, phase: 'Build', agentType: 'wp-agentic:' + it.owner, schema: MAKER_SCHEMA, effort: 'medium' })
    gd = await guard(base, it.touches, false, it.id)
    if (gd && !gd.ok) { await revert(base, it.touches, false, it.id); log(`${it.id}: reverted out-of-scope files: ${gd.violations.join('; ')}`); g = await gates('item', it.id); if (!g || !g.ok) { res.status = 'BLOCKED-ESCALATED'; await escalate(`${it.id}-scope`, 'data-model-decision', `Item ${it.id} only works by editing files outside its TOUCHES (${gd.violations.join('; ')}). Widen TOUCHES?`, 'Out-of-scope edits reverted; item parked.', '', it.id); return res } }
  }
  await commit(`${it.id}: ${it.title}`, it.id)
  // bounded review/fix loop (PROTOCOL §5)
  let prevBlocking = []
  const closed = await closedFingerprints(it.id)
  while (true) {
    const reviewers = [() => agent(`${PRE}\nReview work item ${it.id} (${it.title}). Base: ${base}. Read ${CYCLE}/items/${it.id}.md and ${CYCLE}/ac.md. Diff: git diff ${base}. Closed fingerprints you must not re-raise: ${[...closed].join(', ') || 'none'}. Return findings with fingerprints (node agentic/scripts/ledger.mjs fingerprint "<path>" "<summary>"), tried_to_break, not_scope, evidence_for_acs, and the full report markdown.`, { label: `reviewer:${it.id}:r${res.rounds + 1}`, phase: 'Build', agentType: 'wp-agentic:wp-reviewer', schema: FINDINGS_SCHEMA, effort: 'high' })]
    if (ac.class === 'C' || it.class === 'C') reviewers.push(() => agent(`${PRE}\nSecurity review of work item ${it.id} (${it.title}), class C. Base: ${base}. Diff: git diff ${base}. Attack it per your method. Closed fingerprints: ${[...closed].join(', ') || 'none'}. Return findings with fingerprints and the report markdown.`, { label: `security:${it.id}:r${res.rounds + 1}`, phase: 'Build', agentType: 'wp-agentic:wp-security', schema: FINDINGS_SCHEMA, effort: 'high' }))
    const reports = (await parallel(reviewers)).filter(Boolean)
    for (const [i, r] of reports.entries()) await scribe(`${CYCLE}/reviews/${it.id}-r${res.rounds + 1}-${i}.md`, r.markdown, `review:${it.id}`)
    const all = reports.flatMap(r => r.findings || [])
    for (const f of all) { res.findings.push(f); await ledgerFinding(f, it.id) }
    const blocking = all.filter(f => (f.sev === 'SEV1' || f.sev === 'SEV2') && !closed.has(f.fingerprint) && (f.repro || f.evidence))
    const demoted = all.filter(f => (f.sev === 'SEV1' || f.sev === 'SEV2') && !(f.repro || f.evidence)).length
    if (demoted) log(`${it.id}: ${demoted} SEV1/2 finding(s) demoted to NIT for lacking REPRO/EVIDENCE`)
    if (!blocking.length) { res.status = 'VERIFIED'; log(`${it.id}: VERIFIED after ${res.rounds} fix round(s)`); return res }
    res.rounds++
    const keys = blocking.map(fp)
    if (res.rounds > MAX_FIX_ROUNDS) { res.status = 'BLOCKED-ESCALATED'; await escalate(`${it.id}-rounds`, 'no-convergence', `Item ${it.id} still has ${blocking.length} blocking finding(s) after ${MAX_FIX_ROUNDS} fix rounds: ${blocking.map(f => `${f.sev} ${f.path}: ${f.summary}`).join('; ')}. Accept as debt, change the design, or reassign?`, 'Item parked with findings open.', blocking.map(f => f.repro || '').join('\n'), it.id); return res }
    if (sameSet(keys, prevBlocking)) { res.status = 'BLOCKED-ESCALATED'; await escalate(`${it.id}-noconv`, 'no-convergence', `Fix round ${res.rounds - 1} for ${it.id} changed nothing: the same blocking findings recur (${keys.join(', ')}). Is the finding wrong (close as WONTFIX-BY-DECISION) or the approach wrong?`, 'Item parked.', blocking.map(f => `${f.fingerprint} ${f.path}: ${f.summary}\nREPRO: ${f.repro || ''}`).join('\n'), it.id); return res }
    prevBlocking = keys
    const fix = await agent(`${PRE}\nFix ONLY these findings on work item ${it.id} (base ${base}):\n${blocking.map(f => `${f.fingerprint} | ${f.sev} | ${f.path} | ${f.summary}\n   REPRO: ${f.repro || '(none given: reproduce from evidence)'}\n   EVIDENCE: ${f.evidence || ''}`).join('\n')}\nThen run the fast gates and node agentic/scripts/diff-guard.mjs --since ${base} --forbid fixer. Return results per fingerprint.`, { label: `fixer:${it.id}:r${res.rounds}`, phase: 'Build', agentType: 'wp-agentic:wp-fixer', schema: FIX_SCHEMA, effort: 'high' })
    const fg = await guard(base, null, true, `${it.id}-fix`)
    if (fg && !fg.ok) { await revert(base, null, true, `${it.id}-fix`); log(`${it.id}: fixer touched forbidden files, reverted: ${fg.violations.join('; ')}`) }
    let g2 = await gates('item', `${it.id}-fix${res.rounds}`); let attempts = 1
    while ((!g2 || !g2.ok) && attempts < MAX_GATE_ATTEMPTS) { await agent(`${PRE}\nYour fix for ${it.id} left gates RED: failed=[${(g2 && g2.failed.join(', ')) || '?'}]. Tail:\n${(g2 && g2.tail) || ''}\nRepair without touching tests/gates.`, { label: `fixer:${it.id}:r${res.rounds}:gates`, phase: 'Build', agentType: 'wp-agentic:wp-fixer', schema: FIX_SCHEMA, effort: 'high' }); g2 = await gates('item', `${it.id}-fix${res.rounds}b`); attempts++ }
    if (!g2 || !g2.ok) { res.status = 'BLOCKED-ESCALATED'; await escalate(`${it.id}-fixgates`, 'wrong-gate', `Fixing ${it.id} breaks gates (${(g2 && g2.failed.join(', ')) || '?'}) and the fixer cannot recover within ${MAX_GATE_ATTEMPTS} attempts.`, 'Item parked at last green commit.', (g2 && g2.tail) || '', it.id); return res }
    for (const r of (fix && fix.results) || []) if (r.status === 'FIXED') await runner(`node agentic/scripts/ledger.mjs close ${r.fingerprint} FIXED "${(r.detail || '').replace(/"/g, "'")}"`, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, `close:${r.fingerprint}`, 'Build')
    await commit(`${it.id}: fix round ${res.rounds}`, `${it.id}-fix${res.rounds}`)
  }
}
for (const [wi, wave] of waves.entries()) {
  log(`${EPIC}: wave ${wi + 1}/${waves.length}: ${wave.map(i => i.id).join(', ')}`)
  if (args && args.parallel && wave.length > 1 && wave.every(i => i.parallel_safe)) {
    // Parallel path: each item in its own worktree; then a merge step. Off by default.
    const rs = (await parallel(wave.map(it => () => buildItem(it)))).filter(Boolean)
    itemResults.push(...rs)
    await agent(`${PRE}\nMerge the branches/worktrees created for items ${wave.map(i => i.id).join(', ')} into the current branch, resolve conflicts faithfully to each item's TOUCHES, run node agentic/scripts/gate.mjs --profile item, and commit "merge: ${wave.map(i => i.id).join(', ')}".`, { label: `merge:wave${wi + 1}`, phase: 'Build', agentType: 'wp-agentic:wp-devops', schema: MAKER_SCHEMA, effort: 'high' })
  } else {
    for (const it of wave) itemResults.push(await buildItem(it))
  }
}
const verifiedItems = itemResults.filter(r => r.status === 'VERIFIED').map(r => r.id)
const parkedItems = itemResults.filter(r => r.status !== 'VERIFIED').map(r => r.id)
log(`${EPIC}: build done: verified=[${verifiedItems.join(', ')}] parked=[${parkedItems.join(', ')}]`)

// ---------- Phase: Integrate ----------
phase('Integrate')
let ig = await gates('integration', EPIC); let igAttempts = 1
while ((!ig || !ig.ok) && igAttempts < MAX_GATE_ATTEMPTS) {
  await agent(`${PRE}\nIntegration gates are RED for ${EPIC}: failed=[${(ig && ig.failed.join(', ')) || '?'}] skipped=[${(ig && ig.skipped.join(', ')) || ''}]. Tail:\n${(ig && ig.tail) || ''}\nRepair the integration (never tests/gates). Then re-run node agentic/scripts/gate.mjs --profile integration.`, { label: `fixer:${EPIC}:integration${igAttempts}`, phase: 'Integrate', agentType: 'wp-agentic:wp-fixer', schema: FIX_SCHEMA, effort: 'high' })
  ig = await gates('integration', `${EPIC}-i${igAttempts}`); igAttempts++
}
const integrationGreen = !!(ig && ig.ok)
if (!integrationGreen) await escalate('integration-gates', 'wrong-gate', `Integration gates stay red for ${EPIC} (failed: ${(ig && ig.failed.join(', ')) || '?'}; skipped: ${(ig && ig.skipped.join(', ')) || ''}). Gate wrong, or epic incomplete?`, 'Proceeding to verification for evidence, but the epic cannot PASS.', (ig && ig.tail) || '', 'integration')
await commit(`${EPIC}: integration`, 'integration')

// ---------- Phase: Verify (+ epic-level bounded fix loop) ----------
phase('Verify')
let epicRound = 0; let adjudication = null; let verifyReports = []
const runVerifiers = async (round) => {
  const jobs = [() => agent(`${PRE}\nFunctional QA for ${EPIC} (round ${round}). Read ${CYCLE}/ac.md and ${CYCLE}/items.json. Verified items: ${verifiedItems.join(', ') || 'none'}; parked: ${parkedItems.join(', ') || 'none'}. Execute every AC as its persona; try to break it; return findings + evidence_for_acs + markdown.`, { label: `qa:${EPIC}:r${round}`, phase: 'Verify', agentType: 'wp-agentic:wp-qa', schema: FINDINGS_SCHEMA, effort: 'high' })]
  if (ac.has_ui) {
    jobs.push(() => agent(`${PRE}\nVisual QA for ${EPIC} (round ${round}). Routes from the spec manifest: ${routes.join(', ') || '(read ' + CYCLE + '/spec.md)'}. Save screenshots and manifest.json under ${CYCLE}/qa-visual/ exactly as your role describes. Return findings + evidence_for_acs + markdown.`, { label: `qa-visual:${EPIC}:r${round}`, phase: 'Verify', agentType: 'wp-agentic:wp-qa-visual', schema: FINDINGS_SCHEMA, effort: 'high' }))
    jobs.push(() => agent(`${PRE}\nAccessibility + localisation verification for ${EPIC} (round ${round}). Flows from ${CYCLE}/ac.md. Write ${CYCLE}/a11y-i18n.json as your role describes. Return findings + evidence_for_acs + markdown.`, { label: `a11y-i18n:${EPIC}:r${round}`, phase: 'Verify', agentType: 'wp-agentic:wp-a11y-i18n', schema: FINDINGS_SCHEMA, effort: 'medium' }))
  }
  if (ac.class === 'C') jobs.push(() => agent(`${PRE}\nEpic-level security review for ${EPIC} (round ${round}), class C: attack the integrated result (cross-tenant, escalation, restricted-field leakage, integrations). Return findings + markdown.`, { label: `security:${EPIC}:r${round}`, phase: 'Verify', agentType: 'wp-agentic:wp-security', schema: FINDINGS_SCHEMA, effort: 'high' }))
  const reps = (await parallel(jobs)).filter(Boolean)
  for (const [i, r] of reps.entries()) await scribe(`${CYCLE}/verify/r${round}-${i}.md`, r.markdown, `verify:${round}-${i}`)
  for (const f of reps.flatMap(r => r.findings || [])) await ledgerFinding(f, 'epic')
  return reps
}
let prevEpicBlocking = []
while (true) {
  verifyReports = await runVerifiers(epicRound + 1)
  const closed = await closedFingerprints(`epic-r${epicRound + 1}`)
  const blocking = verifyReports.flatMap(r => r.findings || []).filter(f => (f.sev === 'SEV1' || f.sev === 'SEV2') && !closed.has(f.fingerprint) && (f.repro || f.evidence))
  const evidence = verifyReports.flatMap(r => r.evidence_for_acs || [])
  phase('Adjudicate')
  adjudication = await agent(`${PRE}\nJob 2 (ADJUDICATE) for ${EPIC}, round ${epicRound + 1}. Frozen criteria:\n${acText}\nVerifier reports: ${CYCLE}/verify/r${epicRound + 1}-*.md and item reviews in ${CYCLE}/reviews/. Evidence offered by verifiers:\n${evidence.map(e => `${e.ac}: ${e.evidence}`).join('\n') || '(none)'}\nOpen blocking findings: ${blocking.map(f => `${f.sev} ${f.fingerprint} ${f.path}: ${f.summary}`).join('; ') || 'none'}\nIntegration gates green: ${integrationGreen}. Parked items: ${parkedItems.join(', ') || 'none'}. Escalations so far: ${escalations.map(e => e.slug).join(', ') || 'none'}.\nReturn the verdict, rows, reopen_items, blocking_fingerprints, proposed_backlog, contract_change, demo_seed_updated, and the adjudication.json content.`, { label: `pm-adjudicate:${EPIC}:r${epicRound + 1}`, phase: 'Adjudicate', agentType: 'wp-agentic:wp-pm', schema: ADJ_SCHEMA, effort: 'high' })
  if (!adjudication) { adjudication = { verdict: 'BLOCKED', rows: [], json: '{}' }; break }
  await scribe(`${CYCLE}/adjudication.json`, adjudication.json, 'adjudication')
  if (adjudication.verdict !== 'FAIL' || !integrationGreen) break
  epicRound++
  const keys = blocking.map(fp)
  if (epicRound >= MAX_EPIC_ROUNDS) { await escalate('epic-rounds', 'no-convergence', `${EPIC} failed adjudication ${MAX_EPIC_ROUNDS} times. Failing rows: ${adjudication.rows.filter(r => r.verdict !== 'PASS').map(r => r.ac).join(', ')}. Accept partial, split the epic, or change criteria on the record?`, 'Epic parked as BLOCKED.', blocking.map(f => `${f.fingerprint} ${f.path}: ${f.summary}`).join('\n'), 'epic-rounds'); adjudication.verdict = 'BLOCKED'; break }
  if (sameSet(keys, prevEpicBlocking) && keys.length) { await escalate('epic-noconv', 'no-convergence', `Epic-level fix round for ${EPIC} changed nothing (same blocking findings: ${keys.join(', ')}).`, 'Epic parked as BLOCKED.', '', 'epic-noconv'); adjudication.verdict = 'BLOCKED'; break }
  prevEpicBlocking = keys
  phase('Verify')
  await agent(`${PRE}\nEpic-level fix round ${epicRound} for ${EPIC}. Fix ONLY:\n${blocking.map(f => `${f.fingerprint} | ${f.sev} | ${f.path} | ${f.summary}\n   REPRO: ${f.repro || ''}\n   EVIDENCE: ${f.evidence || ''}`).join('\n')}\nFailing criteria per wp-pm: ${adjudication.rows.filter(r => r.verdict !== 'PASS').map(r => `${r.ac} (${r.verdict})`).join(', ')}. Then run node agentic/scripts/gate.mjs --profile integration and diff-guard --forbid fixer.`, { label: `fixer:${EPIC}:epic-r${epicRound}`, phase: 'Verify', agentType: 'wp-agentic:wp-fixer', schema: FIX_SCHEMA, effort: 'high' })
  const fg = await guard('HEAD', null, true, `epic-r${epicRound}`); if (fg && !fg.ok) await revert('HEAD', null, true, `epic-r${epicRound}`)
  ig = await gates('integration', `${EPIC}-epic-r${epicRound}`)
  if (!ig || !ig.ok) { await escalate('epic-fix-gates', 'wrong-gate', `Epic-level fix for ${EPIC} broke integration gates (${(ig && ig.failed.join(', ')) || '?'}).`, 'Epic parked as BLOCKED at last green commit.', (ig && ig.tail) || '', 'epic-fix-gates'); adjudication.verdict = 'BLOCKED'; break }
  await commit(`${EPIC}: epic fix round ${epicRound}`, `epic-fix${epicRound}`)
}

// ---------- Phase: Ship ----------
phase('Ship')
let release = { status: 'SKIPPED' }
if (adjudication.verdict === 'PASS') {
  const dod = await runner(`node agentic/scripts/dod.mjs --epic ${EPIC} --json`, DOD_SCHEMA, `dod:${EPIC}`, 'Ship', 'Return ok, failed_items (labels of ❌ rows) and output (the printed checklist).')
  if (dod && dod.ok) {
    release = await agent(`${PRE}\nRelease ${EPIC}. wp-pm verdict PASS; DoD green. Follow your steps (release gates, version, CHANGELOG in uz/ru/en, tag, deploy if configured, ledger line with rounds=${itemResults.reduce((s, r) => s + r.rounds, 0)}, blocking_findings=${itemResults.reduce((s, r) => s + r.findings.filter(f => f.sev === 'SEV1' || f.sev === 'SEV2').length, 0)}, escalations=${JSON.stringify(escalations.map(e => e.slug))}).`, { label: `release:${EPIC}`, phase: 'Ship', agentType: 'wp-agentic:wp-release', schema: RELEASE_SCHEMA, effort: 'medium' }) || { status: 'BLOCKED' }
  } else {
    release = { status: 'BLOCKED', note: `DoD red: ${(dod && dod.failed_items.join('; ')) || 'dod script failed'}` }
    await escalate('dod', 'wrong-gate', `${EPIC} passed adjudication but the Definition-of-Done script is red: ${(dod && dod.failed_items.join('; ')) || '?'}. Which is wrong?`, 'Not released.', (dod && dod.output) || '', 'dod')
  }
}
const finalVerdict = adjudication.verdict === 'PASS' && release.status === 'RELEASED' ? 'PASS' : (adjudication.verdict === 'PASS' ? 'PASS-UNRELEASED' : adjudication.verdict)
await runner(`node agentic/scripts/ledger.mjs append cycles '${JSON.stringify({ epic: EPIC, area: ac.area || '', class: ac.class, verdict: finalVerdict, release: release.status, version: release.version || '', rounds: itemResults.reduce((s, r) => s + r.rounds, 0), epic_rounds: epicRound, items: itemResults.map(r => ({ id: r.id, status: r.status, rounds: r.rounds })), blocking_findings: itemResults.reduce((s, r) => s + r.findings.filter(f => f.sev === 'SEV1' || f.sev === 'SEV2').length, 0), escalations: escalations.map(e => e.slug), ts: RUN_TS }).replace(/'/g, "'\\''")}'`, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, `ledger-cycle:${EPIC}`, 'Ship')
await runner(`node agentic/scripts/backlog.mjs set-status ${EPIC} ${finalVerdict === 'PASS' ? 'done' : 'blocked'} --note "${finalVerdict}; escalations: ${escalations.map(e => e.slug).join(', ') || 'none'}"`, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, `backlog-status:${EPIC}`, 'Ship')
log(`${EPIC}: ${finalVerdict} (release=${release.status}${release.version ? ' v' + release.version : ''}, escalations=${escalations.length})`)

// ---------- Phase: Scout ----------
phase('Scout')
const scout = await agent(`${PRE}\n${EPIC} just finished with verdict ${finalVerdict}. Do your four-persona walk on the running app and return ranked proposals (max 15) + summary.`, { label: `scout:${EPIC}`, phase: 'Scout', agentType: 'wp-agentic:wp-scout', schema: SCOUT_SCHEMA, effort: 'medium' })
if (scout && scout.proposals.length) {
  for (const p of scout.proposals.slice(0, 15)) await runner(`node agentic/scripts/backlog.mjs add '${JSON.stringify({ title: p.title, status: 'proposed', priority: 500, phase: 2, area: ac.area || '', depends_on: [EPIC], personas: [p.persona || 'specialist'], outcomes: [p.why], evidence: [p.evidence || `scout after ${EPIC}`], value: p.value || 'M', complexity: p.complexity || 'M' }).replace(/'/g, "'\\''")}'`, { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, `backlog-add`, 'Scout')
  log(`${EPIC}: scout filed ${Math.min(15, scout.proposals.length)} proposal(s)`)
}
if (adjudication.proposed_backlog && adjudication.proposed_backlog.length) log(`${EPIC}: wp-pm proposed ${adjudication.proposed_backlog.length} backlog item(s): ${adjudication.proposed_backlog.join(' | ')}`)

return { epic: EPIC, verdict: finalVerdict, class: ac.class, criteria: ac.criteria.length, items: itemResults.map(r => ({ id: r.id, status: r.status, rounds: r.rounds, findings: r.findings.length })), epic_rounds: epicRound, integration_green: integrationGreen, adjudication: adjudication.rows, release, escalations, scout_summary: scout && scout.summary }
