export const meta = {
  name: 'review-sweep',
  description: 'Exhaustive bug hunt over the whole codebase: six lenses find, dedupe by fingerprint, two adversarial refuters per finding, confirmed SEV1/SEV2 fixed by wp-fixer under the bounded loop, everything ledgered. Loops until two consecutive rounds find nothing new.',
  whenToUse: 'Run between epics or before a release. args: {scope: "apps/api", maxRounds: 3, fix: true}.',
  phases: [
    { title: 'Find', detail: 'six lenses in parallel' },
    { title: 'Refute', detail: 'two skeptics per fresh finding' },
    { title: 'Fix', detail: 'wp-fixer on confirmed SEV1/2, gates after' },
  ],
}
const SCOPE = (args && args.scope) || 'apps/ packages/'
const MAX_ROUNDS = (args && args.maxRounds) || 3
const FIX = !(args && args.fix === false)
const FINDING = { type: 'object', properties: { sev: { type: 'string', enum: ['SEV1', 'SEV2', 'SEV3', 'NIT'] }, path: { type: 'string' }, summary: { type: 'string' }, repro: { type: 'string' }, evidence: { type: 'string' }, fingerprint: { type: 'string' } }, required: ['sev', 'path', 'summary', 'fingerprint'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: FINDING } }, required: ['findings'] }
const VERDICT = { type: 'object', properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, sev_override: { type: 'string' } }, required: ['refuted', 'reason'] }
const tiny = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
const LENSES = [
  { key: 'correctness', prompt: 'logic errors, off-by-one, null/undefined paths, timezone (Asia/Tashkent), Uzbek/Cyrillic text handling, race conditions, wrong status transitions' },
  { key: 'tenant-permissions', prompt: 'missing tenant_id scoping, endpoints without can(), restricted personal fields leaking into lists/search/exports/notifications, acting-for gaps (INVARIANTS I-1, I-2, I-6, I-7, I-8)' },
  { key: 'error-paths', prompt: 'unhandled rejections, missing transactions on multi-row writes, retries without idempotency, swallowed errors, timeouts absent on outbound calls, partial-failure states left inconsistent' },
  { key: 'contracts-drift', prompt: 'client reading fields the API no longer returns, contract types out of sync with handlers, OpenAPI drift, i18n keys used but missing, dead exports' },
  { key: 'ux-consistency', prompt: 'screens missing empty/loading/error/no-permission states, confirm dialogs where undo should be, inconsistent labels for the same concept across screens, keyboard traps, command-palette entries missing for new routes (I-10 to I-13)' },
  { key: 'tests-that-cannot-fail', prompt: 'assertions that pass on an empty implementation, mocked-away behaviour under test, skipped tests, e2e specs that never assert the AC click count' },
]
const PRE = `Read agentic/PROTOCOL.md §4 and agentic/INVARIANTS.md. Scope: ${SCOPE}.`
const seen = new Set(); const confirmed = []; let dry = 0; let round = 0
const closedRes = await agent(`Run: node agentic/scripts/ledger.mjs closed  (no epic filter). Return {"fingerprints":[each line]}`, { label: 'closed', phase: 'Find', model: 'haiku', effort: 'low', agentType: 'general-purpose', schema: { type: 'object', properties: { fingerprints: { type: 'array', items: { type: 'string' } } }, required: ['fingerprints'] } })
for (const f of (closedRes && closedRes.fingerprints) || []) seen.add(f)

