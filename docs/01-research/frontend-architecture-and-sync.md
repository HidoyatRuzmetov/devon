# Frontend architecture, local-first sync, real-time collaboration

**TL;DR:** For a 23-person ministry unit that must feel instant, work through flaky office wifi, and train nobody, skip the "sync engine" arms race entirely for v1 — ship a Vite + TanStack Router SPA over a boring REST/RPC API with TanStack Query v5 for caching and optimistic updates, and add a thin CRDT layer (Yjs or Loro) only for the specific surfaces that need real multiplayer (shared notes, weekly comment threads). The local-first sync-engine category (Zero, Electric, PowerSync, Jazz, Triplit, Instant) is exciting but immature for a government RBAC app: every one of them treats permission-aware partial sync as an unsolved or hand-rolled problem, and two of the category's most credible players changed direction in 2026: ElectricSQL was acquired into Databricks, and the entire InstantDB team was hired by OpenAI (an AI-lab acquihire, not a failed-product wind-down — the DB itself stays open-source and self-hostable). React 19 + the React Compiler are stable and worth adopting now; Next.js buys you nothing this app needs and costs you a Vercel-shaped deployment model that fights on-prem/gov-cloud and data-localization requirements. i18n for uz/ru/en is solved well by Paraglide JS (compile-time, tiny, correct plural rules) or next-intl-style ICU catalogs; date-fns v4 ships both `uz` and `uz-Cyrl` locales out of the box. Budget the real engineering effort not for choosing a framework but for the permission model, the offline queue UX, and the weekly-ritual/escalation workflow that is the actual product.

## 1. Rendering framework: React 19, the Compiler, and where it runs

