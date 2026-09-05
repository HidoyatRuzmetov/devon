# Data-dense UI components: tables, boards, timelines, calendars, org charts, charts

**TL;DR:** For tables, TanStack Table (headless, MIT) + TanStack Virtual is the right base — AG Grid Enterprise's per-seat license buys grouping/pivot features we likely don't need yet, and Glide Data Grid's canvas rendering is disqualifying for a government tool because it self-admits accessibility gaps. For drag-and-drop, build on Atlassian's pragmatic-drag-and-drop, not dnd-kit or the archived react-beautiful-dnd — it's what now runs Trello/Jira/Confluence and is framework-agnostic with real touch/keyboard support. For Gantt/timeline, start with a custom lightweight SVG/CSS-grid timeline (à la Linear) for the "roadmap" view and only reach for SVAR Gantt (MIT core) if true dependency-scheduling is demanded — skip Bryntum's cost unless a Phase-3 planning office needs it. For calendars, FullCalendar (MIT core) remains the safest default for RSVP/events; Schedule-X is a lighter, more modern alternative worth prototyping. For org charts, d3-org-chart for the literal hierarchy view, React Flow/xyflow only if we need general node-link diagrams later. For charts, Recharts/shadcn-charts for 90% of KPI dashboards, ECharts only if a single chart needs to render tens of thousands of points.

## Data tables

| Library | Version (2026) | License | Bundle | Virtualization | Accessibility | Notes |
|---|---|---|---|---|---|---|
| **TanStack Table** | v8 stable, v9 in active rollout | MIT | Headless — logic only, ~15KB core, tree-shakeable | Not built in; pair with **TanStack Virtual** | You own the DOM, so you own the ARIA — no default a11y, but nothing to fight either | Headless: you supply all markup/CSS. This is the correct model when we already have a design system (the reference site's shadcn/ui tokens) and don't want to fight someone else's grid chrome. |
| **AG Grid** | Community (MIT) + Enterprise (commercial) | MIT for Community; proprietary EULA for Enterprise, per-developer/per-deployment, one year of updates+support included | Full-featured build is large (hundreds of KB); modular imports reduce this | Built-in, excellent, handles 100k+ rows client-side | Mature ARIA grid pattern, keyboard nav (Excel-like) | Row grouping, pivot/aggregation, master-detail, range selection, server-side row model, and Excel export are **all Enterprise-only**. Community alone covers basic sort/filter/paginate/edit — fine for a simple register, not for anything resembling a pivot table. |
| **Glide Data Grid** | actively maintained, 5.3k★ | MIT | Small — canvas avoids DOM node cost entirely | Native, scales to millions of rows, this is its whole selling point | **Maintainers state directly: "none of the primary developers are accessibility users so there are likely flaws"** | Canvas-rendered cells are not real DOM — screen readers get nothing without significant extra work. This is a hard blocker for anything citizen-facing or for WCAG/EN 301 549-style government accessibility obligations. Fine for an internal analyst-only, sighted-user data-exploration tool; wrong default for a department-wide app that must work for every civil servant including assistive-tech users. |
| **react-data-grid (adazzle)** | MIT | Lightweight, React-idiomatic | Built-in virtualization | Decent, Excel-like keyboard model (arrow keys, Tab, Enter to edit) | Good middle ground: spreadsheet-like editing feel without AG Grid's enterprise upsell or Glide's canvas trade-off. Smaller community/ecosystem than the other two. |
| **MUI X Data Grid** | Community (MIT) / Pro / Premium (commercial) | MIT core | Ties to MUI, heavier if you're not already on MUI | Pro tier | Standard MUI a11y | Column pinning, tree data, and virtualization-at-scale sit behind **Pro**; row grouping + aggregation + Excel export sit behind **Premium**. Same pattern as AG Grid: the paywall line is drawn almost exactly at "row grouping / pivot / export," across every vendor. Only worth it if we adopt MUI as the whole design system, which conflicts with the shadcn/Tailwind direction already implied by the reference prototype. |

**Pattern across all vendors:** row grouping, pivoting, and Excel-quality export are the recurring paywall line. If our roadmap eventually needs "group projects by sub-department, sum budgets, export to Excel for a ministry report," budget for either an AG Grid Enterprise seat (per-developer, not per-user, so a small team keeps cost down) or build grouping ourselves on top of TanStack Table's grouping API (which exists in Community/free form, just requires more of our own UI work).

## Virtualized lists

- **TanStack Virtual**: headless, framework-agnostic (React/Vue/Svelte/Solid), handles dynamic/unmeasured row heights via ResizeObserver, and is the natural pairing with TanStack Table since both are headless and share the same mental model. Part of an ecosystem with ~31.5M weekly downloads across TanStack packages — safe long-term bet.
- **react-window**: smaller, older, simpler API, fixed or variable-but-precomputed row sizes; used inside React DevTools itself. Good for simple fixed-height lists (e.g., a notification feed) where you don't need TanStack's dynamic measurement.
- **Recommendation**: pick one virtualization primitive for the whole app rather than mixing — TanStack Virtual, because it is the same family as our table library and also virtualizes 2-axis grids and masonry-style boards (useful for a card-based project register or People directory grid).

## Kanban drag-and-drop

| Library | Status | License | Bundle | Notes |
|---|---|---|---|---|
| **react-beautiful-dnd** | **Archived Aug 2025, deprecated on npm**, read-only repo | Apache-2.0 | — | Do not start new work on this. Atlassian's own migration guide points to pragmatic-drag-and-drop. |
| **dnd-kit** | Active, 17.6k★, 919 forks, 1,481 commits | MIT | Modular, ~10-45KB depending on features used | Good default for React-only apps: built-in keyboard support, sensible default ARIA, customizable screen-reader live-region announcements, and explicit support for virtualized lists. React-specific (adapters exist for other frameworks but React is first-class). Known friction: complex nested multi-container drag (e.g., dragging a card between kanban columns that are themselves reorderable) requires assembling several of its lower-level primitives yourself — good building blocks, not a finished kanban component. |
| **pragmatic-drag-and-drop (Atlassian)** | Active, 12.7k★, powers Trello/Jira/Confluence in production | Apache-2.0 | Core ~4.7KB, features loaded incrementally | Framework-agnostic (React/Vue/Svelte/Angular/vanilla), built on native browser DnD API rather than synthetic pointer events, which is *why* it's smaller and faster than dnd-kit at Atlassian's scale. Optional accessibility layer based on Atlassian Design System components, or bring your own. This is the successor product to react-beautiful-dnd from the same team, built specifically because rbd's model didn't scale to Jira/Trello's real-world board complexity. |

**Recommendation**: pragmatic-drag-and-drop over dnd-kit for the kanban/board views specifically, because (a) it is the direct, battle-tested successor to the tool this exact use case (Trello-style boards) was built for, (b) its incremental-adoption model keeps bundle cost near zero until a feature is actually used, and (c) it isn't locked to React, which matters if any sub-team ends up needing a lighter-weight kiosk/TV-display view. dnd-kit remains a reasonable second choice if the team is more comfortable with its more "React-native" hooks API — both are legitimate; just don't default to react-beautiful-dnd out of habit or old tutorials (a lot of 2022–2024 kanban tutorials still reference it and are now stale).

## Gantt / timeline

| Option | License | Fit |
|---|---|---|
| **Frappe Gantt** | MIT, zero dependencies, vanilla JS | Lightweight, drag-to-reschedule, day/week/month/year views. No resource view, no critical path, minimal customization ceiling. Good for a simple "project has a start/end and milestones" view; not for real scheduling. |
| **SVAR Gantt (React)** | MIT core (free, commercial-use-ok) + PRO commercial tier | 260K+ monthly npm downloads. Free tier: drag-and-drop, dependency links, virtualization for thousands of tasks, keyboard support, SSR/Next.js support. PRO adds calendar-aware scheduling (working days/holidays), critical path, resource workload view, auto-scheduling, and MS Project/Excel/PDF export. This is the most React-native, actively-developed open option today. |
| **Bryntum Gantt** | Commercial only, proprietary | Positions itself as "the fastest JS Gantt," full scheduling engine, 50+ widgets, exports to MS Project/Excel/PDF/ICS. Aimed at enterprise PM tools. Meaningful licensing cost, likely per-developer; only worth it if the department later runs multi-project resource-constrained scheduling (Phase 3 territory), not for Phase 1. |
| **gantt-task-react** | MIT | Simple React component; original maintainer's activity slowed and the community has needed to fork/patch it for newer React versions — a maintenance-risk pick, avoid as a long-term dependency. |
| **Custom SVG/CSS-grid timeline** | — | What Linear and Height actually do: a horizontal time axis, rows as swimlanes, cards as absolutely-positioned divs sized by CSS grid or SVG rects, virtualized on both axes. Zero dependency risk, exact visual control, but real engineering effort (drag-to-resize, dependency lines, zoom levels are all DIY). |

**Linear/Height timeline UX to copy regardless of library**: minimal chrome (no gridlines by default, they appear on hover/zoom), smooth pinch/scroll-wheel zoom between day/week/month/quarter granularity, "today" line always visible, milestones as diamonds not bars, and — critically — the timeline is a *view* of the same task data as the list/board views, not a separate data model. That last point is the actual product lesson: don't build a Gantt as a bolt-on feature with its own task schema; make it a rendering mode over the same "project has tasks with dates" data the table and kanban views already use.

**Recommendation**: Phase 1, skip Gantt entirely — the reference site's projects register (status chip + progress % + deadline + weekly comment) doesn't need one. Phase 2, build a small custom timeline component (cheap, matches editorial visual tone) for the department roadmap view. Only adopt SVAR PRO or Bryntum if Phase 3 delivers real cross-project resource scheduling.

## Calendars

| Library | License | Notes |
|---|---|---|
| **FullCalendar** | MIT core + commercial "Scheduler" plugin | Industry default, most mature, largest ecosystem/Stack Overflow coverage. Free tier covers month/week/day/list views, drag-drop, recurring events — enough for an Activities/RSVP module. **Resource timeline and vertical resource views require the paid Scheduler license** (same paywall pattern as the Gantt vendors: "compare multiple resources side-by-side" is always premium). |
| **Schedule-X** | Modern alternative, explicitly markets itself against FullCalendar | v4, multi-framework (React/Vue/Angular/Svelte/Preact), dark mode and i18n built in, plugin architecture (drag-to-create, sidebar, recurrence, scheduling assistant, resource/Gantt views). Premium tier exists for pre-built modals/resource views but the free core is more capable out of the box than FullCalendar's free core. Newer and smaller community — more integration risk, less Stack Overflow coverage, but worth a hands-on spike given our i18n requirement (Uzbek/Russian/English) is a first-class feature here rather than an afterthought. |
| **react-big-calendar** | MIT | Simpler, React-only, commonly used, historically had slower maintenance cadence; adequate for a basic month/week view but weaker on drag-resize polish. |
| **Toast UI Calendar** | MIT (NHN) | Feature-rich, but NHN's Toast UI suite has visibly deprioritized maintenance in recent years — a bus-factor concern for a multi-year government system. |
| **Notion Calendar / Amie (UX reference, not a library)** | — | Worth studying, not adopting: keyboard-first event creation (type a time range in natural language), calendar color-coding by source/person, one-click "join call," and a minimalist week view that hides weekends by default for work calendars. These are UX patterns to imitate in our Activities module, not products to embed. |

**Recommendation**: FullCalendar free tier for the Activities/RSVP calendar and any personal leave calendar (Phase 2) — it's the safe, boring choice with the largest support surface. Spike Schedule-X in parallel given our multi-language requirement; if its i18n and theming prove meaningfully less painful, switch before Phase 2 is deep. Budget for FullCalendar Scheduler (or equivalent) only when/if a "who's out this week across all 4 sub-departments" resource-timeline view is requested.

## Org charts

- **d3-org-chart (bumbeishvili)**: MIT, purpose-built for exactly our "Director → 4 sub-departments → people" hierarchy: expand/collapse nodes, multiple orientations, export, framework wrappers for React/Vue/Angular. 1.2k★ but a single active maintainer and 133 open issues — real bus-factor risk for a government system meant to last years; mitigate by vendoring/forking the small codebase rather than depending on upstream releases indefinitely.
- **React Flow / xyflow**: MIT core + optional paid Pro tier (templates/support, not gating core features). General-purpose node/edge canvas — used by Stripe, Typeform, and workflow-builder products — not an org-chart component per se, but the right tool if we later need process-flow diagrams, approval-chain visualizations, or dependency graphs beyond a strict tree. Ships examples wiring in **dagre** and **ELK.js** for auto-layout.
- **dagre vs ELK**: dagre is fast and simple for small-to-medium DAGs but produces visually cruder layered layouts; ELK (via `elkjs`, a JS port of the Eclipse Layout Kernel) gives much better layered/orthogonal layouts and more layout algorithm choices, at the cost of being slower and more configuration-heavy. For a 23-person, 4-unit org chart, either is overkill — a static/precomputed tree layout is trivial by hand. ELK becomes relevant only if we build a general workflow/approval-diagram feature later, or if this expands to a ministry-wide org chart with hundreds of nodes needing automatic layout.
- **Expanding to thousands of nodes**: neither React Flow nor d3-org-chart virtualizes off-screen nodes by default — past roughly 500–1,000 simultaneously-rendered nodes, both need manual viewport-based culling or you get real frame-rate drops. Relevant if this platform truly "goes viral" to other ministries and someone tries to render an entire ministry org chart (hundreds of staff) on one canvas — plan for a collapsed-by-default, drill-down interaction model (a la org chart apps like Pingboard) rather than "render everyone at once," which sidesteps the virtualization problem entirely and is also just better UX for a human trying to understand a hierarchy.

**Recommendation**: d3-org-chart (vendored) for the literal Organization page; do not reach for React Flow until a genuinely graph-shaped (not tree-shaped) visualization is needed.

## Charts / KPI visualization

| Library | License | Best for | Watch out for |
|---|---|---|---|
| **Recharts** | MIT | React-idiomatic, composable, the default choice for dashboards; what shadcn's chart components wrap | Each data point is a real SVG DOM node — performance degrades noticeably past roughly 1,000–2,000 points per chart. Fine for KPI/trend charts (weekly/monthly aggregates), wrong for rendering raw high-frequency time series. |
| **shadcn/ui charts** | MIT (copy-paste, not an npm dependency) | Thin, Tailwind-themed wrapper around Recharts, distributed as source you own | Since the reference prototype already uses shadcn/ui-style CSS variables (`--primary`, `--card`, `--radius`, etc.), this is close to a drop-in visual match — strong argument for standardizing on it rather than introducing a second design language via a different chart library. |
| **visx (Airbnb)** | MIT | Low-level D3+React primitives when you need a genuinely custom, novel chart type (e.g., a bespoke EGDI ranking visualization) | Steep learning curve — you build the axes, scales, and interactions yourself. Wrong default for routine bar/line/KPI charts; right tool for the one or two "signature" visualizations that make the product feel bespoke rather than templated. |
| **Nivo** | MIT | Batteries-included, good default theming, both SVG and Canvas render modes | Less flexible than visx, heavier than Recharts; a reasonable middle option but doesn't clearly beat "Recharts for standard + visx for bespoke." |
| **Apache ECharts** | Apache-2.0 | Genuinely large datasets — claims real-time rendering of ~10M data points via Canvas/WebGL, 20+ chart types, built-in accessibility descriptions and decal (texture) patterns as a colorblind-safe alternative to color alone | Config-object API (not idiomatic React), and the full bundle is heavy (order of ~1MB) — must tree-shake to only the chart types used. Reach for this only if a specific dashboard (e.g., a national EGDI/index comparison across dozens of countries and years) needs true big-data rendering; otherwise it's disproportionate weight for a government network where not everyone has fast connectivity. |
| **Observable Plot** | ISC (MIT-like) | Fast, concise "grammar of graphics" API for exploratory/statistical charts (a data analyst prototyping a new report) | Less suited to interactive, stateful dashboard widgets (tooltips/zoom/click-to-filter require more manual wiring than Recharts). Good fit for the Data & BI Analytics sub-department's own exploratory work, not for the shared department dashboard. |
| **Tremor** | Apache-2.0 | Pre-built dashboard blocks (KPI cards, bar lists, spark areas) built on Recharts + Tailwind | Useful accelerant for the Overview page specifically; overlaps with shadcn charts, so pick one convention and stick to it rather than mixing two "dashboard kit" aesthetics. |

**Recommendation**: standardize on Recharts via shadcn's chart components for all routine KPI/trend visualization (matches existing visual language, MIT, good-enough performance for weekly/monthly aggregated department data). Reserve visx for one or two bespoke, signature visualizations. Only bring in ECharts if a specific feature (e.g., a global EGDI ranking explorer with hundreds of countries × years of data) genuinely needs it — gate that decision behind an actual performance problem, not speculatively.

## KPI/dashboard UX — what civil servants actually read

Cross-referencing the reference prototype's Overview page against general dashboard-usability findings (Nielsen Norman Group and similar practice, consistent with GOV.UK's own service-design guidance on data tables/charts):

