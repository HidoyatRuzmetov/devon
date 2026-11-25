import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../artifacts/qa/onboarding')
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.png'))
  .sort()
const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const titles = {
  '01': 'A member submits the department HTML',
  '02': 'Head previews the isolated, interactive HTML',
  '03': 'Head reviews and publishes',
  '04': 'Compact red Leave department control',
  '05': 'The introduction appears after joining',
  '06': 'Required setup: Telegram',
  '07': 'Required setup: account details',
  '08': 'Required setup: resume',
  '09': 'Required setup: personnel record',
  10: 'Chapter 1: your professional identity',
  11: 'Chapter 2: Home',
  12: 'Chapter 2: Assistant',
  13: 'Chapter 3: Your column',
  14: 'Chapter 3: collapse columns',
  15: 'Chapter 3: expand columns',
  16: 'Chapter 3: the real onboarding task',
  17: 'Chapter 3: task details and automatic checklist',
  18: 'Chapter 3: point to conversion without converting',
  19: 'Chapter 4: group projects',
  20: 'Practice: name an example project',
  21: 'Practice: add an individual task',
  22: 'Practice: add and complete a checklist item',
  23: 'Chapter 6: Events',
  24: 'Chapter 6: People',
  25: 'Chapter 6: Structure',
  26: 'Chapter 7: check-in',
  27: 'Chapter 7: check-out',
  28: 'Chapter 7: the permanent help destination',
  29: 'The new Getting started center',
  30: 'Getting started on mobile',
  31: 'The guide on mobile',
  32: 'Leave department on mobile',
  33: 'Cards chapter replay on mobile',
  34: 'The practice exercise on mobile',
  35: 'Getting started in dark mode',
  36: 'Localized Getting started center',
  37: 'Recovery to the original setup department',
  38: 'Home after completing the guide',
  '10a': 'Welcome to the walkthrough',
  '10b': 'Résumé and its navigation tab',
  '10c': 'Personnel record and its navigation tab',
  '10d': 'Settings overview',
  '22a': 'Personal: calendar',
  '22b': 'Personal: private cards',
  '22c': 'Personal: focus timer',
  '24b': 'People: full colleague profile',
  '25a': 'Structure: organisation chart and its selected tab',
  '28a': 'Getting started stays highlighted after a page refresh',
  '38a': 'The new completion scene',
  '38b': 'Completion animation preview',
  39: 'A colleague assigns the project owner',
  40: 'Existing member: optional guide',
  41: 'Audit records for new features',
  42: 'Fallback audit receipts',
  60: 'Main portal board: matching style reference',
  '38c': 'Light sweep and ripple as the guide lands',
  61: 'Head creates a public dashboard link',
  62: 'Public dashboard: read-only cards',
  63: 'Public dashboard: structure list',
  64: 'Public structure on mobile',
  65: 'Public cards on mobile',
  66: 'Closed link: no department data remains',
}
const libraries = [
  [
    'Driver.js',
    'https://driverjs.com/docs/configuration',
    'MIT; focused spotlight, action hooks and a small imperative surface.',
    'Routing, persistence and reliable target readiness must be supplied by the application.',
    'Selected. WorkPortal controls each route, saved step, real click and separate practice exercise.',
  ],
  [
    'React Joyride',
    'https://github.com/gilbarbara/react-joyride',
    'MIT; React components, controlled steps and established callback patterns.',
    'Application routing and multi-stage exercises still need coordination with its internal lifecycle.',
    'A credible alternative; no extra wrapper is needed for our explicit route controller.',
  ],
  [
    'Reactour',
    'https://github.com/elrumordelaluz/reactour',
    'MIT; modular mask, popover and tour packages; flexible presentation.',
    'More composition and focus/interaction policy to own across drawers and forms.',
    'Useful reference for restrained masks and independent controls.',
  ],
  [
    'Shepherd',
    'https://www.shepherdjs.dev/about/',
    'Rich step controls, positioning and accessibility features.',
    'AGPL/commercial licensing requires a separate distribution decision; more surface than this guide needs.',
    'Borrowed the focus and explicit-action patterns, without adding the dependency.',
  ],
  [
    'Intro.js',
    'https://introjs.com/',
    'Established compact tooltips, hints and straightforward tours.',
    'AGPL/commercial licensing and a linear default flow require care for this portal.',
    'Useful visual baseline; our route-aware practice flow needs more application control.',
  ],
]
const patterns = [
  [
    'Appcues onboarding examples',
    'https://www.appcues.com/blog/saas-onboarding-screens',
    'Clear welcome framing and small next actions.',
    'Large welcome modals can delay useful work; reserve the large modal for the requested HTML.',
  ],
  [
    'Usertour SaaS onboarding examples',
    'https://www.usertour.io/blog/saas-product-onboarding-chat',
    'Contextual prompts paired with a persistent checklist.',
    'Avoid competing chat prompts and checklists at the same time.',
  ],
  [
    'Storylane product-tour examples',
    'https://www.storylane.io/blog/create-effective-product-tour',
    'Safe demonstrations make workflows easier to understand.',
    'A marketing demo can drift from the live product; use real portal targets plus one clearly labelled local exercise.',
  ],
  [
    'Product Fruits onboarding patterns',
    'https://productfruits.com/blog/user-onboarding-tips',
    'A durable help entry point and progressive feature discovery.',
    'Avoid piling banners, hotspots and tooltips onto one screen.',
  ],
  [
    'Jimo visual onboarding examples',
    'https://jimo.ai/blog/top-10-tools-to-reduce-user-drop-off-during-onboarding-the-ultimate-2025-guide',
    'Useful examples of spotlights, checklist placement and completion feedback.',
    'Treat vendor comparisons as inspiration, not independent evidence of outcomes.',
  ],
]
const principles = [
  [
    'Contextual guidance',
    'https://www.nngroup.com/articles/onboarding-tutorials/',
    'Point at the actual control when it is useful. Do not run the tour before department membership exists.',
  ],
  [
    'Progressive disclosure',
    'https://www.nngroup.com/articles/progressive-disclosure/',
    'Seven requested chapters, with one small step at a time. The practice project reveals project, task, checklist and completion in sequence.',
  ],
  [
    'Recognition rather than recall',
    'https://www.nngroup.com/articles/recognition-and-recall/',
    'Use visible controls, a saved six-item task and chapter replay. Users should not memorize a long introduction.',
  ],
  [
    'Fitts law',
    'https://www.nngroup.com/articles/fitts-law/',
    'Keep the next action close to its explanation and make tutorial buttons at least 44 pixels high.',
  ],
  [
    'Modal keyboard and focus behavior',
    'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/',
    'Use the existing accessible dialogs for HTML and practice. Escape pauses the guide; completion returns focus to Home help.',
  ],
  [
    'Motion and accessibility',
    'https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html',
    'Respect reduced motion. The shrink-to-help finale has a quiet alternative; it is not required for understanding.',
  ],
  [
    'Target size and focus visibility',
    'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
    'Keep clear labels, visible keyboard focus and room for pointer targets. Verify the new center and tooltip with automated accessibility checks.',
  ],
]
const group = (name) => {
  if (/^22[abc]-/.test(name)) return 'tour'
  const n = Number(name.slice(0, 2))
  if (n >= 60) return 'public'
  return n <= 9 ? 'setup' : n <= 19 ? 'tour' : n <= 22 ? 'practice' : n <= 29 ? 'tour' : 'variants'
}
const card = (name) =>
  `<a class="shot" data-group="${group(name)}" href="${escape(name)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(name)}" alt="${escape(titles[name.split('-')[0]] ?? titles[name.slice(0, 2)] ?? name)}"><div><span>${escape(name.replace('.png', ''))}</span><h3>${escape(titles[name.split('-')[0]] ?? titles[name.slice(0, 2)] ?? name)}</h3></div></a>`