while (dry < 2 && round < MAX_ROUNDS) {
  round++
  phase('Find')
  const found = (await parallel(LENSES.map(l => () => agent(`${PRE}\nLens: ${l.key} — look for: ${l.prompt}. Read the code, run tests where useful. Return only findings with a REPRO or concrete evidence; fingerprint each with node agentic/scripts/ledger.mjs fingerprint "<path>" "<summary>". Already-known fingerprints to skip: ${[...seen].slice(0, 200).join(', ') || 'none'}.`, { label: `find:${l.key}:r${round}`, phase: 'Find', agentType: 'wp-agentic:wp-reviewer', model: 'sonnet', effort: 'high', schema: FINDINGS })))).filter(Boolean).flatMap(r => r.findings)
  const fresh = found.filter(f => !seen.has(f.fingerprint))
  log(`review-sweep round ${round}: ${found.length} found, ${fresh.length} fresh`)
  if (!fresh.length) { dry++; continue }
  dry = 0; fresh.forEach(f => seen.add(f.fingerprint))
  phase('Refute')
  const judged = await parallel(fresh.map(f => () => parallel([0, 1].map(k => () => agent(`${PRE}\nA reviewer claims: ${f.sev} | ${f.path} | ${f.summary}\nREPRO: ${f.repro || '(none)'}\nEVIDENCE: ${f.evidence || '(none)'}\nTry to REFUTE it: read the code, run the repro. Default to refuted=true if you cannot reproduce or the severity is inflated (set sev_override when only the severity is wrong).`, { label: `refute${k}:${f.fingerprint}`, phase: 'Refute', agentType: 'wp-agentic:wp-qa', model: 'sonnet', effort: 'medium', schema: VERDICT }))).then(vs => ({ f, vs: vs.filter(Boolean) }))))
  for (const { f, vs } of judged.filter(Boolean)) {
    const refuted = vs.filter(v => v.refuted).length >= 1 && vs.length >= 2 ? vs.filter(v => v.refuted).length >= 2 : vs.some(v => v.refuted)
    if (refuted) continue
    const over = vs.map(v => v.sev_override).filter(Boolean)[0]
    const fin = { ...f, sev: over || f.sev }
    confirmed.push(fin)
    await agent(`Run: node agentic/scripts/ledger.mjs append findings '${JSON.stringify({ epic: 'SWEEP', item: 'review-sweep', sev: fin.sev, path: fin.path, summary: fin.summary, repro: fin.repro || '', evidence: fin.evidence || '', fingerprint: fin.fingerprint, status: 'open' }).replace(/'/g, "'\\''")}'  and return {"ok":true}`, { label: `ledger:${fin.fingerprint}`, phase: 'Refute', model: 'haiku', effort: 'low', agentType: 'general-purpose', schema: tiny })
  }
}
const blocking = confirmed.filter(f => f.sev === 'SEV1' || f.sev === 'SEV2')
log(`review-sweep: ${confirmed.length} confirmed (${blocking.length} SEV1/2) after ${round} round(s)`)
if (FIX && blocking.length) {
  phase('Fix')
  await agent(`Read agentic/PROTOCOL.md §5. Fix ONLY these confirmed findings:\n${blocking.map(f => `${f.fingerprint} | ${f.sev} | ${f.path} | ${f.summary}\n   REPRO: ${f.repro || ''}`).join('\n')}\nThen node agentic/scripts/gate.mjs --profile integration and node agentic/scripts/diff-guard.mjs --since HEAD --forbid fixer. Commit "sweep: fix ${blocking.length} finding(s)" if green. For each FIXED fingerprint run node agentic/scripts/ledger.mjs close <fp> FIXED "<what>".`, { label: 'fixer:sweep', phase: 'Fix', agentType: 'wp-agentic:wp-fixer', effort: 'high' })
  const g = await agent('Run: node agentic/scripts/gate.mjs --profile integration --json ; then Read agentic/ledger/last-gate.json and return {"ok": <bool>}', { label: 'gates:after-fix', phase: 'Fix', model: 'haiku', effort: 'low', agentType: 'general-purpose', schema: tiny })
  if (!g || !g.ok) log('review-sweep: integration gates RED after fixes; run feature-cycle-style escalation or inspect agentic/ledger/last-gate.json')
}
return { rounds: round, confirmed, blocking: blocking.length }