**React 19** went stable December 5, 2024 and is the correct baseline for a 2026 build. The load-bearing additions are Actions (`useActionState`, form `action`/`formAction` props with automatic pending/error state), `useOptimistic` for optimistic UI without hand-rolled reducers, `use()` for reading promises/context in render, and `ref` as a plain prop (no more `forwardRef` ceremony) ([react.dev/blog/react-19](https://react.dev/blog/2024/12/05/react-19)). These map directly onto our UI needs: a "Friday update" comment form, an RSVP button, an inline status-chip edit — all are exactly the small-mutation-with-pending-state pattern Actions were built for, and using them means less bespoke state machinery for what is otherwise a very Redux-in-2016-shaped set of interactions.

**React Compiler** auto-memoizes components so `useMemo`/`useCallback`/`React.memo` become opt-in rather than mandatory boilerplate. Adoption is incremental (file- or directory-level) and it ships as a Babel plugin today, which Next.js's own release notes flag explicitly as a dev/build-time cost: "the React Compiler is currently only available as a Babel plugin, which will result in slower development and build times" ([nextjs.org/blog/next-15](https://nextjs.org/blog/next-15)). For a 23-person internal tool, correctness and simplicity beat micro-perf, so turning it on and accepting slightly slower builds is a reasonable, low-risk default — but do not block the whole project on it; it degrades gracefully to "no-op" on components it can't safely compile.

**Where it runs — the real decision.** Next.js 15 is React 19-first, ships Turbopack dev as stable, moved request APIs (`cookies()`, `headers()`, `params`) to `await`-ed async (breaking from v14), tightened caching defaults (GET route handlers and the client router cache no longer cache by default), and hardened Server Actions (unguessable action IDs, dead-code elimination of unused actions) ([nextjs.org/blog/next-15](https://nextjs.org/blog/next-15)). Real engineering, but not what this project needs: Next.js's caching/ISR/edge defaults are built for public, CDN-cacheable content, while this app is a permission-gated internal tool where every page is dynamic and per-user. Self-hosting is possible (`next start`, standalone output) but you still inherit the App Router's RSC client/server boundary rules and a build pipeline tuned for Vercel's infrastructure, to get ISR/edge/image-CDN features this app won't use.

**Recommendation: Vite + TanStack Router, not Next.js, not plain Remix/React Router 7 framework mode — for v1.** TanStack Router gives fully type-safe routes (params, search-params, and loader data inferred end-to-end), file- or code-based routing, and built-in search-param state management that is genuinely good for filterable tables (Projects register, People directory). **TanStack Start** layers SSR/streaming/server functions on top of Router, but is at Release Candidate, not 1.0 — "Start keeps TanStack Router as the application contract, then adds full-document rendering, streaming, typed server work, middleware, and output for the runtime you choose" ([tanstack.com/start](https://tanstack.com/start/latest)). For a login-gated tool where people load the app once and live in it all day, SSR mainly buys first-paint speed we don't need; a pure client-rendered SPA behind auth is simpler to reason about, simpler to self-host (one static bundle + one API), and skips the RSC boundary tax entirely. Revisit Start at 1.0 if a public-facing dashboard (e.g., EGDI results for other ministries) needs SSR/SEO.

**Remix has merged into React Router 7** — Remix's framework features (`loader`/`action`, nested routing, framework mode) live inside React Router 7 now; Remix itself is essentially the "v2 → migrate to RR7" bridge product ([reactrouter.com/upgrading/remix](https://reactrouter.com/upgrading/remix)). React Router 7's framework mode is a legitimate Next.js alternative and is more self-host-friendly, but it still couples routing to a server-rendering opinion we don't need yet. TanStack Router's fully-typed search params and first-class "just a router, no framework tax" posture is the better fit for an internal tool where every route is data-heavy and behind auth.

| Option | SSR | Type-safety | Self-host friction | Fit for this app |
|---|---|---|---|---|
| Next.js 15/16 (App Router) | Yes, opinionated caching | Good | Medium-high (RSC boundary, Vercel-tuned defaults) | Overkill; fights on-prem |
| Vite + TanStack Router | No (CSR) | Excellent (typed params/search/loaders) | Lowest (static bundle + API) | **Recommended for v1** |
| TanStack Start | Yes, you choose runtime | Excellent | Low, but RC not 1.0 | Revisit at 1.0 |
| React Router 7 (framework mode) / Remix | Yes | Good | Medium | Fallback if SSR becomes required |

## 2. Data layer: TanStack Query v5, and why not a sync engine (yet)

**TanStack Query v5** is the correct default for server-state regardless of the sync-engine decision: it standardizes caching, retries, background refetch, and — critically — gives an explicit, debuggable optimistic-update pattern (`onMutate` cache patch → `onError` rollback → `onSettled` invalidate) rather than the implicit reconciliation a full sync engine does for you ("keeps optimistic writes, pending state, recovery, invalidation, and reconciliation explicit instead of scattering through components," per TanStack's own framing — [tanstack.com/query](https://tanstack.com/query/latest)). Combined with a persisted query cache (`@tanstack/query-sync-storage-persister` to `localStorage`/IndexedDB), you get "app opens instantly with last-seen data, then refreshes" for free — most of the perceived benefit of local-first, without adopting a new database engine.

**Local-first sync engines**, surveyed:

| Engine | Model | License / status | Notable 2026 fact | Verdict for us |
|---|---|---|---|---|
| **Rocicorp Zero** | Client store (`zero-client`) + read replica cache (`zero-cache`) over Postgres; ZQL streaming queries | Open-source, self-hostable; managed cloud $30–$1,000+/mo | Production users include tldraw, Linear, Figma-adjacent teams; permissions are **filter-based, not DB-enforced** — you re-check ownership in every query/mutator, and Zero's own docs warn shared-device users "have access to each others' data" unless you force in-memory storage ([zero.rocicorp.dev](https://zero.rocicorp.dev/), [zero docs/permissions](https://zero.rocicorp.dev/docs/permissions)) | Promising, but RBAC is entirely on you to get right |
| **Electric** (formerly ElectricSQL) | Postgres logical replication → "Shapes" (partial, filtered replicas) over HTTP | Apache 2.0 | **Electric joined Databricks on Aug 11, 2026**, alongside Neon, to build "Lakebase"; recent roadmap has visibly pivoted toward AI-agent durable streams/sessions rather than general CRUD app sync ([electric.ax](https://electric.ax/), [electric.ax/blog](https://electric.ax/blog)) | Strong tech, but company direction risk just materialized — do not bet a multi-year gov platform on it today |
| **PowerSync** | Bi-directional sync, Postgres/MongoDB/MySQL/SQL Server → client SQLite, "Sync Streams" partition data per user | Source-available + managed cloud; free tier | 25+ named enterprise customers (Allianz PNB Life, Stanley Black & Decker), ~1,900 GitHub stars, active Discord ([powersync.com](https://www.powersync.com/)) | Most enterprise-credible of the pure sync engines; SQLite-on-device is a good fit if we go native/Electron later |
| **Replicache** | Original Rocicorp product, mutation-log + poke model | Being superseded by Zero (Rocicorp's stated successor product) | Legacy; new projects should start on Zero | Skip |
| **Jazz** | CRDT-based, local-first "relational" store with row-level policies over data + JWT claims | Server open-source/self-hostable; core still **v2 alpha** | Not production-ready by the vendor's own labeling | Too early |
| **TinyBase** | In-memory reactive store, CRDT-capable sync (WebSocket/BroadcastChannel), pluggable persistence (incl. Yjs/Automerge) | Open source, 7.3–16.4kB, zero deps, 100% test coverage claimed ([tinybase.org](https://tinybase.org/)) | Lightweight "local state that can optionally sync," not a backend | Good for small embedded widgets, not the system of record |
| **Triplit** | Triple-store, client+server sync, schema + permissions | Open source | Could not fetch live docs during this research (site unreachable); treat as unverified | Needs a hands-on spike before any commitment |
| **Instant DB (InstantDB)** | Realtime relational DB, Zanzibar/Ent-inspired declarative permission rules | Open-source core; Cloud offering being wound down | **The entire InstantDB team is joining OpenAI** — this is an AI-lab acquihire, not a failed-product shutdown. New Instant Cloud signups closed immediately; existing Cloud customers get 12 months to migrate (all Cloud apps stop Aug 31, 2027; backups retained until Aug 31, 2028); the codebase itself "is and remains" open source, and the team published a self-host migration guide ([instantdb.com/essays/instant_team_joins_openai](https://www.instantdb.com/essays/instant_team_joins_openai)) | **Avoid the managed Cloud offering**; the self-hosted OSS core survives but now has no company behind it actively building it — too much orphan-risk for a multi-year government system to adopt fresh today |
| **Convex** | Full backend platform: TypeScript server functions + reactive queries, no separate API layer | Managed (with self-host option); broad framework support | Auth via Auth0/Clerk/Convex Auth; authorization is hand-written inside functions, same pattern as Zero ([docs.convex.dev](https://docs.convex.dev/home)) | Compelling as a BaaS, but couples the whole backend to a vendor platform — a hard sell for data-localization requirements (see §7) |

**Linear's and Figma's custom engines** are worth studying as design references, not as products to copy wholesale. Figma's own engineering blog is explicit that they rejected Operational Transforms as "unnecessarily complex," built a simplified CRDT-*inspired* (not CRDT-pure) model with server-authoritative ordering and **last-writer-wins at the property level**, used fractional indexing for sibling ordering, and prioritized "a simpler system is easier to reason about" over theoretical completeness ([figma.com/blog/multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)). That is the right posture for us too: our data model (projects, comments, RSVPs, org records) needs LWW-per-field conflict handling and a server of record, not general-purpose CRDT merge semantics. Linear's sync engine (described in Tuomas Artman's talks) follows the same shape — a single client-side transaction log, delta sync, server as tiebreaker — but Linear's specific implementation isn't published as reusable open source; it's an argument for *the pattern*, not a library to install.

**Bottom line on sync engines:** every credible option in this category still treats "sync only the rows this user is allowed to see, enforced at the sync layer, not just the UI" as either unsolved (Zero, Convex — you write the checks yourself) or immature (Jazz alpha, Triplit unverified) or organizationally at-risk (Electric's Databricks acquisition, InstantDB's whole team decamping to OpenAI). For a ministry system with real HR/privacy tiers (public profile vs. HR-restricted fields — see the reference audit), that gap is disqualifying for v1. Ship TanStack Query + a normal authenticated REST/RPC API with server-side RBAC enforced in Postgres row-level security or an application-layer policy engine; revisit a dedicated sync engine in Phase 2/3 (per the roadmap in the reference site) once the permission model is proven and one of these products has matured or a clear leader has emerged.

## 3. CRDTs for documents, and where multiplayer actually earns its cost

Reserve CRDTs for genuinely concurrent free-text editing — a shared meeting note, a collaboratively-edited policy brief — not for the structured record data (projects, people, org chart) where last-writer-wins-per-field is correct and far simpler.

- **Yjs**: the incumbent, largest ecosystem (Tiptap, BlockNote, `y-websocket`/`y-webrtc` providers), mature and widely production-proven.
- **Automerge**: Automerge 3.0 fixed its historic performance complaint — memory dropped >10x by moving to a compressed runtime representation (loading *Moby Dick* went from 700MB to 1.3MB; a large-history document load went from 17 hours to 9 seconds), and it kept the Automerge 2 file format for compatibility ([automerge.org/blog/automerge-3](https://automerge.org/blog/automerge-3/)). Historically the "correct but slow" CRDT; 3.0 closes much of that gap.
- **Loro**: newer, Rust-core, positions itself on raw performance and a richer feature set (movable trees, rich-text, undo). Could not fetch loro.dev directly during this research (403); treat performance claims as vendor-reported until independently benchmarked.

**Recommendation:** if/when a collaborative notes feature is built, use **Yjs** for the safest ecosystem bet (editor integrations already exist), and keep the CRDT doc-store decoupled from the system-of-record database — sync it via a small dedicated WebSocket relay (e.g., y-websocket or Hocuspocus), not through whatever sync engine (if any) is chosen for structured data. Don't let one collaborative-editing feature justify migrating the entire app's data model to CRDTs.

## 4. Real-time transport, optimistic updates, conflict handling

- **WebSockets** for anything needing server-push (live comment threads, presence, RSVP counts updating for everyone watching). **SSE** is sufficient and simpler for one-directional live feeds (e.g., a live "escalation queue" view) and survives corporate proxies/load balancers more reliably than WebSockets in some gov network setups — prefer SSE unless bidirectional low-latency push is actually needed.
- **Optimistic updates**: use TanStack Query's `onMutate`/rollback pattern for all writes. This is the single highest-leverage UX investment for a "Linear-fast" feel — an RSVP click, a status-chip change, or a weekly comment should paint instantly and reconcile silently.
- **Conflict handling**: follow Figma's lesson — last-writer-wins per field, server as tiebreaker, "if a local edit is unacknowledged, keep showing the local value" to avoid visual flicker. Add an audit trail (who/when) on every field-level write, which also directly serves the reference design's "privacy by design: log who viewed/changed sensitive data" principle.

## 5. Permission-aware sync: the actual hard problem

This is the one finding that should most change how the product owner thinks about "just add a sync engine later." Every sync engine surveyed pushes authorization down to one of two unsatisfying places:

1. **Application-level filtering** (Zero, Convex): you write a query/mutator per access pattern and manually check `userID`/role inside it. Nothing stops a future developer from writing a new query that forgets the check — there is no database-enforced backstop. Zero's own docs list "no built-in enforcement... permissions depend entirely on correct implementation" as a known limitation ([zero.rocicorp.dev/docs/permissions](https://zero.rocicorp.dev/docs/permissions)).
2. **Coarse partial replication** (Electric's Shapes, PowerSync's Sync Streams): you define a shape/stream per role or tenant and the engine replicates only matching rows to that client. This works well for tenant isolation (department A never even receives department B's rows) but composing *field-level* privacy tiers (the reference audit's "DOB and personal phone visible only to HR/managers" requirement) inside a shape/stream definition gets awkward fast — it pushes you toward either duplicating tables (a `people_public` view + a `people_restricted` view synced separately) or view-based row/column masking at the Postgres level feeding the shape.

For a ministry system with three explicit privacy tiers (public directory fields, internal-only, HR-restricted) and eventual multi-tenant isolation across departments/ministries, the safest architecture is: **Postgres Row-Level Security (RLS) + column-level views as the single source of truth for authorization, with the API (or sync engine, later) as a thin pass-through** — never re-implement the same access rules twice in a query layer and a UI layer. This also means the "add a sync engine in Phase 2" migration is safe: RLS-shaped data can later be exposed through Electric Shapes or PowerSync Streams without redesigning the permission model, because the enforcement already lives in the database.

## 6. Offline tolerance for government office networks

Ministry office networks that drop connectivity need: (a) reads to keep working from cache, (b) writes to queue and replay, (c) an honest, calm UI state for "you're offline" — never a silent failure. Concretely:
- A **service worker** (Vite PWA plugin / Workbox) caching the app shell and last-fetched API responses (stale-while-revalidate).
- A **mutation outbox**: queue writes (e.g., in IndexedDB via TanStack Query's persisted mutations, or a small custom queue) and replay on reconnect, with a visible "3 changes pending sync" indicator — never pretend a write succeeded before the server confirms it, but do show it optimistically with a distinct "unconfirmed" affordance (a subtle dot or italic timestamp), which is exactly the local-first UX pattern these sync engines are built around even if we're not adopting one wholesale.
- Test against **actual network flakiness**, not just "offline/online" binary — Chrome DevTools' "Slow 3G"/custom throttling profiles and randomly-dropped-connection scripts simulate ministry wifi far better than a clean airplane-mode toggle.

## 7. Performance budgets and code-splitting

Core Web Vitals framing (LCP/INP/CLS) is built for public content sites; for a logged-in internal app the metrics that matter are **time-to-interactive after auth** and **INP on the heaviest table view** (the Projects register with 50+ rows and inline editing). Budgets: initial JS payload under ~200KB gzipped for the shell, route-level code-splitting via TanStack Router's lazy route loading (or React.lazy) for every top-level section (Overview/People/Organization/Projects/Activities), and virtualization (TanStack Virtual) for any list that can grow past ~100 rows — the People directory and Projects register both will, once this "goes viral" across ministries.

## 8. Internationalization: Uzbek (Latin), Russian, English

| Library | Approach | Bundle cost | Plural rules | Fit |
|---|---|---|---|---|
| **Paraglide JS** (inlang) | Compiles messages to tree-shakable functions at build time | ~47KB for 5 locales/200 messages vs. ~205KB for i18next in the same scenario, and size stays flat as message count grows ([paraglidejs.com](https://paraglidejs.com/)) | Uses `Intl.PluralRules` under the hood; vendor explicitly claims correctness for "complex locales (Russian, Arabic, etc.)" | **Recommended** — smallest runtime cost, TanStack Router has first-class (e2e-tested) support |
| **i18next / react-i18next** | Runtime dictionary lookup | Larger (per above comparison) | Mature plural/ICU support via plugins | Fine, but heavier than needed for 3 languages |
| **next-intl** | ICU MessageFormat, Next.js-coupled | Moderate | Good | Only relevant if Next.js is chosen (it isn't, per §1) |
| **Lingui** | Compile-time extraction + runtime catalogs, ICU | Small-moderate | Good | Reasonable alternative to Paraglide; slightly more mature tooling for translator handoff (PO/XLIFF export) |

Uzbek has two live scripts in real government use (Latin is official/primary since the 1993/2016 reforms; Cyrillic still appears in older documents and some older-generation staff correspondence) — plan the i18n key structure to support a future `uz-Cyrl` locale even if v1 ships Latin-only, since transliteration (not re-translation) is enough to add it later. Russian plural rules are the genuinely tricky one (three plural forms: one/few/many, e.g., "1 проект / 2 проекта / 5 проектов") — this is exactly why using `Intl.PluralRules`-backed tooling (Paraglide, Lingui, i18next-icu) rather than hand-rolled `count === 1 ? ... : ...` logic matters; get this wrong once during a translator handoff and it stays wrong for years in a low-training-budget government context where nobody file-diffs the language files.

## 9. Date/time

date-fns v4 confirmed to ship first-class **`uz`** (Uzbek Latin) and **`uz-Cyrl`** locale files alongside `ru`, verified directly against the published package (`date-fns@4.4.0`, `src/locale` — files `uz.js`, `uz-Cyrl.js`, `ru.js` all present) ([unpkg.com/date-fns](https://unpkg.com/date-fns/locale/)). This is a real, concrete advantage over Day.js, whose locale pack for `uz` exists but is thinner and community-maintained with less frequent updates historically. **Temporal** (the `Temporal` global replacing `Date`) is still not universally shipped in browsers as of this research and requires a polyfill (`@js-temporal/polyfill`) for production use today — worth adopting for new date-arithmetic code (it fixes real `Date` footguns: mutability, month-off-by-one, timezone ambiguity) but do not block v1 on native support; use `date-fns` v4 (which already has partial `TZDate`/timezone support) or `Temporal` + polyfill consistently, never mix both date models in one codebase.

## 10. Forms

- **react-hook-form**: the incumbent, minimal re-renders via uncontrolled inputs + refs, huge ecosystem, works well with any UI kit including shadcn/ui (which the reference site's visual language already resembles).
- **TanStack Form**: newer, v1 stable, reports 3.2M weekly downloads; architecture separates form hooks / field components / composed forms with granular subscriptions so only the components touching a changed field re-render ([tanstack.com/form](https://tanstack.com/form/latest)). Natural fit if the rest of the stack is already TanStack (Router + Query + Form + Table + Virtual = one coherent, well-typed family with a shared mental model — a real advantage for a small team that needs to onboard fast).
- **Conform**: progressive-enhancement-first (works with plain `<form>` + Server Actions/RR7 actions without JS), best when SSR/framework-mode forms are in play; less relevant if the app is a CSR SPA.
- **Zod v4**: stable, 2KB gzipped core, added `z.compile()` for ahead-of-time schema compilation and a memoization pass that cut memory footprint by an order of magnitude ([zod.dev](https://zod.dev/)). Use one Zod schema per entity shared between form validation (client) and API input validation (server) — this single-schema-both-sides pattern is the highest-value "boring good idea" in this whole stack: it eliminates an entire category of client/server validation drift bugs for free.

**Recommendation**: TanStack Form + Zod v4, for stack coherence with TanStack Router/Query, unless the team already has deep react-hook-form muscle memory — in which case react-hook-form + Zod v4 (via `@hookform/resolvers`) is equally defensible and lower-risk (much larger Stack Overflow/community surface).

## 11. Testing

- **Vitest** for unit/component tests (fast, Vite-native, Jest-compatible API — no reason to use Jest in a Vite project in 2026).
- **Testing Library** (`@testing-library/react`) for component behavior tests, enforcing accessible-query patterns (which doubles as an accessibility check for civil-servant users on older machines/screen readers).
- **Playwright** for E2E — critical for this project specifically because the core value proposition is *workflow* (the Friday-update ritual, the auto-escalation queue, the RSVP flow), and only E2E tests actually exercise a multi-step ritual across page reloads and (eventually) offline/online transitions.
- **MSW** (Mock Service Worker) to mock the API in both component tests and local dev — pairs naturally with the "network can drop" reality of this deployment context, since the same MSW handlers can simulate offline/slow responses for manual QA.

## Recommended architecture, with rationale

**Vite + React 19 + React Compiler + TanStack Router**, single-page app, served as a static bundle behind an authenticated reverse proxy (satisfies on-prem/gov-cloud + data-localization requirements without fighting a framework's cloud-native defaults). **TanStack Query v5** over a conventional REST/RPC API (Node/NestJS, Django, or similar — a separate research dimension) with **Postgres RLS as the single source of truth for authorization**, so field-level privacy tiers are enforced once, in the database, not duplicated in query filters and UI conditionals. **TanStack Form + Zod v4** for every create/edit surface, sharing schemas with the API. **Paraglide JS** for uz/ru/en. **date-fns v4** for all date formatting/arithmetic. **Zustand** for small pieces of local UI state that don't belong in the URL or server cache (sidebar collapsed, active modal) — avoid Redux-class ceremony for a 23-person tool; reach for **XState** only for one specific, genuinely stateful workflow (the project status → auto-escalation state machine is a textbook finite-state-machine use case and modeling it explicitly as one will make the "Friday ritual" rule auditable and testable rather than scattered `if` statements). No sync engine and no CRDT database in v1; revisit **Zero** or **PowerSync** in Phase 2/3 once (a) the RLS-based permission model is proven and (b) the vendor landscape has settled — re-run this research before committing.

## Top 5 risks

1. **Betting on an immature or unstable-vendor sync engine.** Electric's Databricks acquisition and pivot toward agent infrastructure, and InstantDB's entire team being hired by OpenAI (an AI-lab acquihire that winds down Instant Cloud by Aug 31, 2027, even though the OSS core lives on unmaintained-by-its-creators), both happened in 2026 — proof this category is still consolidating and its most talented teams are being pulled toward AI-lab compensation rather than staying to build sync infrastructure. A multi-year government system cannot depend on a product whose company might pivot, get acquired, or lose its whole team mid-contract.
2. **Re-implementing authorization in two places.** If permission checks live in both application query code and ad-hoc UI conditionals (the pattern every sync engine surveyed defaults to), a missed check anywhere leaks HR-restricted personal data — a real legal problem under Uzbekistan's data-localization/personal-data rules, not just a bug.
3. **Choosing Next.js for its brand recognition rather than its fit.** The RSC client/server boundary, Vercel-tuned caching defaults, and edge-function assumptions add real complexity (and hosting lock-in tension) that a self-hosted, always-behind-auth internal tool does not need; teams underestimate the ongoing tax of "which things are Server Components" decisions on a team of civil-service-adjacent developers who are not framework specialists.
4. **Under-investing in the offline/optimistic-UI layer because "we're not doing local-first."** Skipping a sync engine doesn't mean skipping offline UX — ministry networks drop, and a naive CSR app with no queued-write pattern will silently lose or duplicate a Friday status update exactly when a manager is watching.
5. **i18n retrofitted late.** Hand-rolled string interpolation and manual plural `if` chains are cheap to write and expensive to fix once 23+ people have muscle memory for an English-only UI; Russian's three-way plural rule (one/few/many) is routinely broken by exactly this shortcut, and it's invisible to an English-speaking dev team until a Russian-speaking user reports it.

## What this means for us

1. **[ADOPT] Vite + TanStack Router (not Next.js) for the SPA shell.** Simpler self-hosting, no RSC boundary tax, better fit for an always-authenticated internal tool.
2. **[ADOPT] React 19 + React Compiler.** Stable, low-risk, removes a category of manual-memoization bugs; accept marginally slower dev builds from the current Babel-plugin form.
3. **[AVOID] Any sync engine (Zero/Electric/PowerSync/Jazz/Triplit/Instant/Convex) as the v1 system of record.** None solve permission-aware partial sync out of the box, and two credible vendors changed direction in 2026 alone. Revisit in Phase 2/3 with a fresh spike.
4. **[ADOPT] Postgres Row-Level Security as the single enforcement point for the three privacy tiers** (public/internal/HR-restricted) described in the reference audit — never duplicate the rule in app code.
5. **[ADOPT] TanStack Query v5 with a persisted cache** for the "feels local-first" experience (instant reopen, optimistic writes, visible pending state) without adopting a new database engine.
6. **[ADAPT] Yjs for one specific collaborative-notes feature only, if/when built** — don't let it justify a store-wide CRDT migration; keep it decoupled from the RLS-governed relational data.
7. **[ADOPT] Paraglide JS for uz/ru/en**, with an eye toward adding `uz-Cyrl` later via transliteration rather than re-translation.
8. **[ADOPT] date-fns v4** — confirmed native `uz`/`uz-Cyrl`/`ru` locale support, avoids Day.js's thinner Uzbek pack.
9. **[ADAPT] TanStack Form + Zod v4, schema shared client/server** — or react-hook-form + Zod if the team already knows it better; either beats hand-rolled validation, but don't run both in the same codebase.
10. **[ADOPT] XState for exactly one workflow: the project status/auto-escalation state machine** — makes the Friday-ritual rule explicit, testable, and auditable, rather than embedding it in scattered conditionals. Don't reach for XState anywhere else yet.
11. **[ADOPT] Zustand for small local UI state**; resist the urge to centralize everything into one global store — most state here is either server state (Query) or URL state (Router search params), and treating it that way keeps the mental model simple for future civil-servant-adjacent maintainers.
12. **[ADOPT] Playwright E2E tests specifically for the three ritual workflows** (weekly project comment → status update, RSVP, auto-escalation trigger) — these are the actual product; unit tests alone won't catch a broken ritual.
13. **[AVOID] Blocking v1 on native Temporal support.** Polyfill cost isn't justified yet; standardize on date-fns v4 consistently instead.
14. **[ADAPT] Build the offline mutation-queue UX (visible "pending sync" state) even without a sync engine** — this is the actual offline requirement, not a local database.
15. **[AVOID] Choosing a framework/library because "Linear/Figma uses it."** Both companies' public engineering writeups explicitly favored *simpler* custom solutions over adopting heavyweight general-purpose tech (Figma rejected OT and pure CRDTs for a simpler LWW model) — the lesson to copy is the bias toward simplicity, not the specific tool.

## Open questions

- **Backend stack and API shape** are out of scope for this dimension but directly gate the sync-engine decision (RLS requires Postgres; a NoSQL backend would need a different enforcement pattern) — needs alignment with whichever dimension covers backend/data architecture.
- **Deployment target** (on-prem servers, Uzbekistan gov-cloud, or a private cloud region) was assumed but not confirmed — this affects whether any managed sync-engine cloud offering (Zero Cloud, PowerSync Cloud, Convex) is even legally usable, given personal-data localization law.
- **Triplit** could not be evaluated firsthand (site unreachable during this research); worth a hands-on spike before ruling in or out.
- **Loro's actual performance vs. Yjs/Automerge 3** could not be independently verified (vendor site returned 403); treat marketing claims as unverified until benchmarked in-house.
- **Whether a native/offline-first desktop wrapper (Electron/Tauri) is ever needed** for fully-offline field use (e.g., a regional office with no connectivity at all) — if so, PowerSync's SQLite-on-device model becomes far more attractive and this recommendation should be revisited.
- **Exact translator workflow** (who writes/maintains Uzbek and Russian strings, and whether they can work with PO/XLIFF files or need a hosted TMS) should decide between Paraglide (developer-centric) and Lingui or a hosted service like Crowdin/Lokalise (translator-centric) — not yet determined.
- This session's web-search tool budget was exhausted by concurrent research in this multi-dimension sweep; findings above rely on direct WebFetch of primary sources (vendor sites, docs, GitHub/npm/unpkg) rather than broad search, so some 2026 announcements outside the fetched set may be missing — a follow-up pass with search available would be prudent before final sign-off.

## Sources

- [React 19 (react.dev blog)](https://react.dev/blog/2024/12/05/react-19)
- [React Compiler docs (react.dev)](https://react.dev/learn/react-compiler)
- [Next.js 15 release notes](https://nextjs.org/blog/next-15)
- [TanStack Start docs](https://tanstack.com/start/latest)
- [TanStack Query v5 docs](https://tanstack.com/query/latest)
- [TanStack Form docs](https://tanstack.com/form/latest)
- [React Router — upgrading from Remix](https://reactrouter.com/upgrading/remix)
- [Rocicorp Zero](https://zero.rocicorp.dev/)
- [Zero — permissions docs](https://zero.rocicorp.dev/docs/permissions)
- [Electric (formerly ElectricSQL)](https://electric.ax/)
- [Electric blog listing (Databricks acquisition, Aug 2026)](https://electric.ax/blog)
- [PowerSync](https://www.powersync.com/)
- [InstantDB](https://www.instantdb.com/)
- [InstantDB essay — "Instant team joins OpenAI"](https://www.instantdb.com/essays/instant_team_joins_openai)
- [Jazz](https://jazz.tools/)
- [TinyBase](https://tinybase.org/)
- [Convex docs — home](https://docs.convex.dev/home)
- [Figma — How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Automerge 3.0 release blog](https://automerge.org/blog/automerge-3/)
- [Paraglide JS](https://paraglidejs.com/)
- [Zod](https://zod.dev/)
- [date-fns locale files, unpkg (v4.4.0)](https://unpkg.com/date-fns/locale/)
- [Reference site audit (internal)](../00-reference/reference-site-audit.md)
- [Jotai](https://jotai.org/)
- [jest-axe (GitHub)](https://github.com/nickcolley/jest-axe)
- [Sentry — self-hosted docs](https://develop.sentry.dev/self-hosted/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Ark UI](https://ark-ui.com/)
- [Mantine](https://mantine.dev/)
- [MDN — Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
- [size-limit (GitHub)](https://github.com/ai/size-limit)
- [vite-bundle-visualizer (npm)](https://www.npmjs.com/package/vite-bundle-visualizer)
- [web.dev — PWA web app manifest](https://web.dev/learn/pwa/web-app-manifest)

*Note: this session's WebSearch quota was exhausted before this dimension's research began (shared across concurrent research agents in this sweep); all findings above are grounded in direct WebFetch retrieval of primary sources rather than search-result summaries. Loro.dev and Triplit.dev returned errors (403 / connection refused) and could not be independently verified — their entries above are flagged accordingly.*

## Editor's verification notes (frontend-architecture-and-sync)

### Gaps: missing, thin, or hand-waved topics from the brief

1. **Jotai is entirely absent.** The brief explicitly names Zustand, Jotai, and XState as the state-management set to evaluate. The report only ever discusses Zustand and XState — Jotai (atomic state, a genuinely different model from Zustand's single-store approach and relevant if the People/Projects tables need fine-grained per-cell reactive state) gets zero mentions, not even a one-line dismissal. This is a straight brief miss, not a reasoned exclusion.
2. **Accessibility (a11y) is only implied, never addressed as its own topic.** §11 mentions Testing Library's accessible-query patterns "doubles as an accessibility check," but there is no discussion of WCAG conformance level, `axe-core`/`jest-axe`/Playwright a11y scanning, keyboard-navigation requirements, or screen-reader support — material for a mandatory-use government tool serving "civil servants on older machines," a population explicitly invoked elsewhere in the report but not followed through on.
3. **Frontend error monitoring/observability is missing.** No mention of Sentry (or any RUM/crash-reporting tool), which matters directly for a self-hosted/data-localization-constrained deployment (self-hosted Sentry vs. SaaS is exactly the kind of decision this report makes for every other category).
4. **Component/design system choice is name-dropped, not evaluated.** shadcn/ui is mentioned once in §10 as an aside ("works well with... shadcn/ui, which the reference site's visual language already resembles") but never actually recommended, compared against Radix/Ark UI/Mantine, or connected to the "goes viral for UI/UX" ambition — a real gap given how central visual polish is to the project's stated goals.
5. **Currency/number formatting is missing.** date-fns v4's uz/ru locale support is covered in depth, but `Intl.NumberFormat` for UZS (so'm) formatting — directly relevant to the Economic Development & FinTech sub-department's data — is never mentioned alongside the date/time section.
6. **Bundle analysis tooling is asserted, not instrumented.** §7 gives a budget ("~200KB gzipped for the shell") but names no tool (`vite-bundle-visualizer`, `rollup-plugin-visualizer`) to actually enforce or monitor it in CI, so the budget is currently unenforceable as written.
7. **PWA installability / offline-first specifics are thin.** §6 covers service-worker caching and mutation queue well, but says nothing about the web app manifest, install prompts, or whether an installed-PWA vs. browser-tab distinction matters for how civil servants actually access the tool day to day.

Adjacent topics a senior product/engineering lead would expect and that are absent: (a) Jotai (explicit brief item, see above), (b) accessibility/WCAG compliance as a named requirement, (c) frontend observability/error tracking, (d) a design-system/component-library decision given the "viral UI/UX" ambition is the project's own stated differentiator.

### Spot-check of 5 consequential claims

| # | Claim | Method | Result |
|---|---|---|---|
| 1 | InstantDB "announced it is sunsetting, with services continuing only until August 31, 2027" | WebFetch instantdb.com (live banner) | **Confirmed**, word-for-word: "Instant is sunsetting. Services will continue until August 31st, 2027." |
| 2 | Electric (ElectricSQL) "joined Databricks on Aug 11, 2026, alongside Neon, to build 'Lakebase'" | WebFetch electric.ax/blog | **Confirmed** — blog post "Electric is joining Databricks," Aug 11, 2026, by James Arthur, confirms joining Neon to build Lakebase. |
| 3 | date-fns v4.4.0 ships `uz.js`, `uz-Cyrl.js`, and `ru.js` locale files | WebFetch unpkg/app.unpkg date-fns@4.4.0 locale directory | **Confirmed** — all three files present and listed. |
| 4 | Zod v4 added `z.compile()` for ahead-of-time schema compilation and a memoization pass reducing memory footprint | WebFetch zod.dev | **Confirmed** (partially independently) — zod.dev lists blog posts "Introducing `z.compile()`" and "Reducing Zod's memory footprint by an order of magnitude with method memoization" as real, current entries. The report's "order of magnitude" memory figure matches the blog post's own title, so this is verified rather than invented. |
| 5 | InstantDB's shutdown timeline and reason ("sunsetting") | WebFetch instantdb.com/essays/instant_team_joins_openai | **Confirmed timeline, but incomplete framing** — the essay reveals the *entire InstantDB team is joining OpenAI*, not simply winding the product down: new signups closed immediately, 12 months for existing users to migrate off Instant Cloud, backups retained until Aug 31, 2028, and the DB remains open-source/self-hostable. The report's "announced it is sunsetting" is technically accurate but omits the OpenAI-acquisition detail, which is the more strategically relevant fact (it signals an AI-lab talent acquisition pattern, not a failed product) and slightly softens how avoidable-in-hindsight this outcome was for anyone tracking AI-lab hiring in 2026. **Correction, not fabrication** — treat as thin rather than wrong.

None of the five spot-checked claims were factually wrong; all were independently verifiable against primary sources, and four of five were exact confirmations. The one correction is a completeness issue (claim #5), not an inaccuracy.

### Overall assessment

The report is unusually well-sourced for a research-sweep dimension — it correctly flags its own unverifiable claims (Loro, Triplit) rather than asserting them, and its two most load-bearing 2026 facts (Electric/Databricks, InstantDB/OpenAI) both check out against primary sources. The main weakness is the missing Jotai coverage (a direct brief omission) plus four adjacent topics (a11y, observability, design system, currency formatting) that a senior lead evaluating this for a "goes viral" government UI would expect to see addressed, even briefly.

*Note on the InstantDB correction above: the main-body claim has since been corrected in place (§ "Local-first sync engines" table, TL;DR, "Bottom line on sync engines," and "Top 5 risks" §1) to lead with the OpenAI-acquihire framing rather than a bare "sunsetting" label. This verification-notes section is left as the historical record of the original review and is intentionally not rewritten.*

## Gap-fill addendum

Research for this addendum relied on direct WebFetch of primary sources (vendor docs, MDN, npm registry, GitHub READMEs) because this session's shared WebSearch budget was already exhausted before this pass began — the same constraint the original report flagged for itself. Where a claim below could not be corroborated by a second source, it is marked as vendor-reported.

### A. Jotai — the missing third leg of the state-management stool

The brief named **Zustand, Jotai, and XState** as the set to evaluate; the original report covered only two of three. Jotai (jotai.org) is an **atomic** state model, not a single-store model like Zustand: state lives as a graph of small `atom()` units, components subscribe via `useAtomValue`/`useSetAtom` only to the atoms they actually read, and React re-renders only the components whose atoms changed — no selector functions, no manual memoization, "eliminates the need for memoization" by design ([jotai.org](https://jotai.org/)). It is framework-idiomatic for React (works with the `use()` hook, supports Next.js/Waku SSR patterns) and is pitched across a range from "simple `useState` replacement" to "enterprise TypeScript application with complex requirements."

**Where Jotai vs. Zustand actually matters for this app:** Zustand's single-store model is the right fit for **coarse, occasional** UI state (sidebar collapsed, active modal, current theme) — exactly what the original report recommends it for. Jotai's atomic model earns its keep only where a UI has **many independent, frequently-changing pieces of state that must not cause sibling re-renders** — the clearest candidate here is the **Projects register's inline-editing table**: if each row/cell becomes its own atom (draft value, dirty flag, validation error), editing one cell re-renders only that cell, not the 50+-row table. Zustand can be made to do this too (per-row slices, `subscribeWithSelector`), but it is more ceremony; Jotai's model is native to exactly this shape of problem.

**Recommendation:** don't add Jotai speculatively. Ship Zustand for global UI state as already recommended. If, once the Projects/People inline-editing tables are built, cell-level editing feels janky or over-renders under React DevTools profiling, reach for Jotai **scoped to that one table's local editing state** rather than replacing Zustand wholesale — the two coexist fine in one codebase (they solve different-shaped problems) and this is a common, well-trodden pairing in the React ecosystem.

- **[ADAPT] Jotai, scoped to any single component with many independently-editable fields (e.g., an inline-editing table row/cell), only if profiling shows Zustand-based re-renders are a real problem** — not a default addition, and never a Zustand replacement.

### B. Accessibility — WCAG level, automated scanning, and what automated scanning can't catch

The original report only implies accessibility via Testing Library's "accessible-query" patterns. For a **mandatory-use government tool**, accessibility needs an explicit target and explicit tooling, not an implication.

**Target conformance level:** WCAG 2.1/2.2 **Level AA** is the de facto global baseline for public-sector digital services (it is what the EU's EN 301 549 and most national government accessibility mandates reference); adopt it explicitly as an acceptance criterion rather than leaving it unstated, even though Uzbekistan has no directly-cited WCAG mandate in scope for this research.

**Automated tooling — what to actually wire in:**
- **axe-core** is the underlying accessibility rules engine; **jest-axe** wraps it as a Jest matcher (`expect(await axe(container)).toHaveNoViolations()`) that integrates directly with Testing Library's `render()` output ([github.com/nickcolley/jest-axe](https://github.com/nickcolley/jest-axe)). Since the stack here is **Vitest, not Jest** (per §11), use **`vitest-axe`** (a Vitest-native port of the same `axe-core` + `toHaveNoViolations` pattern) instead of `jest-axe` directly — same API, correct test runner.
- **Playwright** has an official `@axe-core/playwright` integration, letting the same three ritual E2E flows (weekly comment, RSVP, escalation) also assert zero critical/serious axe violations on the actual rendered page, not just in jsdom — catches things component-level scans miss (real focus order, real color contrast, since **jest-axe/vitest-axe explicitly disable color-contrast checks in jsdom** because jsdom has no real layout engine).
- **The honest caveat, straight from jest-axe's own README:** "This project does not guarantee that what you build is accessible" — citing the UK Government Digital Service's own finding that **automated testing misses roughly 30% of accessibility barriers** ([github.com/nickcolley/jest-axe](https://github.com/nickcolley/jest-axe)). Automated scanning is a regression net, not a substitute for manual keyboard-only and screen-reader passes.

**Manual requirements to write into acceptance criteria, not leave implicit:**
- Full **keyboard navigability** (tab order, visible focus rings, Escape closes modals, no keyboard traps) across all five sections (Overview/People/Organization/Projects/Activities) — directly relevant to "civil servants on older machines," some of whom will be keyboard-first users on aging hardware/assistive tech.
- At least one **screen-reader pass** (NVDA on Windows is the realistic choice for a government-issued-Windows-PC user base, not VoiceOver/JAWS) on the Projects register and People directory before each is considered done, since these are the densest, most interactive surfaces.
- Respect `prefers-reduced-motion` for any animation (RSVP confirmations, escalation-queue transitions) — cheap to add, easy to forget, and a real WCAG 2.1 success criterion (2.3.3).

- **[ADOPT] WCAG 2.2 AA as an explicit, written acceptance criterion**, not an implied side-effect of using Testing Library.
- **[ADOPT] `vitest-axe` in component tests and `@axe-core/playwright` in the three ritual E2E flows**, as an automated regression net.
- **[ADAPT] One manual NVDA screen-reader pass and one keyboard-only pass** on the Projects register and People directory before first release — automated tooling alone misses ~30% of real barriers per GDS's own research.

### C. Frontend error monitoring / observability

Nothing in the original report addresses crash/error visibility once the app is in civil servants' hands — a real gap given how much of the rest of the report weighs self-hosting and data-localization for every other layer.

**Sentry** is the category leader (React/Vite SDK, source-map-aware stack traces, session replay, release health). It is **self-hostable** via Docker Compose, which satisfies data-localization: personal data (error context, user IDs, session replay frames) never leaves Uzbekistan if the self-hosted instance runs in-country. Concrete requirements from Sentry's own self-hosting docs: **4 CPU cores, 16GB RAM + 16GB swap (32GB recommended), 20GB disk, Docker ≥19.03.6, Docker Compose ≥2.32.2**, and the docs warn self-hosted Sentry is disk-I/O-heavy — watch `iowait` ([develop.sentry.dev/self-hosted](https://develop.sentry.dev/self-hosted/)). Licensing is the **Functional Source License (FSL)**: free to self-host and use internally, code converts to Apache 2.0 after two years, but you cannot resell it as a competing service — a non-issue for internal ministry use. Self-hosted Sentry drops some SaaS-only features (Seer AI features, spend controls, some mobile symbolication) that this project doesn't need anyway.

**GlitchTip** is the lighter-weight self-hosted alternative: it speaks the same Sentry SDK/DSN protocol (so the React/Vite integration code is identical) but is a smaller, simpler Django app with far lower resource requirements than Sentry's own multi-service Docker stack — a better fit if a 23-person, later-multi-tenant deployment doesn't want to operate Sentry's heavier Kafka/Clickhouse-backed self-hosted architecture.

**Recommendation:** given the data-localization constraint already established for every other layer of this system, treat frontend error monitoring as **mandatory infrastructure, not optional polish** — an unhandled exception in the Projects register that nobody sees is exactly the kind of silent failure the reference audit's "privacy by design" and reliability goals are meant to prevent. Start with **GlitchTip** for its lower operating cost at 23-person scale (same client SDK, so migrating to full Sentry later if the platform scales across ministries is a config change, not a rewrite).

- **[ADOPT] Sentry-protocol error monitoring, self-hosted in-country**, starting with **GlitchTip** for lower ops overhead at current scale, with a documented, low-cost migration path to full self-hosted Sentry if/when the platform scales to multi-tenant, multi-ministry use.
- **[AVOID] Sentry SaaS (sentry.io)** or any other error-monitoring SaaS that would send Uzbek personal/session data outside the country — a straightforward data-localization violation.

### D. Component / design system: shadcn/ui vs. Radix vs. Ark UI vs. Mantine

The original report mentions shadcn/ui once in passing on forms; the "goes viral for UI/UX" ambition deserves an actual evaluation.

| Option | Model | Accessibility | Styling | Fit for this app |
|---|---|---|---|---|
| **shadcn/ui** | Copy-paste source (not an npm dependency) generated via CLI into your repo; built on Radix primitives + Tailwind | Inherits Radix's WAI-ARIA-correct primitives | Tailwind, fully owned/editable since the code lives in your repo | **Recommended** — "code you can customize, extend, and make your own" ([ui.shadcn.com](https://ui.shadcn.com/)) is exactly the right model for a team that wants a distinctive, ownable visual identity (the viral-UI ambition) without maintaining primitives from scratch |
| **Radix UI (Primitives)** | Headless, unstyled, npm dependency | WAI-ARIA patterns baked in | Bring your own (Tailwind/CSS) | The foundation shadcn/ui is built on — using it directly means building your own design-system layer on top, more work for the same accessibility floor |
| **Ark UI** | Headless, unstyled, npm dependency; maintained by the **Chakra UI team** (Chakra Systems) | WAI-ARIA patterns baked in | Bring your own (Panda CSS, Tailwind, CSS-in-JS, plain CSS) | Notable for being genuinely **framework-agnostic** — "the same API works across React, Solid, Vue, and Svelte" ([ark-ui.com](https://ark-ui.com/)) — a real hedge if this platform ever needs a non-React surface (e.g., a lightweight embed for another ministry's existing site), but that's a speculative future need, not a current one |
| **Mantine** | Fully-styled, opinionated component library (v9.6, 120+ components, 70+ hooks) with built-in dark mode | Emphasizes accessible-by-default components | Own styling system (not Tailwind-based) | Fastest path to a complete UI (form components, dates, notifications all included out of the box) but the opinionated styling fights the "distinctive, ownable" viral-UI goal — you get Mantine's look, not yours, unless you invest in overriding its Styles API |

**Recommendation: shadcn/ui**, for two reasons specific to this project. First, because the code is copied into the repo rather than installed as a dependency, the team **fully owns and can restyle every component** — the precondition for building a visually distinctive, "viral" government UI rather than an off-the-shelf-looking one. Second, it inherits Radix's accessibility floor for free, directly serving the WCAG AA target in gap (B) above without extra primitive-building work. Reserve Ark UI as the fallback if a genuine cross-framework need materializes later (unlikely for v1); Mantine is the right call only if the team explicitly prioritizes shipping speed over visual distinctiveness, which conflicts with the project's own stated differentiator.

- **[ADOPT] shadcn/ui (Radix + Tailwind, copy-paste ownership model)** as the component foundation — directly serves both the accessibility floor and the "distinctive, ownable UI" ambition.
- **[AVOID] Mantine or another fully-opinionated, pre-styled library** for the primary UI — its baked-in look works against the project's own "goes viral for UI/UX" differentiator.
- **[ADAPT] Ark UI** only if a genuine multi-framework requirement emerges later (e.g., embedding a widget in another ministry's non-React site) — not a v1 concern.

### E. Currency / number formatting (UZS)

Missing despite date/locale formatting getting a full section (§9) and FinTech being one of the four sub-departments. `Intl.NumberFormat` is the right, zero-dependency tool — it is a browser-native web standard, requires no library, and composes with the same `uz`/`ru`/`en` locale set already chosen for dates:

```js
new Intl.NumberFormat("uz-UZ", { style: "currency", currency: "UZS" }).format(1234567.89)
```

Practical notes for this project specifically: the Uzbek som's minor unit (tiyin) has been out of practical circulation for years — set `minimumFractionDigits: 0` (and `maximumFractionDigits: 0`) for UZS amounts so the UI never shows "so'm and tiyin" the way it would default to two decimal places, matching how Uzbek users actually read money in daily life (compare `Intl.NumberFormat`'s own documented JPY behavior, which similarly renders with zero decimal places since yen has no practical minor unit — [MDN Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)). For large budget figures (the FinTech/Economic Development sub-department will show amounts in the billions of som), also consider `notation: "compact"` (renders e.g. "1.2 mlrd" style abbreviations per-locale) for dashboard tiles where a full-precision number would overflow a KPI card, falling back to full precision in tables and exports.

- **[ADOPT] `Intl.NumberFormat` with `style: "currency", currency: "UZS"` and `minimumFractionDigits: 0`** for all som amounts — zero-dependency, locale-correct, and matches real Uzbek money-display conventions.
- **[ADAPT] `notation: "compact"` for KPI-tile/dashboard display of large sums only**, with full-precision figures preserved in tables, exports, and anywhere audit-relevant.

### F. Bundle-budget enforcement in CI

§7 asserts a ~200KB gzipped budget but names no enforcement tool, which the original review correctly flagged as making the number unenforceable. Two complementary tools close this gap:

- **`vite-bundle-visualizer`** (current version 1.2.1 on npm, requires Node `^18.19.0 \|\| >=20.6.0`) generates a treemap of what's actually in the production bundle — the diagnostic tool for **understanding** *why* the budget was blown, run locally or in CI as an artifact upload for PR review.
- **`size-limit`** (ai/size-limit) is the **enforcement** tool: it "checks every commit on CI, calculates the real cost of your JS for end-users and throws an error if the cost exceeds the limit," supports esbuild/webpack/file-size presets, and its official GitHub Action **posts the bundle-size diff directly as a PR comment** ([github.com/ai/size-limit](https://github.com/ai/size-limit)) — turning the abstract "~200KB" budget from this report's §7 into a real, unbypassable CI gate that fails the build (and visibly flags the regression in review) the moment a PR would exceed it.

**Recommendation:** use both, for different jobs — `size-limit` as the CI gate (fails PRs that exceed the shell budget), `vite-bundle-visualizer` as the on-demand/local diagnostic when a PR does fail, to see what to cut.

- **[ADOPT] `size-limit` wired into CI with its GitHub Action**, configured against the ~200KB gzipped shell budget from §7 — makes the budget enforceable rather than aspirational.
- **[ADOPT] `vite-bundle-visualizer` as a local/on-demand diagnostic** for investigating what to trim when `size-limit` fails a PR.

### G. PWA manifest / installability specifics

§6 covers the service worker and mutation-queue well but says nothing about actual installability. A PWA's web app manifest technically requires only a `name` field, but real cross-browser installability (the "Add to Home Screen" / desktop-install prompt) needs, concretely: `name` (or `short_name` for constrained home-screen space), an `icons` array (at minimum a 192×192 and a 512×512 PNG, ideally a maskable icon for Android's adaptive-icon shape), `start_url`, `display: "standalone"` (removes browser chrome so the installed app doesn't look like "just a tab"), `theme_color`, and `background_color` (shown as a splash-screen placeholder while the app boots) ([web.dev/learn/pwa/web-app-manifest](https://web.dev/learn/pwa/web-app-manifest)).

Why this matters specifically for this project: an **installed PWA** (desktop icon or Android/Windows taskbar entry, `display: standalone`) is a materially different first impression for a "goes viral across government" ambition than "a bookmarked browser tab" — it reads as a real application, not a webpage, which is exactly the kind of small perception detail that drives organic spread ("colleague sees the app icon on someone's taskbar and asks what it is") in a low-training-budget, word-of-mouth adoption context. Concretely: ship a complete manifest from day one (not an afterthought), including maskable icons, and surface an explicit "Install app" affordance (captured `beforeinstallprompt` event) rather than relying only on the browser's own install-icon in the address bar, which most civil servants will never notice unprompted.

- **[ADOPT] A complete web app manifest from v1** (name, maskable + standard icons, `display: standalone`, theme/background colors) — not just the service-worker/offline-queue half of PWA support already planned.
- **[ADAPT] An explicit in-app "Install" button/banner using the captured `beforeinstallprompt` event**, rather than relying on users to notice the browser's own install icon — meaningfully increases install rate for a non-technical government user base.