const publicReview = JSON.parse(readFileSync(resolve(dir, 'public-dashboard-review.json'), 'utf8'))
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkPortal onboarding review</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#203140;font:15px/1.6 system-ui,sans-serif}header{background:#102c40;color:white;padding:56px max(24px,calc((100vw - 1200px)/2))}header p{max-width:760px;color:#c4d2de}h1{font-size:clamp(32px,5vw,52px);line-height:1.1;letter-spacing:-.03em;margin:12px 0 20px}h2{font-size:25px;margin:0 0 14px}small,.eyebrow{text-transform:uppercase;letter-spacing:.1em;font-size:11px}main{max-width:1248px;padding:32px 24px 70px;margin:auto}section{margin-bottom:40px}.note{padding:22px 26px;border:1px solid #d4dee6;background:white;border-radius:12px}.pills{display:flex;flex-wrap:wrap;gap:10px}.pill{border:1px solid #526b7d;border-radius:30px;padding:6px 12px;font-size:12px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}button{min-height:44px;padding:9px 16px;border:1px solid #c8d5de;background:white;color:#173c57;border-radius:8px;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#1e4e70;color:white}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #4d8fc2;outline-offset:3px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.shot{display:block;background:white;border:1px solid #d4dee6;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none}.shot:hover{border-color:#4d7897;box-shadow:0 8px 25px #132b4010}.shot img{display:block;width:100%;height:300px;object-fit:contain;object-position:top;background:#e7ecf0}.shot div{padding:18px 20px}.shot span{font-size:11px;color:#5c7385}.shot h3{font-size:16px;line-height:1.4;margin:5px 0 0}.shot[hidden]{display:none}a{color:#1e5d87}details{border:1px solid #d4dee6;background:white;border-radius:12px;padding:20px 24px;margin:16px 0}summary{cursor:pointer;font-size:19px;font-weight:600}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;border-bottom:1px solid #e0e6eb;padding:14px 12px;vertical-align:top}th{font-size:12px;color:#607485}.scroll{overflow:auto}li{margin:14px 0}video{width:100%;max-height:650px;background:#102c40;border-radius:12px}footer{font-size:13px;color:#637585}@media(max-width:750px){.grid{grid-template-columns:1fr}.shot img{height:260px}header{padding:36px 24px}td,th{min-width:180px}}
</style></head><body><header><div class="eyebrow">Local Docker review · November 2026</div><h1>A clear start in WorkPortal.</h1><p>Department introduction, four required setup items, and a practical seven-chapter guide. Review the complete journey below; open any screenshot at full size.</p><div class="pills"><span class="pill">${files.length} screenshots</span><span class="pill">Real local API and database</span><span class="pill">No project writes from practice</span><span class="pill">Desktop · Mobile · Dark · Four languages</span></div></header><main>
<section class="note" id="public-dashboard"><h2>New: public dashboard</h2><p><a href="${escape(publicReview.url)}" target="_blank" rel="noopener noreferrer">Open the live local dashboard</a> · <a href="public-dashboard-review.json">Security check receipt</a></p><p>A compact two-tab page: read-only Cards and a Structure list. Department heads create and close links from Profile settings → Department → Public dashboard. Links expire after 30 days by default; 7 days, 90 days and no expiry are also available. Signed-in visitors see the same public page, while their usual portal remains available at its normal address.</p><p>The public page has a separate build and a field-limited endpoint. It omits private navigation, card details, files, profiles and contact information. Link secrets are stored as hashes and travel in an authorization header, not request URLs. Requests recheck expiry, revocation and the publisher’s active head membership. An already open dashboard clears on its next refresh, within 30 seconds. Publicly viewed data can be copied; closing a link prevents future retrieval, not existing copies.</p><p>Checks cover head/member/outsider permissions, both heads, cookie isolation, cross-department reads, CSRF, injected markup, private-field exclusion, private-bundle exclusion, expiry, locked publishers, paused departments, revocation, mobile layouts, keyboard scrolling and automated accessibility. This is tested protection, not a claim of absolute security.</p><p>Design references: <a href="https://www.nngroup.com/articles/tabs-used-right/">NN/g: using tabs</a> informed the two adjacent peer views; <a href="https://www.nngroup.com/articles/progressive-disclosure/">progressive disclosure</a> informed the compact link controls. Security review follows <a href="https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html">OWASP authorization guidance</a> and <a href="https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html">REST security guidance</a>.</p></section>
<section class="note"><h2>What is ready to review</h2><p>The guide starts with a plain welcome and uses larger titles with small page numbers. Tooltips sit outside the highlighted view when space allows. Nearby tabs join their content with rounded corners; distant controls stay separately highlighted. Résumé and personnel highlights stay below the search bar, and Structure includes its organisation chart. Personal has three stops, People opens a full profile, and the practice project shares its presentation components with the real project screen. Existing accounts keep optional access.</p><p>Any department member can upload a standalone HTML file. A department head previews and approves publication. New members see that introduction only after joining. The portal owns the Finished reading button. Telegram, account details, resume and personnel record must be complete before normal portal access opens.</p><p>The guide uses the real onboarding task and its six automatically maintained checklist items. Project practice stays in the browser. Home now opens the Getting started center with chapter replay, replacing the old FAQ screen. Existing accounts keep their access.</p><p><strong>Verification limit:</strong> this isolated review has no live Telegram bot. Its verified-link record is supplied as a test fixture. The actual external Telegram linking journey still needs a configured bot. Screenshots contain fictional review accounts.</p><p><a href="docker-report/index.html">Browser test report</a> · <a href="verification.json">Verification receipt</a> · <a href="accessibility.json">Getting started accessibility results</a> · <a href="/">Open the local portal</a></p></section>
<section><h2>Completion motion</h2><p>The existing guide flight is preserved. On landing, a restrained light sweep, two soft ripples and a brief book-icon response mark the Getting started button. Reduced-motion users receive a static completion state.</p><video controls preload="metadata" src="38-help-finale.webm">Your browser does not support this video.</video></section>
<section><h2>Every part of the journey</h2><nav aria-label="Filter screenshots"><button data-filter="all" aria-pressed="true">All screenshots</button><button data-filter="public" aria-pressed="false">Public dashboard</button><button data-filter="setup" aria-pressed="false">Upload &amp; required setup</button><button data-filter="tour" aria-pressed="false">Seven-chapter guide</button><button data-filter="practice" aria-pressed="false">Practice project</button><button data-filter="variants" aria-pressed="false">Mobile, languages &amp; recovery</button></nav><div class="grid">${files.map(card).join('')}</div></section>
<section><h2>Research and design decisions</h2><p>The research covered the requested SaaS dashboard, guided walkthrough, spotlight, React tour, GitHub onboarding, feature discovery and tour-library searches. This is a curated comparison of relevant implementations and visual references, not a claim to enumerate every product or satisfy every design principle without tradeoffs.</p>
<details><summary>Open-source implementation comparison</summary><p>Driver.js 1.8.0 is pinned. Its spotlight layer is coordinated by WorkPortal's own route and progress controller. No third-party analytics service is introduced.</p><div class="scroll"><table><thead><tr><th>Library</th><th>Strengths</th><th>Tradeoffs</th><th>Decision</th></tr></thead><tbody>${libraries.map(([name, url, pros, cons, decision]) => `<tr><td><a href="${url}">${name}</a></td><td>${pros}</td><td>${cons}</td><td>${decision}</td></tr>`).join('')}</tbody></table></div></details>
<details><summary>Visual examples: what to keep and avoid</summary><p>These linked pages contain the original product-tour screenshots and examples. They informed the layout; their artwork is not copied into the portal.</p><div class="scroll"><table><thead><tr><th>Reference</th><th>Useful pattern</th><th>Critical assessment</th></tr></thead><tbody>${patterns.map(([name, url, keep, avoid]) => `<tr><td><a href="${url}">${name}</a></td><td>${keep}</td><td>${avoid}</td></tr>`).join('')}</tbody></table></div></details>
<details><summary>UX principles and accessibility</summary><ul>${principles.map(([name, url, application]) => `<li><a href="${url}">${name}</a> — ${application}</li>`).join('')}</ul><p>Seven chapters is the requested structure, not a universal memory limit. Required setup deliberately adds friction because all four essentials must be completed. Progress is saved, forms remain accessible, and the optional guide can be paused and replayed.</p></details></section>
<footer>Local review only. This work has not been deployed or published. The earlier uncommitted tutorial experiments and weighting changes remain outside this release.</footer></main><script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('.shot').forEach(shot=>shot.hidden=button.dataset.filter!=='all'&&shot.dataset.group!==button.dataset.filter)}));</script></body></html>`
writeFileSync(resolve(dir, 'index.html'), html)
const receipt = JSON.parse(readFileSync(resolve(dir, 'verification.json'), 'utf8'))
receipt.screenshots = files.length
receipt.galleryGeneratedAt = new Date().toISOString()
writeFileSync(resolve(dir, 'verification.json'), JSON.stringify(receipt, null, 2))
console.log(`Review gallery generated with ${files.length} screenshots.`)