- People scan a dashboard for **status, not analysis** — "is this okay or not okay" in under 5 seconds, which is exactly what the reference site's KPI cards already do (big number, one supporting delta line, a progress bar). Keep that pattern; don't add secondary metrics to the same card.
- **5–7 KPIs per screen is the practical ceiling** before it stops being a "dashboard" and starts being a "report." The reference Overview page's 4 KPI cards + 3 quarterly-objective bars is already close to right; resist the urge to add more tiles as more data becomes available — add drill-down instead.
- Government/GOV.UK accessibility guidance is explicit: never encode meaning in color alone (status chips need text + color, which the reference already does with "On track / At risk / Blocked" labels, not just colored dots), right-align numeric columns, and provide a text/table alternative wherever a chart carries decision-relevant information — directly relevant given eventual WCAG/EN 301 549-style obligations for a government system.
- **Progressive disclosure over pagination**: click a KPI card to drill into the underlying table/filtered view, rather than routing to a separate unrelated page — this is the actual mechanism that makes "5-second dashboard" and "Jira-level power underneath" coexist: the summary view is deliberately shallow, and depth is one click away, not baked into the summary.

## Inline editing, filters, saved views, bulk actions, keyboard nav (Notion/Airtable/Linear patterns)

- **Inline cell editing**: single click selects a cell (Excel-style focus ring), Enter or double-click enters edit mode, Tab/Shift+Tab moves horizontally and commits, Enter moves down and commits, Escape cancels without saving. This exact model (not a modal "edit" form) is what makes Airtable/Notion tables feel fast — a modal-per-edit pattern is the single biggest source of "this feels like enterprise software" complaints in software review discussions of Jira-style tools, and directly contradicts our "zero-training" goal.
- **Property-type-aware editing**: a status field opens a select dropdown with colored pills, a date field opens a calendar picker, a person field opens a searchable people-picker scoped to the org chart data — reusing the same underlying components as the sitewide People directory and Organization data. This is a data-model argument as much as a UI one: model status/person/date as typed properties once, and every table/board/detail view in the app gets consistent editors for free.
- **Filter bar (Linear-style)**: filters render as removable pill/chips in a horizontal bar ("Status: On track, At risk" · "Owner: me" · "+ Filter"), not a sidebar form; each pill opens a small popover with the operator and value. Multiple filters combine with implicit AND; grouping ("group by sub-department") is a separate control from filtering. This is more discoverable for a first-time user than Notion's heavier filter-builder modal, and is worth copying closely for the Projects register.
- **Saved views**: a view = a saved combination of filter + sort + group + visible columns, named and pinned (e.g., "My team's at-risk projects"). Distinguish personal views (private) from shared/default views (set by the sub-department lead) — this maps directly onto the reference site's "unit heads approve" governance idea from its own roadmap section.
- **Bulk actions**: checkbox column appears on hover/selection; selecting any row reveals a floating action bar (bottom or top) with the available bulk operations (change status, reassign owner, escalate); Shift+click selects a range, Cmd/Ctrl+click toggles individual rows, Cmd/Ctrl+A selects all visible (with a "select all 214 matching" affordance when the list is filtered/paginated, distinguishing "select all visible" from "select all matching filter" — a real Airtable/Linear pattern, and a common bug source when apps don't distinguish the two).
- **Keyboard navigation**: arrow keys move focus between rows/cells; Linear-style single-letter mnemonics (e.g., a key to open the status menu, a key to assign) let power users triage a list without a mouse; "j/k" vim-style up/down is a smaller but real power-user convention (Linear, Superhuman, Gmail with "keyboard shortcuts on") worth supporting as opt-in, not default, since it will bewilder a first-time civil servant if it's the primary interaction model. A command palette (Cmd/Ctrl+K) for "jump to project / create task / go to person" scales far better for a non-technical user than memorized shortcuts, and is the single highest-leverage keyboard feature to build first.
- **Mobile equivalents**: kanban drag becomes a "Move to…" action sheet triggered from a card's overflow menu (touch drag-and-drop is unreliable and inaccessible on small screens — this is exactly why pragmatic-drag-and-drop and dnd-kit both invest heavily in non-pointer interaction models); dense tables become stacked card lists with the 2–3 most important fields promoted and the rest behind a "details" expand; Gantt/timeline views are typically hidden entirely on mobile behind a simplified list, because no Gantt UX genuinely works below ~600px; filters collapse into a single "Filters" button opening a full-screen sheet rather than an inline bar.

## Known failure modes and negative evidence (explicitly hunted for)

1. **react-beautiful-dnd's archival (Aug 2025)** is the clearest cautionary tale in this whole survey: a widely-tutorialized, seemingly-safe library was retired by its own maintainer because its architecture didn't scale to the exact use case (Trello/Jira-style boards) it was famous for. Lesson: don't pick a UI dependency based on tutorial/Stack-Overflow popularity alone; check current maintenance status before building on it.
2. **Every commercial grid/calendar/Gantt vendor draws the same paywall line**: grouping+aggregation, resource-timeline views, and Excel/MS-Project export are Enterprise/Premium/Pro across AG Grid, MUI X, and FullCalendar independently. This is a strong signal these are genuinely expensive-to-build features, not artificial upsell — budget for them explicitly rather than assuming an open-source library will eventually add them for free.
3. **Glide Data Grid's self-disclosed accessibility gap** is a direct disqualifier for a government system with accessibility obligations, however tempting its raw performance numbers are. This is the single most important "avoid" in this report.
4. **Canvas/single-maintainer bus-factor risk** (d3-org-chart's 133 open issues under one active maintainer; gantt-task-react's stalled maintenance) is a real risk category for a multi-year government platform — mitigate by vendoring small, focused libraries rather than depending on continued upstream releases.
5. **Dense-grid tools get rejected by non-technical government users for feeling like "Excel with extra steps."** This is exactly the tension the product owner already named; the mitigation isn't a different grid library, it's information architecture — most people should never see the dense table view at all, only the KPI/summary/board views, with the table as a power-user mode reached deliberately.
6. **"Everything is a block" (Notion's own architecture) has known performance complaints at scale** — pages with thousands of blocks/rows slow down noticeably. Relevant because "Notion-level flexibility" is an explicit design goal here: flexibility-by-generic-blocks is not free, and a more structured (typed-property, database-first) data model, closer to Airtable's or Linear's, scales better than Notion's fully-freeform block model for the kind of operational record-keeping (projects, people, activities) this platform is actually for.

## What this means for us

1. **[ADOPT] TanStack Table (headless) + TanStack Virtual for every dense table** (People directory, Projects register). Why: MIT, no seat licensing, and headless means it renders inside our own shadcn-style design system instead of imposing a second visual language.
2. **[AVOID] AG Grid Enterprise and MUI X Premium as a Phase-1 default.** Why: their differentiators (grouping/pivot/export) aren't needed for a 23-person department yet; re-evaluate only when a specific ministry-reporting export requirement appears.
3. **[AVOID] Glide Data Grid anywhere a screen-reader user might need to work.** Why: the maintainers themselves flag unresolved accessibility gaps, which is incompatible with a government platform's obligations — even before any formal WCAG audit requirement is confirmed.
4. **[ADOPT] Atlassian's pragmatic-drag-and-drop for the Kanban/board views.** Why: it's the direct, production-proven successor to react-beautiful-dnd (which is now archived), built for exactly this Trello/Jira-style use case, and framework-agnostic if a lightweight non-React view (e.g., a TV/kiosk status board) is ever wanted.
5. **[AVOID] react-beautiful-dnd outright**, including copying patterns from older tutorials that reference it. Why: archived and deprecated as of August 2025; new code on it is immediate technical debt.
6. **[ADAPT] Build a custom SVG/CSS-grid timeline for the department roadmap rather than adopting a full Gantt library in Phase 1.** Why: our actual need (project start/end + milestones on a shared timeline, à la Linear) is much simpler than what Gantt libraries solve (dependencies, critical path, resource leveling); a small custom component keeps visual control and avoids a licensing decision we're not ready to make.
7. **[ADAPT] Reconsider SVAR Gantt (MIT core) only if/when Phase 3 genuinely needs dependency scheduling**; skip Bryntum unless a dedicated planning function with real budget emerges. Why: cost and complexity should follow proven need, not anticipated need.
8. **[ADOPT] FullCalendar (free/MIT tier) for the Activities/RSVP calendar.** Why: safest, most-documented option for a first release; defer the paid Scheduler/resource-timeline tier until a specific "compare people/rooms side by side" feature is requested.
9. **[ADAPT] Prototype Schedule-X in parallel before committing long-term**, specifically because of our three-language requirement. Why: i18n and theming are first-class in Schedule-X's design rather than retrofitted, which matters more to us than FullCalendar's larger ecosystem given Uzbek/Russian/English is non-negotiable.
10. **[ADOPT] d3-org-chart (vendored into our own repo, not left as a live upstream dependency) for the Organization page.** Why: purpose-built for exactly our tree shape; vendoring mitigates the single-maintainer bus-factor risk directly.
11. **[AVOID] React Flow/xyflow for the org chart specifically**; reserve it for a possible future general workflow/approval-diagram feature. Why: it's a general graph-canvas tool, more powerful and more complex than a strict-hierarchy org chart needs.
12. **[ADOPT] Recharts via shadcn/ui chart components as the single default charting approach.** Why: it already matches the reference prototype's shadcn-style CSS variables, keeps one visual language across the app, and copy-paste-not-npm-dependency ownership fits a long-lived government codebase better than a black-box chart package.
13. **[AVOID] Apache ECharts as a default**, despite its impressive raw performance; **[ADAPT]** keep it in reserve for one specific big-data visualization (e.g., a global EGDI index explorer) if that feature is greenlit. Why: ~1MB bundle weight and non-React config-object API are real costs that shouldn't be paid app-wide for a need that's currently hypothetical.
14. **[ADOPT] Progressive disclosure as the core dashboard principle**: KPI cards on Overview link into pre-filtered table/board views rather than duplicating data or adding more tiles. Why: this is the actual mechanism — not a component choice — that resolves the "Jira power without Jira learning curve" tension named in the brief.
15. **[ADOPT] Cmd/Ctrl+K command palette before any other keyboard-shortcut investment**, with vim-style (j/k) and single-letter mnemonics as opt-in power-user layers, not defaults. Why: a command palette scales to a first-time user (typing "create project" is self-explanatory) in a way memorized shortcuts never do, directly serving the "first-time civil servant must understand it without training" requirement.

## Open questions

- Is WCAG 2.1 AA (or an Uzbekistan/EAEU-specific equivalent) a formally mandated accessibility bar for this platform, or a best-practice goal? This materially changes how hard a blocker Glide Data Grid (and any canvas-based component) actually is.
- Does the ministry's network/device reality (older machines, lower bandwidth in some regional offices) impose a bundle-size budget? This would tip several close calls (ECharts vs Recharts, AG Grid full build vs modular) toward the lighter option.
- Will this platform ever need true resource-constrained project scheduling (multiple people, limited hours, dependency chains), or does "project has an owner, a status, a deadline, and a weekly comment" (the reference site's actual model) remain sufficient indefinitely? This is the single decision that determines whether any Gantt library spend is ever justified.
- What is the realistic upper bound on org-chart size if this "goes viral" to other ministries — tens of people (current department), hundreds (one ministry), or thousands (whole-of-government)? This determines whether d3-org-chart's un-virtualized rendering remains adequate or whether a drill-down/collapsed-by-default architecture must be designed in from day one.
- Do we have (or need) a design-system decision between shadcn/ui+Tailwind vs MUI before component selection is finalized? Several recommendations above (Recharts/shadcn-charts over MUI X charts, TanStack Table headless over AG Grid's own chrome) assume the shadcn/Tailwind direction implied by the reference prototype; an MUI-based direction would flip several of these calls toward the MUI X family for visual consistency.
- Is a Telegram-based or Telegram-adjacent interface (given its dominance in Uzbekistan) expected to carry any of these data-dense views (e.g., a status digest, an RSVP button), and if so, which of these components need a bot/webview-safe rendering path in addition to a full web one?

## Sources

- [TanStack Table](https://tanstack.com/table/latest)
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [AG Grid Licensing](https://www.ag-grid.com/react-data-grid/licensing/)
- [MUI X Data Grid](https://mui.com/x/react-data-grid/)
- [Glide Data Grid (GitHub)](https://github.com/glideapps/glide-data-grid)
- [react-window (GitHub)](https://github.com/bvaughn/react-window)
- [dnd-kit (GitHub)](https://github.com/clauderic/dnd-kit)
- [pragmatic-drag-and-drop (GitHub, Atlassian)](https://github.com/atlassian/pragmatic-drag-and-drop)
- [react-beautiful-dnd (GitHub, archived)](https://github.com/atlassian/react-beautiful-dnd)
- [Frappe Gantt](https://frappe.io/gantt)
- [SVAR React Gantt](https://svar.dev/react/gantt/)
- [Bryntum Gantt](https://bryntum.com/products/gantt/)
- [Schedule-X](https://schedule-x.dev/)
- [FullCalendar Premium licensing](https://fullcalendar.io/docs/premium)
- [React Flow (xyflow)](https://reactflow.dev/)
- [d3-org-chart (GitHub)](https://github.com/bumbeishvili/org-chart)
- [Apache ECharts](https://echarts.apache.org/en/index.html)
- [shadcn/ui Charts](https://ui.shadcn.com/charts)
- [GOV.UK Design System — Table component](https://design-system.service.gov.uk/components/table/)

## Editor's verification notes (data-dense-ui-components)

### 1. Missing, thin, or hand-waved topics

- **Spreadsheet-like grids as a distinct topic.** The brief explicitly lists "spreadsheet-like grids" alongside inline editing, but the report never treats it as its own thing — no discussion of multi-cell range selection, copy/paste in and out of Excel (paste a block of cells from Excel into the grid and have it split into rows/columns), fill-handle/drag-to-fill, or undo/redo stacks for bulk edits. This matters specifically because the ministry context implies people will want to paste data from Excel exports into the Projects/People registers; TanStack Table + react-data-grid's actual clipboard/range-selection support (or lack of it) was never checked.
- **Mobile equivalents "of each."** The brief asks for mobile treatment of every component category; the report gives one generic paragraph (kanban → action sheet, tables → card list, Gantt → hidden, filters → sheet) but never addresses mobile for calendars (does FullCalendar's or Schedule-X's mobile rendering actually work well, or do these need a separate mobile calendar component?), org charts on a phone screen (a 4-branch tree is already awkward at 375px), or charts on mobile (Recharts responsive container behavior, touch tooltips).
- **Server-side / paginated data model for TanStack Table.** The report recommends TanStack Table + Virtual for "every dense table" but only discusses AG Grid's Enterprise-only server-side row model as a paywall feature. It never explains how the recommended stack (TanStack Table Community) handles server-side pagination/sorting/filtering once the People or Projects register outgrows client-side loading — this is a real gap for a "scalable, multi-tenant, ministry-wide" ambition, not a hypothetical.
- **Real-time/multi-user editing conflicts.** Inline editing patterns are described in single-user terms (click, edit, commit). Nothing addresses what happens when two staff edit the same project row concurrently (optimistic UI, last-write-wins, presence indicators, websocket sync) — a genuine requirement once this "goes viral" beyond one department.
- **Testing/QA tooling for these components.** No mention of automated accessibility testing (axe-core, Playwright a11y assertions) or visual regression testing for data-dense views, despite accessibility being called a hard requirement throughout the report.
- **Print/PDF export for government reporting.** Excel export is discussed as a paywall feature, but print stylesheets / "generate a PDF report for the ministry" — a very plausible ask in a Uzbek government context — is not addressed at all.
- **Concrete bundle-size numbers are frequently vague** ("hundreds of KB," "~1MB," "~10-45KB depending on features") rather than measured — acceptable for a survey but should be flagged as approximate, not treated as settled numbers when a real bundle budget decision is made later (the report's own Open Questions section correctly flags this ambiguity, which is good, but the table rows upstream read more confidently than the underlying evidence supports).

Adjacent topics a senior product/engineering lead would expect and that are absent:

1. **Offline / low-bandwidth resilience.** Given the report's own aside about "a government network where not everyone has fast connectivity" and the brief's regional-office reality, there is no discussion of offline-first patterns, optimistic caching, or graceful degradation for any of these data-dense views.
2. **Internationalization mechanics beyond calendars.** Uzbek (Latin)/Russian/English is called out for Schedule-X specifically, but number formatting, date formatting (Intl.NumberFormat/Intl.DateTimeFormat), and RTL-adjacent locale quirks are not addressed for tables, charts, or org charts, which also render locale-sensitive text and numbers.
3. **Design tokens / theming consistency layer across libraries.** The report notes shadcn CSS variables repeatedly as a reason to prefer certain libraries, but never states the actual mechanism for forcing a non-shadcn-native library (e.g., d3-org-chart, SVAR, FullCalendar) to inherit the same design tokens — this is exactly the kind of integration risk that turns into weeks of CSS-override work.
4. **Data-model/schema implications of the "typed properties" recommendation** — the report says "model status/person/date as typed properties once" but doesn't connect this to a specific backend/schema pattern (e.g., is this a Notion/Airtable-style meta-schema table, or literal typed DB columns?) even though this is the single biggest architectural decision implied by section 91-98.

### 2. Spot-checks (5 consequential claims)

| # | Claim in report | Method | Result |
|---|---|---|---|
| 1 | react-beautiful-dnd archived **August 2025**, deprecated on npm, README points to pragmatic-drag-and-drop | WebFetch github.com/atlassian/react-beautiful-dnd | **CONFIRMED** — archived August 18, 2025; README explicitly deprecated and redirects to Pragmatic Drag and Drop. |
| 2 | AG Grid Enterprise license is **per-developer, per-deployment**, one year of updates+support included; Community is MIT | WebFetch ag-grid.com/react-data-grid/licensing | **CONFIRMED** — "Licences for AG Grid Enterprise are available on a per-developer, per-deployment basis," perpetual license with one year of support/updates. |
| 3 | MUI X: column pinning + tree data behind **Pro**; row grouping + aggregation + Excel export behind **Premium**; virtualization "at scale" is Pro | WebFetch mui.com/x/react-data-grid | **CONFIRMED** (with a nuance) — Pro adds advanced filtering, column pinning, reordering, tree data, and virtualization; Premium adds row grouping/aggregation and Excel export. The report's phrasing "virtualization-at-scale sit behind Pro" is accurate — basic virtualization exists in Community, but the docs source used groups virtualization under Pro's feature list, so the report's characterization is directionally correct but slightly overstated (Community already virtualizes rows to a real degree). Flagged as a minor overstatement, not a material error. |
| 4 | FullCalendar: resource timeline and **vertical resource views require paid Scheduler license**; free core covers month/week/day/list, drag-drop, recurring events | WebFetch fullcalendar.io/docs/premium | **CONFIRMED** — both "Timeline View" and "Vertical Resource View" are listed as Premium plugins requiring the Scheduler license. |
| 5 | pragmatic-drag-and-drop core bundle **~4.7KB**, framework-agnostic, Apache-2.0 license | WebFetch github.com/atlassian/pragmatic-drag-and-drop | **PARTIALLY CONFIRMED** — the ~4.7KB core-bundle figure and framework-agnostic claim are confirmed directly from the repo. The Apache-2.0 license claim could not be independently re-confirmed from the fetched page content (the LICENSE file wasn't rendered in the fetch), though it is consistent with Atlassian's standard open-source licensing for this family of projects and matches the report's parallel claim about react-beautiful-dnd's own Apache-2.0 license. **Unverifiable via this pass — recommend a direct check of the repo's LICENSE file before treating it as settled for a procurement/legal review.** |

No claim among the five spot-checked was found to be materially wrong. One (MUI X virtualization tier) is a minor overstatement worth a footnote; one (pragmatic-drag-and-drop's exact license) is unverified rather than wrong.

### 3. Overall assessment

The report is unusually strong for a first pass: it has a real point of view (not just a feature-matrix dump), correctly identifies the cross-vendor "grouping/export is always the paywall line" pattern, and its "What this means for us" section is concrete and decision-ready. The gaps identified above are real but narrow — mostly extensions of what's already there (spreadsheet clipboard behavior, server-side pagination for the recommended stack, mobile treatment "of each" component, offline resilience) rather than wrong turns. None of the five spot-checked factual claims were wrong; the one overstatement (MUI X virtualization tier framing) and one unverifiable item (pragmatic-drag-and-drop's exact license) are minor, not material.

## Gap-fill addendum (2026-09-05)

Method: every gap flagged in the Editor's verification notes above was re-researched live on 2026-09-05, primarily via direct reads of official docs, GitHub source/releases/LICENSE files, and the npm/jsdelivr/bundlephobia registry APIs (package-version and bundle-size claims below are registry-sourced, not estimated). This pass used 30+ WebSearch queries and 60+ WebFetch reads across seven parallel research streams before the session's WebSearch budget was exhausted; the remainder relied on direct registry/GitHub/docs fetches, which for version/license/size facts is arguably a harder source than search snippets anyway. Every version number below is dated; treat anything without a fetch date as the report's own synthesis, not a new primary-source claim. Where a sub-finding could not be independently confirmed, it is marked **unconfirmed** rather than stated as fact, per this report's own verification standard.

### A. Version corrections and additions since the original pass

The stack has moved since the base report was written. None of the base report's *recommendations* are invalidated by this, but several version numbers it implied are now stale enough to matter for a bundle-size or breaking-change decision:

| Library | Base report implied | Confirmed current (2026-09-05) | Why it matters |
|---|---|---|---|
| **TanStack Table** | "v8 stable, v9 in active rollout" | `@tanstack/react-table` npm `latest` dist-tag is now **v9.2.4** (published 2026-08-28); v8.21.3 still receives maintenance patches for teams not ready to move | Gzip **more than doubled** moving v8→v9 (~13.8 KB → ~31.0 KB per bundlephobia's API, checked live) — re-budget if bundle size is a hard constraint for regional-office bandwidth |
| **FullCalendar** | version unstated | **v7.0.0 GA shipped 2026-06-19**; v7.1.0 exists with a release timestamp of "today" (2026-09-05) — **unconfirmed** whether that's a real same-day release or a relative-time rendering artifact, re-verify via `npm view @fullcalendar/react versions` before pinning. v6.1.21 (2026-06-18) remains patched for teams not ready for v7 | v7 rewrites the React connector fully in React (real SSR + StrictMode support, useful for Vite/React 19), renames the vanilla core package `@fullcalendar/core` → `fullcalendar`, drops bundled CSS for a formal theme system with 4 stock themes plus documented Tailwind compatibility, and swaps `moment-timezone` for a `temporal-polyfill` peer dependency |
| **Schedule-X** | already correctly said "v4" | `@schedule-x/calendar` npm latest is **4.7.0** (a 4.6.1 was also observed within the same week — pin the exact patch at implementation time) | **New and consequential**: Schedule-X v4.0.0 (2026-01-15) **removed drag-and-drop and event resize from the open-source package** and moved them into a paid `@sx-premium` add-on. If WorkPortal's Activities calendar needs drag-to-reschedule, that is no longer free in current Schedule-X — this changes the FullCalendar-vs-Schedule-X calculus the base report left open |
| **react-data-grid** | "adazzle/react-data-grid" | Package moved to **`github.com/Comcast/react-data-grid`** (old `adazzle` org 302-redirects); npm name unchanged. Still **v7.0.0-beta.61** (2026-07-14) — has been in beta for a long cycle | Cite the new org going forward; treat v7 as not-yet-stable for a government procurement decision |
| **pragmatic-drag-and-drop** | Apache-2.0, **unverified** per the spot-check | **Now directly confirmed**: raw `LICENSE` file at `github.com/atlassian/pragmatic-drag-and-drop` opens "Copyright 2024 Atlassian Pty Ltd" / "Licensed under the Apache License, Version 2.0" | Closes the one open item from the original spot-check table. Core is now at **3.1.0** (2026-08-29); companion packages `-hitbox` 2.2.0, `-live-region` 2.1.0, `-react-accessibility` 3.2.0 (React 19-compatible), `-react-beautiful-dnd-migration` 3.4.1 (2026-09-03) — all actively, recently published |
| **d3-org-chart** | "1.2k★, single maintainer, 133 open issues" | Still accurate directionally (now **1,211★, 379 forks, 137 open issues**, single maintainer `bumbeishvili` holds 279/283 commits) — **but the npm package itself has not been published since 2023-09-18** (stuck at v3.1.1) while the GitHub repo still receives occasional commits (last push 2026-07-08) | This sharpens the base report's own "vendor, don't depend on upstream" recommendation into something more specific: **vendor from GitHub `src/`, not from the 3-year-stale npm package**, or you ship a version that's missing several years of fixes |
| **Recharts** | "Recharts/shadcn-charts" | Confirmed **v3.10.1** (2026-07-25); v3.0.0 itself shipped 2025-06-23, so it's over a year mature, not bleeding-edge | v3 quietly changed its animation engine (dropped the `react-smooth` dependency for a bespoke controller on a new Redux-based store) and turned on `accessibilityLayer` (keyboard chart navigation) **by default** — both are new, positive facts the base report couldn't have known and are worth citing when justifying the Recharts recommendation |
| **tldraw** (not covered in the base report — a gap, see §K) | — | `tldraw` npm license field is literally `"SEE LICENSE IN LICENSE.md"`, **not MIT** | Material for the new canvas section below |

### B. Data table — spreadsheet behavior, server-side data, and updated bundle sizes

**Spreadsheet-like grid behavior is confirmed absent from TanStack Table, by TanStack's own maintainers/community — not inferred.** TanStack/table discussion #3963 states spreadsheet features are explicitly out of scope for a headless library; issue #3636 ("range select on table") was opened in 2022 and **closed without a core feature ever landing**; discussion #5613 shows a developer bolting on cell-range-selection, copy/paste, and edit history via a bespoke hook (shared only as a CodeSandbox, never published as a package); discussion #3879 ("copy/paste into Excel without losing format") sits unanswered. **Conclusion for WorkPortal: if pasting a block of cells from an Excel export into the Projects/People register is a real requirement, TanStack Table needs a hand-rolled clipboard layer — it will not arrive from upstream.**

`react-data-grid` (MIT, now Comcast-maintained, v7.0.0-beta.61, 15.3 KB gzip) is closer but not a drop-in either: its README advertises "cell copy/pasting" and "cell value dragging/filling," but the actual API is **per-cell, not a true multi-cell range API**:

```ts
// react-data-grid v7 clipboard/fill callbacks — per-cell, not range-based
onCellPaste?: (args: CellPasteArgs<Row>, event: CellClipboardEvent) => Row // return the updated row
onCellCopy?: (args: CellCopyArgs<Row>, event: CellClipboardEvent) => void
onFill?: (event: FillEvent<Row>) => Row // drag-to-fill; disabled on TreeDataGrid
```
Notably, an older, more automatic clipboard API (`enableCellCopyPaste`, `enableCellDragAndDrop`) was **deliberately removed** in a later major version in favor of this lower-level callback shape — the library's clipboard ergonomics got more manual over time, not less. A minimal Excel-paste handler on top of either grid follows the same shape regardless of library:

```ts
document.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  const grid = text.replace(/\r/g, '').split('\n').filter(Boolean).map(r => r.split('\t'));
  const startColIdx = columns.findIndex(c => c.id === anchor.columnId);
  setData(prev => {
    const next = structuredClone(prev);
    grid.forEach((row, dr) => row.forEach((val, dc) => {
      const r = anchor.rowIndex + dr, c = startColIdx + dc;
      if (next[r] && columns[c]) next[r][columns[c].id] = val;
    }));
    return next;
  });
});
```

**Server-side pagination/sorting/filtering is a free (MIT) TanStack Table feature, confirmed live from `tanstack.com/table/latest/docs/framework/react/guide/pagination` — there is no Enterprise gate here at all**, unlike AG Grid:

```ts
const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
const { data, rowCount } = useProjectsQuery(pagination, sorting, columnFilters); // your API call

const table = useReactTable({
  data, columns,
  state: { pagination, sorting, columnFilters },
  onPaginationChange: setPagination,
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  manualPagination: true,
  manualSorting: true,
  manualFiltering: true,
  rowCount, // table computes pageCount from this
  getCoreRowModel: getCoreRowModel(),
});
```
Pair this with TanStack Query by folding `pagination`/`sorting`/`columnFilters` straight into the query key (`['projects', pagination, sorting, columnFilters]`) so a state change triggers a refetch — the standard "server-driven table" shape. v9's docs additionally suggest external atoms for finer-grained subscriptions as an alternative to the `onXChange`+`state` pattern above, worth a look once v9 is actually adopted.

**Concrete, dated bundle sizes** (bundlephobia API, checked 2026-09-05 — replaces the base report's "hundreds of KB"/"~1MB" approximations):

| Package | Version | Gzip | License |
|---|---|---|---|
| `@tanstack/react-table` | 9.2.4 | ~31.0 KB | MIT |
| `@tanstack/react-table` | 8.21.3 (for contrast) | ~13.8 KB | MIT |
| `@tanstack/react-virtual` | 3.14.10 | ~7.2 KB | MIT |
| `react-data-grid` | 7.0.0-beta.61 | ~15.3 KB | MIT |
| `@mui/x-data-grid` | 9.13.0 | ~120.6 KB | MIT (Community) |
| `ag-grid-community` | 36.1.0 | ~353.8 KB | MIT |
| `ag-grid-enterprise` | 36.1.0 | ~689.7 KB | Commercial (confirmed via npm registry license field) |

**Accessibility approach**: TanStack Table is headless, so ARIA is entirely ours to build — the standard shape is `role="table"`/`role="row"`/`role="columnheader"`/`role="cell"` on our own markup, or the fuller `role="grid"` pattern from the W3C ARIA Authoring Practices Guide if cells themselves need to be independently focusable (needed once inline cell editing is added — arrow-key navigation between focusable cells is exactly what the `grid` pattern specifies, including that a focusable element inside a cell keeps its own semantics, e.g. a `<button>` in a cell still reads as a button).

**Mobile**: neither TanStack Table nor react-data-grid has an official responsive mode; the community/product pattern (also true of Notion/Airtable/Linear) is to swap the dense grid for a stacked card list below a breakpoint, promoting 2–3 fields and hiding the rest behind a details expand — already noted in the base report's mobile paragraph, reconfirmed here as still the only real answer.

### C. Kanban — pragmatic-drag-and-drop keyboard DnD and accessibility, code-level

Confirmed core snippet shape (from the real package exports — `@atlaskit/pragmatic-drag-and-drop/element/adapter`, `/combine`, `@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge`):

```ts
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

// Card: draggable + dropTargetForElements
useEffect(() => combine(
  draggable({
    element: cardEl.current!,
    getInitialData: () => ({ type: 'card', cardId: card.id }),
    onDragStart: () => setIsDragging(true),
    onDrop: () => setIsDragging(false),
  }),
  dropTargetForElements({
    element: cardEl.current!,
    getData: ({ input, element }) =>
      attachClosestEdge({ type: 'card', cardId: card.id }, { input, element, allowedEdges: ['top', 'bottom'] }),
    onDragEnter: (args) => setClosestEdge(extractClosestEdge(args.self.data)),
    onDrop: () => setClosestEdge(null),
  }),
), [card.id]);

// Board root: a single monitor resolves every drop and performs the reorder
useEffect(() => monitorForElements({ onDrop: handleDrop }), [handleDrop]);
```

**Keyboard DnD — this corrects an assumption worth stating explicitly: there is no arrow-key "picked up, now nudge with arrow keys" mode, and Atlassian deliberately does not build one.** Their own accessibility guidance rejects directional keyboard dragging (the model react-beautiful-dnd used) on the grounds that it has no spatial context when the layout isn't visible to the user, fights screen-reader mode-switching (JAWS), translates poorly across disparate experiences, and needs too many keystrokes for non-trivial moves. The recommended pattern instead is a three-step recipe, backed by a real package (`@atlaskit/pragmatic-drag-and-drop-react-accessibility`, exposing just `drag-handle-button` and `drag-handle-button-small` — accessible button primitives, not a keyboard-drag engine):

1. Every card exposes a focusable drag-handle/"More actions" button opening a standard menu of move destinations ("Move to → In Progress").
2. Selecting a destination performs the move **programmatically** (no simulated drag) and announces it.
3. Focus returns to the trigger so keyboard navigation continues uninterrupted.

**Screen-reader announcements** use `@atlaskit/pragmatic-drag-and-drop-live-region` (v2.1.0). Its real source uses `role="status"`, not `role="alert"` — the source comment explains `alert` was unreliable when focus changed at the same moment, while `status` queues and reads reliably — and debounces `announce()` via `setTimeout` for the same reason. The documented announcement shape is **item + destination + origin**, e.g.:

```ts
liveRegion.announce(`Task "${card.title}" moved to list "${toColumn.name}" from "${fromColumn.name}".`);
```
Localize this string for uz/ru/en like any other user-facing copy.

**Known pitfalls (real, dated GitHub issues)**: [#165](https://github.com/atlassian/pragmatic-drag-and-drop/issues/165) (open) — Escape-to-cancel doesn't fire `onKeyDown` during a native drag on virtualized lists; [#12](https://github.com/atlassian/pragmatic-drag-and-drop/issues/12) (open) — Windows touch-screen drag is broken across Edge/Chrome/Firefox (a browser-platform bug, not fixable in userland); [#137](https://github.com/atlassian/pragmatic-drag-and-drop/issues/137) (closed, confirmed Chrome quirk) — holding Alt/Meta cancels a drag; [Discussion #93](https://github.com/atlassian/pragmatic-drag-and-drop/discussions/93) — real users report touch drop only registers ~10% of the time, still an open complaint as of a 2025-09-11 comment; [#101](https://github.com/atlassian/pragmatic-drag-and-drop/issues/101) (closed) — virtualized-board drag-and-drop needs manual wiring, no batteries-included solution.

**Mobile behavior**: the library rides the native HTML5 Drag-and-Drop API, so touch behavior is entirely browser-vendor-defined (long-press-to-drag is the browser's own gesture, not something Atlassian configures) — and per the issues above, that native behavior is currently unreliable on touch. **For WorkPortal's mobile kanban view, do not rely on touch-drag at all; use the same "Move to…" action-sheet pattern the base report already recommends for mobile, sourced from a card's overflow menu** — this also happens to be the same UI as the desktop keyboard-accessible fallback above, so it is one implementation serving three input modes (mouse drag, keyboard, touch), not three separate ones.

### D. Timeline/roadmap view — accessibility pattern for a custom widget

The W3C ARIA Authoring Practices Guide has no dedicated "Gantt" or "timeline" pattern. The closest applicable one is **`grid`** (`role="grid"` + `row`/`gridcell`/`columnheader`/`rowheader`, arrow-key navigation, and — usefully — a focusable element inside a cell keeps its own semantics, so a task bar rendered as a `<button>` inside a grid cell still reads as a button to assistive tech). If rows can be grouped/collapsed (e.g., by sub-department or initiative), `treegrid` extends the same pattern. `role="application"` is APG's documented last resort only, since it opts the whole region out of the screen reader's normal reading mode — avoid it here.

**Mobile**: no primary source was found confirming exactly how Linear hides or replaces its roadmap timeline below a breakpoint (flagged unconfirmed rather than guessed) — treat the base report's existing recommendation ("hide the Gantt/timeline behind a simplified list on mobile, no Gantt UX genuinely works below ~600px") as still the safe default. Worth noting: Height, previously citable as a comparable product, **shut down entirely on 2025-09-24** — remove it as an active reference point in future revisions of this report.

### E. Calendar — FullCalendar v7 vs Schedule-X v4.7, with uz/ru locales

**FullCalendar v7** (GA 2026-06-19) locale registration is a flattened object (not the older nested `buttonText: {...}` shape some pre-v7 tutorials show):

```ts
import { Calendar } from 'fullcalendar';

const uzLocale = {
  code: 'uz',
  prevText: 'Oldingi', nextText: 'Keyingi', todayText: 'Bugun',
  yearText: 'Yil', monthText: 'Oy', weekText: 'Hafta', dayText: 'Kun', listText: 'Kun tartibi',
};
const calendar = new Calendar(calendarEl, { locale: uzLocale }); // or locale: 'ru' — ru ships as an official built-in
```
An official Uzbek locale PR (`fullcalendar/fullcalendar#3553`, "added uzbek locale") merged historically, but the live locale list could not be fully re-confirmed to still include "uz" this session (**unconfirmed both ways** — verify directly against `fullcalendar.io/docs/locale` before implementation); Russian is near-certain (FullCalendar ships ~150 official locale files and `ru` is standard) but likewise not independently re-fetched this session. Either way, the object above works as a drop-in custom locale regardless of what ships built-in. **FullCalendar has no dedicated mobile mode**: touch scroll/drag/resize exist as a general capability, but GitHub issue [#7513](https://github.com/fullcalendar/fullcalendar/issues/7513) (open) confirms there's no small-screen redesign — the community pattern is swapping to a `listWeek`/`listDay` view below a width breakpoint via a resize listener, not an official one-line config.

**Schedule-X v4.7** React integration (official docs shape):

```tsx
import { useCalendarApp, ScheduleXCalendar } from '@schedule-x/react';
import { createViewDay, createViewWeek, createViewMonthGrid, createViewMonthAgenda } from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import { translations, mergeLocales } from '@schedule-x/translations';
import '@schedule-x/theme-default/dist/index.css';

const calendar = useCalendarApp({
  views: [createViewDay(), createViewWeek(), createViewMonthGrid(), createViewMonthAgenda()],
  locale: 'uz-UZ',
  translations: mergeLocales(translations, {
    'uz-UZ': { Week: 'Hafta', Day: 'Kun', Month: 'Oy', 'Month agenda': 'Oy kun tartibi' },
  }),
  events: [],
  plugins: [createEventsServicePlugin()],
});
// <ScheduleXCalendar calendarApp={calendar} />
```
Russian (`ru-RU`) is confirmed present among Schedule-X's 40+ built-in locales; Uzbek is not, hence `mergeLocales` above — the same technique the base report should have specified rather than leaving "prototype Schedule-X's i18n" open-ended. **Important correction, not in the base report**: Schedule-X v4.0.0 (2026-01-15) **removed drag-and-drop and event resize from the free package**, moving both into a paid `@sx-premium` add-on — if the Activities/RSVP calendar needs drag-to-reschedule, Schedule-X is no longer the free option the base report implied it might be, and this tips the FullCalendar-vs-Schedule-X decision back toward FullCalendar (whose drag-drop remains free) unless the department is fine without reschedule-by-drag. Schedule-X also needs an explicitly sized container (no default height/width) and its dedicated React repo currently shows zero open issues (either very well triaged or low real-world usage — worth weighing before committing).

### F. Org chart — d3-org-chart vacancy nodes, accessibility, mobile

The vacancy-node pattern uses the library's chainable `.nodeContent(fn)` setter, called as `(d, i, arr, state)` where `d.data` is the raw record and `d.width`/`d.height` give the node's rendered box:

```ts
import { OrgChart } from 'd3-org-chart';

interface PersonOrVacancy { id: string; parentId: string | null; name?: string; title?: string; vacant?: boolean; }

new OrgChart<PersonOrVacancy>()
  .container('.chart-container')
  .data(orgData)
  .nodeContent((d) => d.data.vacant
    ? `<div style="width:${d.width}px;height:${d.height}px;border:2px dashed #94a3b8;border-radius:8px;
         display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#64748b;font-size:12px;">
         Vacant — ${d.data.title ?? 'Open position'}
       </div>`
    : `<div style="width:${d.width}px;height:${d.height}px;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;">
         <div style="font-weight:600;">${d.data.name}</div>
         <div style="font-size:12px;color:#64748b;">${d.data.title}</div>
       </div>`)
  .render();
```
**Accessibility is confirmed silent by design**: a repo issue-search for "accessibility" or "aria" returns nothing relevant, and no ARIA roles exist in source or README — WorkPortal must hand-roll `role="tree"`/`role="treeitem"`/`aria-expanded`/`aria-level` over the rendered SVG/foreignObject hybrid. **Mobile**: pinch/pan rides on the `d3-zoom` dependency's own touch defaults, which is incidental rather than a documented, tested feature of d3-org-chart itself — budget QA time for it specifically rather than assuming it "just works." **Operationally new finding**: the npm package (`d3-org-chart`, v3.1.1) has not been published since 2023-09-18 even though the GitHub repo still gets occasional commits — vendor from the GitHub `src/` directly, not from npm, or the "vendored" copy will already be years behind on day one.

### G. Charts — Recharts 3 and visx animated transitions

Recharts' animation engine changed in v3: `react-smooth` was dropped entirely for a purpose-built controller (`AnimationController`) running on a new Redux-based internal state store (`@reduxjs/toolkit`/`react-redux`/`immer` are now core dependencies) — not react-spring or Framer Motion, contrary to some community speculation. `isAnimationActive` is now `boolean | 'auto'` (default `'auto'`, previously always `true`):

```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

function TaskCountChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <BarChart width={480} height={280} data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="label" /><YAxis />
      <Bar dataKey="count" fill="var(--primary)" animationDuration={400} animationEasing="ease-out" />
    </BarChart>
  );
}
```
Re-rendering with new `data` animates each bar to its new height with no extra wiring. **Accessibility**: `accessibilityLayer` is now **on by default** for every Cartesian/Polar chart since v3.0.0 — Tab focuses the chart, arrow keys navigate data points — and is still being actively hardened (PR #7167 added vertical-chart arrow support, PR #7532 fixed active-dot focus tracking, both 2026). Known issues worth tracking: [#7478](https://github.com/recharts/recharts/issues/7478) (open) — Sankey layout freezes on dense, heavily branching graphs (relevant only if a future dependency/flow visualization is attempted); [#7417](https://github.com/recharts/recharts/issues/7417) and [#7007](https://github.com/recharts/recharts/issues/7007) (both closed) — animated-chart memory/listener leaks that have since been fixed, worth confirming the pinned version postdates the fix.

visx is confirmed still MIT and actively maintained (v4.0.0 shipped 2026-06-11, adding React 19 support). Its animation package is `@visx/react-spring`; the idiomatic shape (react-spring's `useTransition`, not verified against an official visx example page — flagged accordingly) is:

```tsx
import { animated, useTransition } from '@visx/react-spring';

const transitions = useTransition(data, {
  key: (d) => d.label,
  from: { height: 0, y: height },
  enter: (d) => ({ height: height - yScale(d.value), y: yScale(d.value) }),
  update: (d) => ({ height: height - yScale(d.value), y: yScale(d.value) }),
});
// transitions((style, d) => <animated.rect {...style} x={xScale(d.label)} width={xScale.bandwidth()} />)
```

### H. Command palette — cmdk with async sources

cmdk (npm `cmdk`, MIT, v1.1.1 published 2025-03-14, ~14.9 KB gzip per bundlephobia) is synchronous/client-filtered by default, but ships an official **"Asynchronous results"** pattern in its own docs: render items as they arrive and let cmdk's built-in filter run over them, or opt out of it entirely for server-driven ranking. **Correction worth noting**: the canonical repo has moved from `github.com/pacocoursey/cmdk` to **`github.com/dip/cmdk`** (old URL 302-redirects; GitHub's own search does not follow it) — link the new location going forward. A keyboard-navigation fix (PR #409, merged 2026-06-23) already postdates the 1.1.1 npm release, so "current on npm" and "current in the repo" aren't quite the same thing here either, same pattern as d3-org-chart above. cmdk's own README states plainly: *"Virtualization? No. Good performance up to 2,000-3,000 items... [use] `shouldFilter={false}` for better memory usage and performance; bring your own virtualization."* — a real ceiling worth knowing if the command palette ever needs to search the full People/Projects registers rather than a curated action list.

```tsx
function AsyncCommandPalette() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) return setItems([]);
    setLoading(true);
    const id = setTimeout(async () => {
      const results = await searchEverything(query); // projects, people, activities
      setItems(results);
      setLoading(false);
    }, 200); // debounce
    return () => clearTimeout(id);
  }, [query]);

  return (
    <Command shouldFilter={false}>
      <Command.Input value={query} onValueChange={setQuery} />
      <Command.List>
        {loading && <Command.Loading>Searching…</Command.Loading>}
        {items.map((item) => <Command.Item key={item.id}>{item.label}</Command.Item>)}
      </Command.List>
    </Command>
  );
}
```
**Accessibility**: cmdk's own docs state labeling, ARIA attributes, and DOM ordering are "tested with VoiceOver and Chrome DevTools," and it composes an accessible Dialog when used as a modal palette — the underlying pattern is a combobox/listbox with `aria-activedescendant`-style focus management (matching the W3C ARIA APG **Combobox** pattern, though cmdk's docs don't name it explicitly). **Mobile**: no official guidance was found for the on-screen-keyboard-covers-results problem common to command palettes on small screens — plan to test this specifically rather than assume parity with desktop. **Known rough edges (real, open GitHub issues)**: [#365](https://github.com/dip/cmdk/issues/365) "Asynchronous Filtering" (open) — confirms `CommandEmpty` doesn't behave correctly with `shouldFilter={false}`; [#267](https://github.com/dip/cmdk/issues/267) and [#280](https://github.com/dip/cmdk/issues/280) (both open) — item lists not updating/first item not auto-selected when content is dynamic/async. **Take-away: the async pattern above is a well-worn community workaround, not an officially blessed recipe — budget QA time for these specific edge cases (empty state timing, first-item selection) rather than assuming it's polished.**

### I. Filter bar (Linear-style) and multi-select bulk actions

No single canonical "Linear-style filter bar" npm package exists, but a concrete, actively-maintained open-source reference implementation does: **`openstatusHQ/data-table-filters`** (MIT, 2,225★, pushed 2026-09-04 — i.e., maintained as of this week) ships exactly this combination — faceted pill/popover filters plus a `data-table-filter-command` block described as "Command palette with history + keyboard shortcuts" over shadcn/ui + TanStack Table, distributed as an installable shadcn registry component (`npx shadcn@latest add https://data-table.openstatus.dev/r/data-table.json`). `sadmann7/tablecn` (MIT, 6,267★, pushed 2026-06-14, formerly `shadcn-table`) is a second, also-live reference covering sorting/filtering/pagination/infinite-scroll. Worth a direct look before hand-rolling WorkPortal's own filter bar from scratch — both fuse the command-palette and filter-bar patterns this report treats separately.

The underlying API either reference (or a hand-built bar) sits on is TanStack Table's `ColumnFiltersState`: `table.getColumn(id)?.setFilterValue(value)` sets one filter, and the resulting `{id, value}[]` array is exactly what a pill/chip bar renders as removable chips, one per active filter, each pill's popover calling `setFilterValue` for its own column. **Version note**: `@tanstack/react-table`'s npm `latest` tag is now **v9.2.4** (2026-08-28) — v9 replaced `useReactTable` with `useTable` + `tableFeatures` and an optional atom-based state model for finer-grained subscriptions, while still supporting the classic `state.columnFilters` + `onColumnFiltersChange` shape most existing tutorials (and the two reference repos above) show. Check which major version any copied snippet or reference repo is actually pinned to before reusing it verbatim.

For the bulk-action floating toolbar, **`@radix-ui/react-toolbar`** (MIT, v1.1.19, published 2026-07-24; also available via the newer unified `radix-ui` package, v1.6.7) is the accessible foundation worth building on rather than a hand-rolled `<div>` bar: container role `toolbar` with `aria-label`, and roving-tabindex keyboard navigation (Tab enters/exits as one stop, arrow keys move between buttons, Home/End jump to first/last) per the W3C ARIA APG Toolbar pattern — recommended once there are 3+ controls in the bar, which a "change status / reassign / escalate" bulk bar will have. On appearance/disappearance with selection state, APG's general guidance is to restore focus to the last-focused control if the toolbar previously held it, otherwise focus the first enabled control. Pair this with an `aria-live="polite"` region announcing the selection-count change (e.g., "3 items selected" — per MDN's `aria-live` guidance, `polite` rather than `assertive` since this is a routine status change, not a time-critical interruption) so screen-reader users get the same feedback sighted users get from the bar sliding into view — a small addition the base report's bulk-actions paragraph didn't specify but should, since the bar's existence is currently sight-only feedback. The "select all N matching vs. select all visible" distinction the base report already calls out could not be traced to a specific Linear/Airtable engineering write-up this pass (flagged unconfirmed rather than guessed) — GitHub's own issue/PR list UI's "select all N" banner is a fetchable, real prior-art example if one is needed.

### J. Comments/mentions editor — Tiptap vs Lexical, with a licensing correction

**Tiptap** core (`@tiptap/core`, MIT, v3.31.3) and its Mention extension (`@tiptap/extension-mention`, MIT, ~1.6 KB marginal gzip) are fully free — but **Tiptap now sells "Tiptap Cloud"** (Start $59/mo, Team $179/mo, Business $1,199/mo, Enterprise custom), and **comments, real-time collaboration, document version history, and AI extensions are gated behind those paid tiers**, not sold as standalone open extensions. Whether a self-hosted, Cloud-free comments path is documented could not be confirmed this session (the relevant docs page 404'd) — treat as open until checked directly.

```tsx
import { Editor } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';

new Editor({
  element: document.querySelector('#comment-editor'),
  extensions: [
    StarterKit,
    Mention.configure({
      HTMLAttributes: { class: 'mention' },
      suggestion: {
        char: '@',
        items: ({ query }) => people.filter(p => p.name.toLowerCase().includes(query.toLowerCase())),
      },
    }),
  ],
});
```

**Lexical** (Meta, MIT, v0.50.0, ~56 KB gzip core, no paid tier of any kind) is the lighter and commercially simpler choice for a comments-only feature — smaller than Tiptap core + starter-kit (~105 KB) and carries zero risk of a future paid-feature collision, at the cost of a lower-level, more-assembly-required API (`LexicalTypeaheadMenuPlugin` + a custom mention node, rather than Tiptap's more turnkey extension). **Neither editor documents an ARIA/listbox pattern for its mention suggestion popup** — `role="listbox"`/`role="option"`/`aria-activedescendant` wiring is on us either way, so this is not a differentiator between them. **Recommendation**: Lexical for a comments-only feature, or Tiptap `core` + `extension-mention` (explicitly skipping `starter-kit` and never touching Tiptap Cloud) as a defensible lighter-weight alternative if the team prefers its more turnkey extension API — either way, build comment storage/permissions/audit-events in WorkPortal's own API and contracts layer, never in a vendor's cloud product. Known mobile friction, both general-editor rather than mention-specific: Tiptap [#8220](https://github.com/ueberdosis/tiptap/issues/8220) (iOS redraw loop in React node-views) and [#7540](https://github.com/ueberdosis/tiptap/issues/7540) (iOS Safari keyboard arrow-navigation ignored).

### K. Miro-like lightweight canvas for retros/brainstorms — Excalidraw vs tldraw vs react-flow/xyflow

This is a genuinely new section — the base report never covered freeform-canvas tooling.

| Option | License (confirmed) | Version | Fit |
|---|---|---|---|
| **Excalidraw** | **MIT**, confirmed from the repo's raw `LICENSE` file ("MIT License... (c) 2020 Excalidraw") | v0.18.1 | Purpose-built sketch/sticky-note canvas; "Excalidraw+" is a **separate, distinct paid hosted product** (`plus.excalidraw.com`) — the self-hosted npm library stays fully free under MIT regardless. Bundle is genuinely heavy (several hundred KB gzip is the safe planning figure) due to font/canvas-rendering code |
| **tldraw** | **Not MIT** — npm's own license field literally reads `"SEE LICENSE IN LICENSE.md"` | v5.4.0 | Free only in "Development Environments" (internal/non-public/testing/staging, per the license text). "Production Environments" — anything serving real end users — require either a 100-day trial license, an undisclosed value-based commercial license, or a discretionary "Hobby license" for **non-commercial** projects only, which **mandates a "made with tldraw" watermark on the canvas**. No public revenue/funding threshold exists to cite (pricing is negotiated, not published) |
| **react-flow / xyflow** | MIT core, confirmed from repo LICENSE | `@xyflow/react` v12.11.6 | Node/edge diagramming, not freeform sketching. Ships an official "Whiteboard" examples category (Eraser, Lasso, Rectangle-draw), but the closest thing to sticky-note freehand drawing is a Freehand Draw example explicitly marked **"(Pro)"** — the paid tier here is examples/support, but the one feature closest to our need sits behind it |

**Recommendation: Excalidraw.** It is unambiguously MIT with no production/development distinction and no watermark clause, which matters for a government tool where legal review time is expensive and any ambiguity is a real blocker. **tldraw's license is a genuine, non-trivial concern for exactly this use case, not a technicality to wave away**: an internal ministry tool used daily by real staff plausibly falls under tldraw's "Production Environment" definition (it distinguishes by whether the software serves end users, not by revenue or public-facingness), meaning either a negotiated commercial license or the watermarked, non-commercial-only Hobby tier — neither is a comfortable fit for a ministry-branded internal product, and "it's internal, so it's fine" is not a safe reading of the license text as written. Reach for xyflow instead only if the actual need drifts from freeform retro boards toward structured diagramming (workflow/approval-chain visualizations), where the base report already independently recommends it.

### L. Cross-cutting gaps

**Real-time/multi-user editing conflicts** (distinct from freeform-document collaboration, which is a CRDT problem — Yjs/Automerge — relevant only to the canvas/comments features above, not to CRUD rows): use TanStack Query's documented optimistic-update lifecycle (`onMutate` → `onError` rollback → `onSettled` reconcile, via `cancelQueries`/`getQueryData`/`setQueryData`) for the common case, backed by a server-side `version`/`updated_at` column and a conditional update that returns **HTTP 409** on a stale write (RFC 7231 §6.5.8) so the client can roll back and prompt "this row changed — reload?". For lightweight presence ("who else is viewing this project"), Server-Sent Events are explicitly documented (MDN) as suited to one-directional presence/activity feeds — cheaper than a WebSocket — with one caveat worth flagging for a regional-office context: without HTTP/2, browsers cap SSE at 6 concurrent connections per domain, which matters if a user keeps several tabs open on a slow link.

**Offline/low-bandwidth resilience**: TanStack Query's `networkMode: 'offlineFirst'` plus its official persistence plugins — `@tanstack/react-query-persist-client` with `@tanstack/query-sync-storage-persister` (localStorage, synchronous) or `@tanstack/query-async-storage-persister` (IndexedDB) — cache API data across reloads (note: `gcTime` must be ≥ the persister's `maxAge` or hydrated data is immediately garbage-collected). Pair with `vite-plugin-pwa` (MIT, v1.3.0, wraps Workbox) for app-shell/asset caching — the two layers are complementary, not alternatives.

**Internationalization mechanics beyond calendars**: Node.js ships full ICU (all CLDR locales, not just English) by default since Node 13+, and the Unicode CLDR project's own `uz.xml` locale file is confirmed substantial (409 KB) — Uzbek is not a stub locale in the underlying data. The defensive coding pattern regardless is a fallback array: `new Intl.NumberFormat(['uz-Latn-UZ', 'uz', 'en-US'])` / `new Intl.DateTimeFormat(['uz-Latn-UZ', 'uz', 'en-US'], { dateStyle: 'medium' })`, with `Intl.DateTimeFormat.supportedLocalesOf([...])` run as a cheap CI smoke test against the actual target runtimes rather than assumed. Pair with `react-i18next` (v17.0.13) / `i18next` (v26.4.2, both MIT) for translated strings, but delegate all number/date/currency formatting to native `Intl` directly rather than an abstraction layer, keeping bundle size down. RTL is confirmed a non-issue: Uzbek Latin, Russian, and English are all left-to-right scripts.

**Accessibility and visual-regression testing tooling** (previously entirely absent from the report despite accessibility being called a hard requirement throughout): `@axe-core/playwright` (v4.13.0, MPL-2.0) integrates directly into the Playwright e2e suite already implied by this stack:
```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('projects table has no a11y violations', async ({ page }) => {
  await page.goto('/projects');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
```
For visual regression, Playwright's own built-in `toHaveScreenshot()` is the right default for a small government team — free, no new infrastructure, baselines refreshed with `--update-snapshots` — over commercial options like Chromatic or Percy, which are worth revisiting only if a PR-based visual-review workflow becomes a real bottleneck.

**Print/PDF export**: `@media print` with `print-color-adjust: exact` (now Baseline 2025 — needed to preserve status-chip colors, which the base report already insists must never be color-only) and `break-inside: avoid` on rows/cards is the correct, zero-dependency default for "print this table." Reserve `@react-pdf/renderer` (MIT, v4.9.0, template-driven PDFs from React components) or server-side Playwright/Puppeteer `page.pdf()` rendering (pixel-parity with the live page, at the cost of a headless-browser dependency in the deploy pipeline `wp-devops` owns) for the smaller number of routes that need a polished, branded "Export to PDF" button for ministry reporting.

**Design tokens/theming across libraries**: Tailwind v4's `@theme` directive compiles design tokens into **real CSS custom properties on `:root`** (confirmed from Tailwind's own docs) rather than living only in a JS config as in v3 — meaning any third-party library that reads CSS variables, inline styles, or `getComputedStyle` can be reskinned by pointing its own variable names at ours in a thin override stylesheet, with no Tailwind-awareness required in the library itself. This is a genuinely better answer than existed when most v3-era "how do I theme a third-party widget" discussions were written. The caveat: not every library exposes CSS-variable theming as its override surface — FullCalendar v7, for instance, has moved to a **class-name-prop API** (e.g., `dayCellClassNames`) rather than documented `--fc-*` custom properties, so the exact override mechanism (CSS vars vs. class-name props vs. build-time Sass vars) must be checked per library rather than assumed uniform across d3-org-chart, SVAR, and FullCalendar alike.

**Typed-property data model**: Notion's own help docs confirm a flexible, end-user-extensible schema (24+ property types, up to 500 properties per database) — the common description of this as a JSONB-column-plus-property-type-registry implementation is standard industry inference, not something Notion states outright, so treat it as reasonable-but-unconfirmed. No primary source could be found for Linear's actual schema (the oft-repeated "Linear uses literal typed Postgres columns" claim is conference-talk folklore, not independently verified here). The architectural framing that matters for WorkPortal: this is fundamentally a choice between an **EAV/JSONB-with-schema-registry** pattern (right when *end users* define their own fields, Notion/Airtable-style) and **literal typed columns** (right when the field set is fixed and known at design time). Since WorkPortal's own plan treats project status/owner/deadline as fixed platform fields rather than user-defined properties, typed columns are the better-fitting default — an architectural recommendation for `wp-architect` to weigh, not a settled fact from any source.

## Sources (addendum additions, 2026-09-05)

- [TanStack Table — Pagination guide](https://tanstack.com/table/latest/docs/framework/react/guide/pagination)
- [TanStack/table discussion #3963 — spreadsheet comparison](https://github.com/TanStack/table/discussions/3963)
- [TanStack/table issue #3636 — range select, closed unimplemented](https://github.com/TanStack/table/issues/3636)
- [react-data-grid (Comcast)](https://github.com/Comcast/react-data-grid)
- [FullCalendar v7 upgrade guide](https://fullcalendar.io/docs/upgrading-from-v6)
- [FullCalendar issue #7513 — mobile view enhancement request](https://github.com/fullcalendar/fullcalendar/issues/7513)
- [Schedule-X](https://schedule-x.dev/) / [Schedule-X translations/i18n docs](https://schedule-x.dev/docs/calendar/language)
- [Schedule-X LICENSE (MIT)](https://github.com/schedule-x/schedule-x/blob/main/LICENSE)
- [pragmatic-drag-and-drop LICENSE (Apache-2.0, confirmed)](https://raw.githubusercontent.com/atlassian/pragmatic-drag-and-drop/main/LICENSE)
- [pragmatic-drag-and-drop accessibility guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)
- [pragmatic-drag-and-drop issue #165 — Escape key / virtualized list](https://github.com/atlassian/pragmatic-drag-and-drop/issues/165)
- [pragmatic-drag-and-drop issue #12 — Windows touch-screen](https://github.com/atlassian/pragmatic-drag-and-drop/issues/12)
- [pragmatic-drag-and-drop discussion #93 — mobile/touch support](https://github.com/atlassian/pragmatic-drag-and-drop/discussions/93)
- [W3C ARIA Authoring Practices Guide — Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- [d3-org-chart LICENSE (MIT)](https://github.com/bumbeishvili/org-chart/blob/master/LICENSE.md)
- [Recharts v3.0.0 release notes](https://github.com/recharts/recharts/releases/tag/v3.0.0)
- [Recharts issue #7478 — Sankey freeze](https://github.com/recharts/recharts/issues/7478)
- [visx v4.0.0 release](https://github.com/airbnb/visx/releases/tag/v4.0.0)
- [cmdk — Asynchronous results pattern (repo now at dip/cmdk)](https://github.com/dip/cmdk)
- [openstatusHQ/data-table-filters — shadcn + TanStack Table + cmdk reference](https://github.com/openstatusHQ/data-table-filters)
- [sadmann7/tablecn — shadcn data table reference](https://github.com/sadmann7/tablecn)
- [Radix UI Toolbar primitive](https://www.radix-ui.com/primitives/docs/components/toolbar)
- [W3C ARIA APG — Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [W3C ARIA APG — Toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
- [MDN — aria-live](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-live)
- [Tiptap pricing (Cloud tiers, Comments gating)](https://tiptap.dev/pricing)
- [Tiptap Mention extension docs](https://tiptap.dev/docs/editor/extensions/nodes/mention)
- [Lexical (Meta)](https://github.com/facebook/lexical)
- [Excalidraw LICENSE (MIT)](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)
- [tldraw LICENSE](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
- [xyflow / React Flow](https://github.com/xyflow/xyflow)
- [TanStack Query — Optimistic Updates guide](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [TanStack Query — persistQueryClient](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/guide/)
- [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [Node.js — Internationalization (ICU) support](https://nodejs.org/api/intl.html)
- [Unicode CLDR — uz.xml](https://github.com/unicode-org/cldr/blob/main/common/main/uz.xml)
- [@axe-core/playwright](https://www.npmjs.com/package/@axe-core/playwright)
- [Playwright — Visual comparisons](https://playwright.dev/docs/test-snapshots)
- [MDN — print-color-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/print-color-adjust)
- [@react-pdf/renderer](https://www.npmjs.com/package/@react-pdf/renderer)
- [Tailwind CSS v4 — Theme variables (@theme)](https://tailwindcss.com/docs/theme)
- [Notion Help — Database properties](https://www.notion.com/help/database-properties)
- [Height shutdown coverage (2025-09-24) — noted as a now-discontinued reference product](https://www.creativerly.com/height-app-is-shutting-down/)
