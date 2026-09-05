export const meta = {
  name: 'polish-sweep',
  description: 'UX/visual polish pass over the running app: qa-visual screenshots every route, the designer critiques against DESIGN.md and the taste rules, the top N fixes go to wp-ui under the bounded loop, and a before/after report is written.',
  whenToUse: 'Run after a few epics ship, or before a demo. args: {maxFixes: 8, routes: ["/", "/people"]}.',
  phases: [
    { title: 'Capture', detail: 'screenshots of every route, 3 widths × 2 themes × uz/ru' },
    { title: 'Critique', detail: 'wp-designer ranks issues by impact' },
    { title: 'Polish', detail: 'wp-ui fixes top N; qa-visual re-captures' },
  ],
}
const MAX_FIXES = (args && args.maxFixes) || 8
const ROUTES = (args && args.routes) || null
const DIR = 'agentic/ledger/polish'
const CAP = { type: 'object', properties: { routes: { type: 'array', items: { type: 'string' } }, missing: { type: 'array', items: { type: 'string' } }, console_errors: { type: 'number' } }, required: ['routes', 'missing'] }
const CRIT = { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { route: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' }, impact: { type: 'string', enum: ['H', 'M', 'L'] }, evidence: { type: 'string' } }, required: ['route', 'issue', 'fix', 'impact'] } }, markdown: { type: 'string' } }, required: ['issues', 'markdown'] }
const tiny = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }

phase('Capture')
const before = await agent(`Capture the whole app for a polish pass. Routes: ${ROUTES ? ROUTES.join(', ') : 'every route in e2e/routes.json (or the sidebar + command palette if the file is missing)'}. Save screenshots under ${DIR}/before/ using your naming convention, plus ${DIR}/before/manifest.json. Also record console errors. Return routes, missing, console_errors.`, { label: 'capture:before', phase: 'Capture', agentType: 'wp-agentic:wp-qa-visual', effort: 'medium', schema: CAP })
if (!before || !before.routes.length) throw new Error('polish-sweep: nothing captured')
log(`polish-sweep: captured ${before.routes.length} route(s), missing ${before.missing.length}, console errors ${before.console_errors || 0}`)

phase('Critique')
const crit = await agent(`Read DESIGN.md, docs/03-plan/FEATURE-PLAN.md (taste rules and refusals), and every screenshot in ${DIR}/before/ (Read the PNGs). Critique like a merciless design lead: hierarchy, rhythm, tokens, states, copy (uz/ru naturalness), density, motion, dark mode, 390 px, consistency across screens. Return issues ranked by impact with a concrete fix each (component/token level, no vague advice) and a markdown report; the report is written to ${DIR}/critique.md by the workflow.`, { label: 'designer:critique', phase: 'Critique', agentType: 'wp-agentic:wp-designer', effort: 'high', schema: CRIT })
await agent(`Write EXACTLY this content to ${DIR}/critique.md and return {"ok":true}:\n\n${(crit && crit.markdown) || ''}`, { label: 'scribe:critique', phase: 'Critique', model: 'haiku', effort: 'low', agentType: 'general-purpose', schema: tiny })
const top = ((crit && crit.issues) || []).filter(i => i.impact !== 'L').slice(0, MAX_FIXES)
log(`polish-sweep: ${(crit && crit.issues.length) || 0} issues, fixing top ${top.length}`)

phase('Polish')
if (top.length) {
  await agent(`Read agentic/PROTOCOL.md, DESIGN.md and ${DIR}/critique.md. Implement exactly these polish fixes (no new features, no layout changes beyond what each fix states):\n${top.map((t, i) => `${i + 1}. [${t.impact}] ${t.route}: ${t.issue} → ${t.fix}`).join('\n')}\nRun node agentic/scripts/gate.mjs --profile item; commit "polish: ${top.length} fixes" when green.`, { label: 'ui:polish', phase: 'Polish', agentType: 'wp-agentic:wp-ui', effort: 'high' })
  const after = await agent(`Re-capture the same routes (${before.routes.join(', ')}) under ${DIR}/after/ with the same naming, then write ${DIR}/report.md comparing before/after per issue in ${DIR}/critique.md (fixed / partially / not fixed, with both screenshot paths). Return routes, missing, console_errors.`, { label: 'capture:after', phase: 'Polish', agentType: 'wp-agentic:wp-qa-visual', effort: 'medium', schema: CAP })
  log(`polish-sweep: after-capture ${after ? after.routes.length : 0} route(s); report at ${DIR}/report.md`)
}
return { routes: before.routes.length, issues: (crit && crit.issues.length) || 0, fixed_attempted: top.length }
