# Notion data model and block editors

**TL;DR:** Notion's core trick is deceptively simple — everything is a block in a recursive tree, and a "database" is just a filtered/sorted view over a folder of block-pages with typed metadata bolted on; this one model powers docs, wikis, kanban, calendars and light CRM alike. It scales badly (480 Postgres shards, still a 1,000-row "soft ceiling" before UX degrades, no true offline, notorious permissions confusion) and is fundamentally a US/EU/APAC AWS SaaS with no on-prem or Central-Asia data-residency option — a hard blocker for Uzbekistan's data-localization law. The open-source editor ecosystem has converged on two viable foundations for a from-scratch block/document layer: ProseMirror-family (Tiptap, BlockNote) and Meta's Lexical, both paired with the Yjs CRDT for real-time collaboration; BlockNote is the closest pre-built "Notion clone" and already markets itself to public-sector customers. Full local-first "object" platforms (AFFiNE, AppFlowy, Anytype) are worth studying for ideas but are too heavy, too opinionated, or too immature to fork wholesale for a government line-of-business tool. Recommendation: build a bounded block editor on **Tiptap v3 (ProseMirror) + Yjs + self-hosted Hocuspocus**, model databases as first-class typed tables (not generic blocks) from day one, and deliberately copy Notion's UX vocabulary (`/` command, `@` mention, block hover handle) while rejecting its everything-is-a-freeform-page philosophy.

---

## 1. How Notion actually works

### 1.1 The block model

Notion's own engineering blog describes the atomic unit precisely: a **block** has an `id` (random UUIDv4), a `type` (paragraph, heading, image, database, column, …), a `properties` bag whose shape depends on `type`, a `content` array of child block IDs (an ordered list — this *is* the render tree), and a `parent` pointer back to its container. Indentation, nesting, and drag-and-drop are not visual tricks; they are literal mutations of the `content` array and `parent` field. Permission checks walk **upward** via `parent` rather than downward via `content`, because a block can be legitimately referenced from more than one place (see synced blocks below), which would make downward permission resolution ambiguous [Notion eng blog — Data model behind Notion](https://www.notion.com/blog/data-model-behind-notion).

Every page is a block of type `page`. Every database row is *also* a full page-block — Notion's own help text is explicit: "every item you enter into your database is a Notion page" [Notion Help — Intro to databases](https://www.notion.com/help/intro-to-databases). This is the central design decision: **a database is not a separate storage engine, it is a folder of page-blocks plus a schema (property definitions) plus one or more saved views.** That unification is what lets you open any row and it's instantly a full document — but it's also the root of most of Notion's scaling and performance problems, because a "table" in Notion costs one full page-tree per row, not one row in a columnar store.

### 1.2 Properties, views, relations, rollups, formulas

- **Properties** are typed fields attached to a database's schema (title, select, multi-select, person, date, checkbox, number, formula, relation, rollup, files, status, etc.), rendered at the top of each row-page.
- **Views** (table, board, timeline, calendar, gallery, list) are independent, savable combinations of filter + sort + group + visible-properties over the *same* underlying rows — "unlimited views of the same database" [Notion Help — Intro to databases](https://www.notion.com/help/intro-to-databases).
- **Relations** link rows across two databases bidirectionally ("two-way relations" auto-sync both sides); a database can relate to itself for parent/child hierarchies (e.g., tasks → subtasks). Duplicating a database silently converts two-way relations to one-way, and CSV export flattens relations to plain-text URLs that cannot be re-imported [Notion Help — Relations and rollups](https://www.notion.com/help/relations-and-rollups).
- **Rollups** aggregate across a relation (count, sum, average, min/max, earliest/latest date, etc.) but **cannot roll up a rollup** — "this could create unintended loops" per Notion's own docs — forcing awkward duplicate relation chains for multi-hop aggregation [Notion Help — Relations and rollups](https://www.notion.com/help/relations-and-rollups).
- **Formulas** (formula 2.0, spreadsheet-like syntax) read other properties, relations and rollups but cannot write back to them, and complex formulas silently exceed the editor's practical depth (deeply nested `if`/`format` chains are hard to write and effectively impossible to debug in the current UI — well-documented pain point in the wider community, though Notion's own docs don't quantify a limit).

### 1.3 Synced blocks, templates, comments

**Synced blocks** are Notion's answer to "single source of truth" content reuse: edit one instance, all copies update. The mechanism is explicitly a hub-and-spoke replica model, not a CRDT merge — and it has a hard operational cliff: "if a synced block has more than 10 copies, clicking Unsync all, or deleting the original... will remove all copies" [Notion Help — Synced blocks](https://www.notion.com/help/synced-blocks). Viewers also need permission on the *original* page to see a synced copy anywhere else, which produces confusing "why can't I see this" support tickets.

**Templates** are just page-blocks (or "template buttons" that insert a predefined block subtree) — no separate schema, so a template drifting out of sync with its database's properties is a common failure mode reported across the user community.

**Comments** come in two forms: page-level (top-of-page thread) and inline (select text → comment, or `Cmd/Ctrl+Shift+M`), aggregated in a per-page pane filterable by person/resolved-state; `@mentions` notify people, link pages (with automatic backlinks), or insert live dates — but a mention on a page the mentioned person can't access produces silent non-notification, another quiet permissions trap [Notion Help — Comments, mentions and reminders](https://www.notion.com/help/comments-mentions-and-reminders).

### 1.4 Permissions model — and why it confuses people

Notion layers **workspace roles** (owner/admin/member/guest) under **per-page sharing** (Full access / Can edit / Can edit content / Can create / Can comment / Can view) under **general-access mode** (Only invited / Everyone at {workspace} / Anyone with link). Sub-pages inherit the parent's permissions by default. The rule that trips people up in practice: Notion always grants **the broadest permission a user has from any path** — if someone has workspace-wide edit access, a stricter per-page restriction on one database is simply overridden, "requiring administrative intervention at multiple levels" to actually lock something down [Notion Help — Sharing and permissions](https://www.notion.com/help/sharing-and-permissions). Combined with silent inheritance, this is the single most common source of "why can this intern see HR salary data" incidents in Notion workspaces at growing companies — precisely the failure mode a government HR/People module cannot afford.

### 1.5 The wider product surface (2025–2026)

- **Notion AI**: workspace-embedded assistant plus "Notion Agent" (autonomous multi-step task runner, ships broadly on Business+), Custom Agents (team-buildable, promotional free period through May 3 2026 before usage-based "Notion credits" billing begins May 4 2026), Enterprise Search across connected apps (Slack, GitHub, Drive), AI Meeting Notes (transcribe + summarize), formula-writing and database autofill assistance [Notion — AI product page](https://www.notion.com/product/ai).
- **Notion Calendar** (rebrand of the acquired **Cron** app): unifies personal + workspace calendars, scheduling/booking links, multi-provider sync (Google/Outlook/iCloud), drag-and-drop of Notion database items onto the calendar, native macOS/Windows/iOS/Android apps, 12 languages, free [Notion — Calendar product page](https://www.notion.com/product/calendar).
- **Notion Mail** (launched publicly 15 April 2025): AI auto-labeling inbox, custom views instead of folders, one-click snippets, native Notion-Calendar scheduling, Notion-block formatting in emails; the launch announcement is explicit that onboarding is "simply connect your Gmail and get going" — i.e. **Gmail-account-first at launch**, web + macOS, iOS "coming soon" [Notion Blog — Introducing Notion Mail](https://www.notion.com/blog/introducing-notion-mail). Gmail-first onboarding is a real constraint for any org not on Google Workspace; whether non-Gmail (Outlook/IMAP) support has since shipped in 2025–2026 could not be confirmed this pass — Notion's current help pages for Notion Mail returned 404s to direct fetch, so treat "Gmail-only, still" as **last-confirmed-at-launch, not re-verified for September 2026**.
- **Notion Sites**: no-code website publishing straight from a Notion page/database, 10,000+ templates, custom domains/branding/SEO/analytics gated to Plus/Business/Enterprise [Notion — Sites product page](https://www.notion.com/product/sites).

### 1.6 Infrastructure and why it matters to us specifically

Notion's engineering blog on scaling Postgres is the most technically candid material they've published: by 2020/21 the single-Postgres design hit **transaction-ID wraparound risk** and stalled `VACUUM`, forcing a migration to **480 logical shards across 32 physical databases**, partitioned by `workspace_id` so that "each block belongs to exactly one workspace" and most queries stay single-shard; they sharded *every* table reachable from `block` via foreign key (spaces, discussions, comments) rather than partially shard, specifically to avoid cross-datastore consistency bugs [Notion Blog — Sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion). Their own hindsight advice: shard earlier, pick composite keys upfront. This is a direct, expensive lesson for anyone building a similar recursive block+workspace model — **don't defer sharding-by-tenant design even at small scale**, which is directly applicable to our multi-tenant ambition (department → ministries).

On hosting: **data residency is an Enterprise-only feature**, limited to three AWS region groups — US-West-2/US-East-2, EU-Central-1(Frankfurt)/EU-West-1, and an APAC set (Tokyo/Osaka/Seoul, "contact required") — with account metadata and subprocessor data explicitly allowed to live *outside* the chosen region regardless [Notion Help — Data residency](https://www.notion.com/help/data-residency). There is **no self-hosted or on-premise Notion**, no Central Asian region, and no FedRAMP mention on Notion's security page, only SOC 2 Type II, ISO 27001/27701/27017/27018, HIPAA-with-BAA, and Germany's BSI C5 [Notion — Security & compliance](https://www.notion.com/security). For a Uzbek government department bound by data-localization law for citizen/employee personal data, **Notion itself is not a legally usable product**, full stop — this is the strongest single argument in this whole report for building our own layer rather than adopting Notion as a vendor.

### 1.7 Known weaknesses and failure modes (contrarian evidence)

| Weakness | Evidence |
|---|---|
| **Performance degrades with scale** | Notion's own help text warns that databases over ~1,000 items start inserting new pages mid-list rather than at the end due to indexing/sort behavior [Notion Help — Intro to databases](https://www.notion.com/help/intro-to-databases). |
| **No real offline mode** | Everything round-trips through Notion's servers; practitioner consensus (Hacker News) is blunt: "everything has to go through the web, nothing is local, and the performance bottleneck is their server," with Notion explicitly trading dev velocity for polish — "speed of dev & features more than nicer, but slower to develop tools" [Hacker News comments via Algolia](https://hn.algolia.com/api/v1/search?query=notion%20slow%20performance&tags=comment). |
| **Permissions are confusing at org scale** | The "broadest access wins" rule plus silent sub-page inheritance is a structural trap, not a UI bug — see §1.4. |
| **Rollup-of-rollup is blocked by design** | Forces users into duplicate relation chains for anything beyond one hop of aggregation [Notion Help — Relations and rollups](https://www.notion.com/help/relations-and-rollups). |
| **Synced blocks have a hard fan-out ceiling** | >10 copies and the "unsync all"/delete-original action nukes every copy at once — a landmine for department-wide "policy paragraph" reuse patterns [Notion Help — Synced blocks](https://www.notion.com/help/synced-blocks). |
| **CSV round-trip is lossy** | Relations export as flat text URLs and cannot re-import, breaking common "export, edit in Excel, re-import" government workflows [Notion Help — Relations and rollups](https://www.notion.com/help/relations-and-rollups). |
| **Templates drift from schema** | Because templates are just block subtrees, not schema-bound, they silently go stale when a database's properties change (widely reported community pain, not covered in Notion's own docs). |
| **No sovereign/on-prem hosting** | See §1.6 — this alone disqualifies Notion for the Uzbek use case. |

---

## 2. Open-source block/document editor landscape

### 2.1 Core rich-text engines

| Engine | License | Backing / maturity | Collaboration | Table support | Notes |
|---|---|---|---|---|---|
| **ProseMirror** | MIT (community-funded; commercial users socially expected to sponsor) | Marijn Haverbeke; sponsored by NYT, Asana, Box; the substrate under Tiptap, BlockNote, Remirror | "Ground-up, rock solid" CRDT-friendly collab primitives built in [ProseMirror.net](https://prosemirror.net/) | Via extension (`prosemirror-tables`) | Schema-first, functional/immutable state — the most battle-tested foundation in this list. |
| **Tiptap v3** | MIT core; Pro extensions & Tiptap Cloud paid | ueberdosis; 38.3k GitHub stars [github.com/ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Built-in Collaboration extension over Yjs; **Hocuspocus** (MIT, self-hostable WebSocket server, scales via Redis, runs on Node/Bun/Deno/Cloudflare Workers) or paid **Tiptap Cloud** [Tiptap — Hocuspocus docs](https://tiptap.dev/docs/hocuspocus/introduction) | Yes, via extension | 100+ extensions, slash commands, mentions, AI Toolkit; **correction (2026-09-05 gap-fill pass): Markdown import/export is now a free, official, MIT, bidirectional extension (`@tiptap/markdown`, shipped Oct 2025) — only DOCX/ODT/PDF/EPUB conversion and comments/track-changes remain paid Tiptap Cloud add-ons; several extensions this table implied were Pro (emoji, drag-handle, table-of-contents) have also since been open-sourced as MIT** — see §5 addendum [tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap](https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap) |
| **BlockNote** | MPL-2.0 core; "XL" packages GPL-3.0 (commercial license needed for closed-source use of those) | TypeCellOS; 10.1k stars; ~100k weekly installs claimed; built *on* ProseMirror + Yjs, upstream-contributes to Hocuspocus/Tiptap [github.com/TypeCellOS/BlockNote](https://github.com/TypeCellOS/BlockNote) | Native, Yjs-based, real-time out of the box | Built-in block type | Explicitly a **pre-built Notion-style block editor**, not just a text-editor toolkit — slash menu, drag handles, formatting toolbar, comments+mentions, AI write/redact, and states it's "used by startups, public institutions and established companies" [blocknotejs.org/about](https://www.blocknotejs.org/about) (no named case studies given). Closest off-the-shelf match to what we want. |
| **Lexical** | MIT (Meta) | Meta-built, replaces Facebook/Messenger/WhatsApp-web editors internally; modular plugin packages for lists/links/tables [lexical.dev](https://lexical.dev/) | Via `@lexical/yjs` plugin (not on the marketing homepage but a known official package) | Via plugin | Very lean core, editor-state-as-immutable-tree philosophy close to ProseMirror's; steeper "assemble it yourself" cost than Tiptap/BlockNote but no license friction at all (pure MIT). |
| **Plate** | MIT | udecode; 16.6k stars, built on **Slate.js** [github.com/udecode/plate](https://github.com/udecode/plate) | Not native/first-class (Slate's collab story is the weakest of the four) | Via plugin | Strong shadcn/ui integration and AI-editor templates; best fit if we're already a shadcn/Tailwind shop and don't need hard real-time co-editing on day one. |
| **Milkdown** | MIT | Built on ProseMirror + Yjs + Remark; markdown-native, fully headless (no bundled CSS) [milkdown.dev](https://milkdown.dev/) | Yes, via Yjs | Via plugin | Best choice if the canonical storage format should *be* Markdown (e.g., docs that must round-trip cleanly to git/Markdown files) rather than a bespoke JSON block tree. |
| **Editor.js** | Apache-2.0 | CodeX (non-profit); "#1 on Product Hunt" historically, large plugin catalog | **None built-in** — no official real-time collaboration story | Via plugin | Clean block-JSON output is nice for multi-surface rendering, but the lack of any native collaboration layer rules it out for a team tool where simultaneous editing matters [editorjs.io](https://editorjs.io/). |

### 2.2 Collaboration/CRDT layer

- **Yjs**: MIT-licensed CRDT, "the fastest CRDT implementation" per its own benchmarks, network-transport-agnostic (works over WebRTC, WebSocket, or any custom transport), with official bindings for ProseMirror, Tiptap, Monaco, CodeMirror, Quill, Remirror [docs.yjs.dev](https://docs.yjs.dev/). This is the de facto standard binding layer under Tiptap, BlockNote, Milkdown, and AFFiNE's BlockSuite.
- **Hocuspocus**: MIT, self-hosted WebSocket backend for Yjs docs, offline-first, webhook support, scales via Redis across Node/Bun/Deno/Cloudflare Workers [tiptap.dev/docs/hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) — this is the piece that lets us avoid vendor lock-in for real-time sync while staying inside Uzbek infrastructure.
- **Liveblocks**: proprietary SaaS (Free/Pro/Team/Enterprise tiers), managed real-time sync + comments + notifications + AI-agent hooks, with native adapters for Tiptap, BlockNote, Lexical [liveblocks.io](https://liveblocks.io/) — convenient but a US-hosted third-party data path, which conflicts with data-localization requirements for anything containing personal data.
- **PartyKit**: open-source real-time/multiplayer deployment platform, folded into **Cloudflare** as of an April 2024 announcement ("joining Cloudflare to build the future of stateful serverless computing") [partykit.io](https://www.partykit.io/) — effectively superseded by Cloudflare's own Durable-Objects-based Agents SDK; treat PartyKit as a historical stepping-stone, not a current recommendation, and verify current maintenance status before any dependency.

### 2.3 Full "local-first object workspace" platforms

| Platform | License | Model | Self-host | Stars | Verdict |
|---|---|---|---|---|---|
| **AFFiNE** | MIT (Community Edition); Enterprise Edition planned | **BlockSuite** engine — blocks placed on an "edgeless canvas" mixing docs, whiteboard, embeds, and multi-view databases | Docker (Render/Sealos documented) | 72.2k [github.com/toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) | Best architectural reference for a unified doc+canvas+database block engine; still "canary"-branch active development — high feature ambition, real production-readiness risk for a government SLA. |
| **AppFlowy** | AGPLv3 [github.com/AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | Rust core + Flutter UI, positions itself as an "AI workspace" (docs, wiki, project mgmt, AI search/meeting notes) | On-prem, private cloud, air-gapped explicitly supported; SOC2/GDPR/HIPAA/ISO27001 claimed; SAML/OIDC/SCIM/LDAP | 76.3k, 8M+ downloads, 1M+ Docker pulls [appflowy.com](https://appflowy.com/) | Most enterprise/gov-hosting-friendly of the three by explicit design (air-gapped support is called out), but AGPLv3 is a strong-copyleft license — any modified server code we ship or run as a network service likely triggers source-disclosure obligations; needs legal review before use as a base. |
| **Anytype** | "Any Source Available License 1.0" — **not** an OSI-approved open-source license | Object-based (not block-tree) — everything is a typed, user-definable "object" with relations, offline-first, optional P2P sync, zero-knowledge encryption | Partial — P2P-oriented, not a conventional server you deploy | 8.8k [github.com/anyproto/anytype-ts](https://github.com/anyproto/anytype-ts) | Interesting object/relation model to study, but the license is source-available, not free/open, and the P2P-first architecture doesn't map cleanly onto a centrally-administered multi-tenant government platform. |

### 2.4 Cross-cutting comparison: mentions, slash commands, export

All four "editor framework" leaders (Tiptap, BlockNote, Plate, Lexical) support `/` slash-command menus and `@` mention popups as standard extension patterns — this is now table-stakes UX, not a differentiator. Export maturity varies sharply: **Tiptap** has paid first-party DOCX/Markdown/ODT/PDF conversion; **BlockNote** and **Plate** rely more on community/DIY exporters; **Editor.js**'s clean JSON is the easiest format to transform into *anything* (including print-ready PDF or plain text for SMS/Telegram) precisely because it never aspired to being a Notion clone. For a bilingual (Uzbek Latin/Cyrillic risk, Russian, English) government tool, plain robust Markdown/JSON export matters more than DOCX fidelity — a point in favor of Milkdown- or Editor.js-style clean serialization even if we don't adopt either wholesale.

---

## 3. What this means for us

1. **[ADOPT] Model "block" and "database row" as the same underlying page-entity, Notion-style, but only inside a Documents/Notes module** — the unification is genuinely powerful for wikis, meeting notes, and mandates; do not try to reinvent it for that surface.
2. **[AVOID] Do not make *everything* in the platform (people, projects, activities) a generic freeform block database like Notion does.** Our reference audit already shows the value of Jira-like structured objects (Project, Person, Activity) with fixed, validated schemas and workflow rules (Friday-comment ritual, auto-escalation). Notion's genericness is exactly what produces template drift, permission confusion, and the "structureless swamp" failure mode governments hate. Use typed, first-class tables (proper relational schema) for Projects/People/Activities, and reserve the block editor for prose (notes, mandates, meeting minutes, comments).
3. **[ADOPT] Build the rich-text/notes layer on Tiptap v3 (ProseMirror) rather than writing a custom ProseMirror schema from scratch** — MIT-licensed, largest ecosystem (38.3k stars), most extension coverage, and directly supports self-hosted Yjs collaboration via Hocuspocus, so we own our data path end-to-end [github.com/ueberdosis/tiptap](https://github.com/ueberdosis/tiptap), [tiptap.dev/docs/hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction).
4. **[ADAPT] Evaluate BlockNote as a fast-start skin over Tiptap/ProseMirror for the notes/wiki surface** rather than building the slash-menu/drag-handle/formatting-toolbar UX by hand — it already implements the exact Notion-like block affordances we want, is MIT/MPL-friendly for our core use, and only its "XL" (AI, export) packages carry GPL-3.0 terms we'd need to license or avoid [github.com/TypeCellOS/BlockNote](https://github.com/TypeCellOS/BlockNote).
5. **[AVOID] Do not depend on Notion itself, or any US/EU-only SaaS (Notion, Liveblocks managed cloud, Coda), for anything touching citizen or employee personal data.** Notion has zero on-prem option and data residency limited to Enterprise-tier AWS regions (none in Central Asia); this directly conflicts with Uzbekistan's data-localization law [notion.com/help/data-residency](https://www.notion.com/help/data-residency), [notion.com/security](https://www.notion.com/security).
6. **[ADOPT] Self-host the real-time collaboration layer: Yjs + Hocuspocus, deployed inside Uzbek/gov infrastructure**, instead of Liveblocks or Tiptap Cloud — both are capable managed products but route document content through third-party servers outside our jurisdiction [liveblocks.io](https://liveblocks.io/), [docs.yjs.dev](https://docs.yjs.dev/).
7. **[ADAPT] Borrow Notion's block data model shape (id / type / properties / ordered content[] / parent) for our own notes/wiki schema**, including the "permission checks walk upward via parent" trick — it's a clean, proven pattern for tree-shaped access control, described directly by Notion's own engineers [notion.com/blog/data-model-behind-notion](https://www.notion.com/blog/data-model-behind-notion).
8. **[AVOID] Do not copy Notion's "broadest access wins" permission-resolution rule.** For an HR/People module with a hard public/internal/restricted privacy-tier requirement (already specified in our own reference audit), permissions must be **most-restrictive-wins** with explicit, auditable overrides — the opposite of Notion's default, which is a known source of accidental oversharing.
9. **[AVOID] Do not copy synced blocks' >10-copy fragile fan-out model.** If we want "one paragraph, many pages" content reuse (e.g., a shared department mandate paragraph), implement it as a proper reference/transclusion with no arbitrary copy-count cliff, or simply don't offer it in v1 — it's a nice-to-have, not core.
10. **[ADOPT] Shard/partition by tenant (department/ministry) from the very first schema design**, exactly per Notion's own hard-won lesson from their Postgres migration — our multi-tenant ambition means we should pick a `tenant_id`-first partitioning strategy (even if starting on one Postgres instance with `tenant_id` indexes and row-level security) rather than retrofitting it after painful growth [notion.com/blog/sharding-postgres-at-notion](https://www.notion.com/blog/sharding-postgres-at-notion).
11. **[ADAPT] Study AFFiNE's BlockSuite and AppFlowy's architecture for ideas, but do not fork either as our base.** AFFiNE is still canary/pre-1.0 with production-readiness risk; AppFlowy's AGPLv3 license creates copyleft obligations that need legal sign-off before use in a government product we might also want to keep some components proprietary/closed for security review purposes [github.com/toeverything/AFFiNE](https://github.com/toeverything/AFFiNE), [github.com/AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy).
12. **[AVOID] Do not adopt Anytype's object model or license.** The "Any Source Available License" is not free/open source in the legal sense we'd want for a government-owned platform we intend to potentially share across ministries, and its P2P-first sync model doesn't fit a centrally administered, auditable government system [github.com/anyproto/anytype-ts](https://github.com/anyproto/anytype-ts).
13. **[ADOPT] Cap and design around database size deliberately** — treat "hundreds of rows per department table" as the target scale (our real numbers: 23 people, ~14 projects), not "unlimited Notion-style tables," and use that constraint to justify a simpler, faster, purpose-built table UI instead of chasing Notion's generic-database feature parity (Notion's own 1,000-row soft ceiling is proof the generic approach doesn't even scale that far) [notion.com/help/intro-to-databases](https://www.notion.com/help/intro-to-databases).
14. **[ADOPT] Offer real offline support as a differentiator**, something Notion structurally lacks (server-round-trip architecture per community consensus) — a CRDT-based editor (Yjs) gives us this almost for free if we design the sync layer correctly from day one, which matters for civil servants with unreliable connectivity [Hacker News via Algolia](https://hn.algolia.com/api/v1/search?query=notion%20slow%20performance&tags=comment).
15. **[ADOPT] Keep the block/document editor's UI vocabulary Notion-familiar (`/` slash menu, `@` mention, hover-to-reveal block handle, inline comment via text selection) even though the underlying data model differs**, because civil servants who have seen Notion, Word, or Telegram will recognize these interaction patterns instantly — this is exactly the "zero training" lever without inheriting Notion's structural problems [notion.com/help/comments-mentions-and-reminders](https://www.notion.com/help/comments-mentions-and-reminders).

---

## 4. Open questions

- **Formula-engine depth**: how far do we need go-to spreadsheet-style formulas across our own typed tables (Projects/People)? Notion's formula 2.0 is powerful but has a documented ceiling; we could not verify an exact nesting/complexity limit from official docs and would need a product-owner decision on whether formulas are in scope for v1 at all.
- **Which license risk tolerance applies to AppFlowy (AGPLv3) and BlockNote's "XL" (GPL-3.0) packages** — needs a formal legal review specific to Uzbek government software-procurement rules before any component under copyleft terms is included even as a reference implementation.
- **Telegram-native collaboration**: none of the editors surveyed have a native Telegram Mini App or bot integration pattern for block editing; this needs a separate spike (likely: read-only/notification integration via Telegram Bot API, not full co-editing inside Telegram).
- **Government adoption of BlockNote specifically** — their own marketing claims "public institutions" use it but names no examples; we could not independently verify which governments or what scale, so treat this as a soft signal, not proof of gov-readiness.
- **AFFiNE/BlockSuite production stability** — the project is still on a "canary" branch per its own repo with 11,000+ commits of ongoing churn; before treating it as a serious architecture reference we'd want a stability/roadmap check directly with the maintainers.
- **PartyKit's current status** post-Cloudflare acquisition (announced April 2024) is unclear from the material we could access — verify whether it is still independently viable or has been fully absorbed into Cloudflare's Agents/Durable Objects SDK before considering it for anything.
- **Exact Notion formula/relation nesting limits and CSV/API row limits (API pagination is 100 rows/page)** were not fully documented in the pages we could reach; if a literal "why Notion breaks at N rows" number is needed for a leadership deck, it should be sourced directly from Notion's current API/help docs at build time.
- **Methodology caveat**: this session's live web-search tool (`WebSearch`) reported its query budget already exhausted before any query for this dimension could run; all findings above come from direct page fetches (`WebFetch`, 25+ pages) plus the Hacker News Algolia API rather than open-ended search, so coverage of forum/community sentiment (Reddit threads, in particular, were unreachable) is thinner than ideal — a follow-up pass with search access would strengthen the "what users hate" section.

---

## Sources

1. [Notion Help — Intro to databases](https://www.notion.com/help/intro-to-databases)
2. [Notion Help — Relations and rollups](https://www.notion.com/help/relations-and-rollups)
3. [Notion Help — Synced blocks](https://www.notion.com/help/synced-blocks)
4. [Notion Help — Sharing and permissions](https://www.notion.com/help/sharing-and-permissions)
5. [Notion — AI product page](https://www.notion.com/product/ai)
6. [Notion Blog — Introducing Notion Mail](https://www.notion.com/blog/introducing-notion-mail)
7. [Notion — Calendar product page](https://www.notion.com/product/calendar)
8. [Notion — Sites product page](https://www.notion.com/product/sites)
9. [Notion Blog — Data model behind Notion](https://www.notion.com/blog/data-model-behind-notion)
10. [Notion Blog — Sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion)
11. [Notion Help — Data residency](https://www.notion.com/help/data-residency)
12. [Notion — Security & compliance](https://www.notion.com/security)
13. [Notion Help — Comments, mentions and reminders](https://www.notion.com/help/comments-mentions-and-reminders)
14. [Tiptap homepage](https://tiptap.dev/)
15. [Tiptap — Hocuspocus docs](https://tiptap.dev/docs/hocuspocus/introduction)
16. [GitHub — ueberdosis/tiptap](https://github.com/ueberdosis/tiptap)
17. [BlockNote homepage](https://www.blocknotejs.org/)
18. [BlockNote — About](https://www.blocknotejs.org/about)
19. [GitHub — TypeCellOS/BlockNote](https://github.com/TypeCellOS/BlockNote)
20. [Plate (platejs.org)](https://platejs.org/)
21. [GitHub — udecode/plate](https://github.com/udecode/plate)
22. [Lexical homepage](https://lexical.dev/)
23. [ProseMirror homepage](https://prosemirror.net/)
24. [Milkdown homepage](https://milkdown.dev/)
25. [Editor.js homepage](https://editorjs.io/)
26. [Yjs docs](https://docs.yjs.dev/)
27. [Liveblocks homepage](https://liveblocks.io/)
28. [PartyKit homepage](https://www.partykit.io/)
29. [AppFlowy homepage](https://appflowy.com/)
30. [GitHub — AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy)
31. [GitHub — toeverything/AFFiNE](https://github.com/toeverything/AFFiNE)
32. [GitHub — anyproto/anytype-ts](https://github.com/anyproto/anytype-ts)
33. [Hacker News comments via Algolia API — "notion slow performance"](https://hn.algolia.com/api/v1/search?query=notion%20slow%20performance&tags=comment)

**Added in the 2026-09-05 gap-fill pass:**

34. [npm registry — @tiptap/core (version/license)](https://registry.npmjs.org/@tiptap/core/latest)
35. [npm registry — @tiptap/extension-task-item](https://registry.npmjs.org/@tiptap/extension-task-item/latest)
36. [npm registry — @tiptap/suggestion](https://registry.npmjs.org/@tiptap/suggestion/latest)
37. [npm registry — @tiptap/markdown](https://registry.npmjs.org/@tiptap/markdown/latest)
38. [Tiptap — Pricing](https://tiptap.dev/pricing)
39. [Tiptap Blog — Tiptap's new pricing model is live](https://tiptap.dev/blog/release-notes/tiptaps-new-pricing-model-is-live)
40. [Tiptap — Open Source to Platform](https://tiptap.dev/open-source-to-platform)
41. [Tiptap Blog — Introducing bidirectional Markdown support in Tiptap](https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap)
42. [Tiptap — What's new in v3](https://tiptap.dev/docs/resources/whats-new)
43. [Tiptap — TableKit extension docs](https://tiptap.dev/docs/editor/extensions/functionality/table-kit)
44. [Tiptap — Getting content as JSON/HTML](https://tiptap.dev/docs/guides/output-json-html)
45. [Tiptap — Collaboration overview](https://tiptap.dev/docs/collaboration/getting-started/overview)
46. [Tiptap/Hocuspocus — Database extension](https://tiptap.dev/docs/hocuspocus/server/extensions/database)
47. [Tiptap/Hocuspocus — Persistence guide](https://tiptap.dev/docs/hocuspocus/guides/persistence)
48. [Tiptap/Hocuspocus — SQLite extension](https://tiptap.dev/docs/hocuspocus/server/extensions/sqlite)
49. [Tiptap Blog — Hocuspocus 4 stable release](https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release)
50. [GitHub — ueberdosis/hocuspocus](https://github.com/ueberdosis/hocuspocus)
51. [npm registry — y-prosemirror](https://registry.npmjs.org/y-prosemirror/latest)
52. [npm registry — yjs](https://registry.npmjs.org/yjs/latest)
53. [npm registry — @blocknote/core](https://www.npmjs.com/package/@blocknote/core)
54. [BlockNote — Pricing](https://www.blocknotejs.org/pricing)
55. [BlockNote — XL commercial license terms](https://www.blocknotejs.org/legal/blocknote-xl-commercial-license)
56. [BlockNote — Custom Blocks (PropSchema)](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)
57. [BlockNote — Custom Inline Content](https://www.blocknotejs.org/docs/features/custom-schemas/custom-inline-content)
58. [BlockNote — Collaboration](https://www.blocknotejs.org/docs/features/collaboration)
59. [BlockNote — Blocks reference (checkListItem)](https://www.blocknotejs.org/docs/features/blocks)
60. [npm registry — lexical](https://registry.npmjs.org/lexical)
61. [Lexical — @lexical/list API](https://lexical.dev/docs/api/modules/lexical_list)
62. [Lexical — LexicalTypeaheadMenuPlugin API](https://lexical.dev/docs/api/modules/lexical_react_LexicalTypeaheadMenuPlugin)
63. [GitHub — facebook/lexical, MentionsPlugin source](https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/plugins/MentionsPlugin/index.tsx)
64. [Lexical — @lexical/yjs package docs](https://lexical.dev/docs/packages/lexical-yjs)
65. [Lexical — @lexical/markdown package docs](https://lexical.dev/docs/packages/lexical-markdown)
66. [Notion Templates — New Hire Onboarding](https://www.notion.com/templates/new-hire-onboarding)
67. [Notion Help — Grow with quality: applicant tracking and onboarding systems](https://www.notion.com/help/guides/grow-with-quality-using-these-systems-to-track-applicants-and-onboard-new-hires)
68. [Notion Templates — Wiki](https://www.notion.com/templates/team-wiki)
69. [Notion Templates — 30/60/90 Day Plan](https://www.notion.com/templates/30-60-90-day-plan)
70. [PostgreSQL docs — Full Text Search: tables and generated tsvector columns](https://www.postgresql.org/docs/current/textsearch-tables.html)
71. [PostgreSQL docs — json_to_tsvector / jsonb_to_tsvector](https://www.postgresql.org/docs/current/functions-textsearch.html)
72. [Supabase — Full Text Search guide](https://supabase.com/docs/guides/database/full-text-search)
73. [PostgreSQL Wiki — Audit trigger pattern](https://wiki.postgresql.org/wiki/Audit_trigger_91plus)

---

## Editor's verification notes (notion-model-and-block-editors)

### 1. Coverage gaps against the brief

The brief was covered solidly for the mainstream topics (block model, databases/views/relations/rollups/formulas, synced blocks, templates, comments, permissions, the 2025-26 product surface, and a genuinely useful editor/CRDT/platform comparison with a clear recommendation). Several requested and adjacent topics are missing, thin, or hand-waved:

- **"Hard to govern at scale" is only half-answered.** The brief explicitly asks for this weakness, but the report covers only the permission-inheritance confusion (§1.4/§1.7). It says nothing about Notion's actual admin/governance tooling — SCIM provisioning, audit log (Enterprise), content/DLP controls, workspace-level export controls, or the absence of field-level/row-level security — which is exactly the tooling a government IT security office would ask about before any "govern at scale" verdict. This is a material thinness given the audience.
- **No treatment of Notion's public API, integrations, and webhook ecosystem.** Given the platform's own Telegram-integration ambitions and the general "how do we integrate this with other systems" question a senior engineering lead always asks, the total absence of API/rate-limit/integration discussion is a real gap, not just a nice-to-have.
- **Search is never discussed.** Full-text/property search quality and its well-documented limitations (no complex boolean search, weak cross-workspace search at scale) are a top real-world Notion complaint and directly relevant to a wiki/notes module — absent entirely.
- **Version history / audit trail / undo depth is absent.** Page history depth by plan tier, and Enterprise audit logs, are directly relevant to a government accountability requirement and are not mentioned anywhere in the permissions or governance discussion.
- **Accessibility (WCAG/screen-reader support) is not mentioned**, for either Notion or any of the surveyed editor frameworks — a real omission for a government platform, which typically has a statutory accessibility bar.
- **Internationalization/i18n architecture is not addressed** beyond passing mentions of language counts (e.g., Notion Calendar's "12 languages"). Nothing on how Notion (or Tiptap/BlockNote/Lexical) actually handle multi-locale workspaces, sort order, or right-to-left/script-mixing — directly relevant to the Uzbek Latin / Russian / English trilingual requirement stated in the project brief.
- **Mobile/native app parity is thin** — offline is discussed only in the "no offline, server round-trip" framing; actual mobile app capability/limits (Notion mobile editing constraints, sync latency) aren't covered.
- **Import/export fidelity beyond CSV is thin** — no discussion of Word/Confluence/Markdown import quality, or PDF export fidelity, beyond the CSV-relations-lossy point.

Adjacent topics a senior product/engineering lead would expect and that are absent:
1. **Governance/admin tooling** (SCIM/SSO details, audit log, DLP, content controls) — see above.
2. **API/integration and extensibility model** (public API, webhooks, third-party marketplace) — see above.
3. **Accessibility compliance** for both Notion and the candidate editor frameworks.
4. **Search architecture and its limits** — a core "how do people actually find things" concern for any wiki/notes surface.

### 2. Spot-checks of 5 consequential factual claims

| # | Claim in report | Method | Result |
|---|---|---|---|
| 1 | Tiptap has 38.3k GitHub stars and is MIT-licensed | WebFetch of github.com/ueberdosis/tiptap | **CONFIRMED** — 38.3k stars, MIT license verified directly on the repo. |
| 2 | BlockNote core is MPL-2.0; "XL" packages (`@blocknote/xl-*`) are GPL-3.0, with a commercial-license alternative offered | WebFetch of github.com/TypeCellOS/BlockNote | **CONFIRMED** — repo explicitly states the MPL-2.0/GPL-3.0 split and a commercial licensing option for the XL packages. |
| 3 | AppFlowy is licensed AGPLv3 | WebFetch of github.com/AppFlowy-IO/AppFlowy | **CONFIRMED** — README states "Distributed under the AGPLv3 License." |
| 4 | Anytype uses the "Any Source Available License 1.0," which is not OSI-approved open source | WebFetch of github.com/anyproto/anytype-ts | **CONFIRMED** — repo license badge/file names ASAAL 1.0; it is source-available, not an OSI-approved license. |
| 5 | PartyKit "joined Cloudflare" (April 2024) and should be treated as superseded / verify current maintenance status | WebFetch of partykit.io and github.com/partykit/partykit | **CONFIRMED, and now more precise than the report**: the original `partykit/partykit` repo's own README states "Current development of this project is in [cloudflare/partykit](https://github.com/cloudflare/partykit)" — i.e., development has formally moved into Cloudflare's own GitHub org, not just a partnership announcement. The report's "treat as historical stepping-stone, verify current status" caveat was the right call; this confirms it more concretely. |

One claim could not be independently re-verified this pass: **Notion Mail's "requires a Gmail account to start"** (§1.5). This session's WebSearch budget was exhausted (200/200 already used, matching the original report's own methodology note), and direct WebFetch attempts against `notion.com/help/notion-mail`, `notion.com/product/mail`, and `app.notion.com/space/notion-mail` either 404'd, returned an unrelated marketing page, or required authentication. This claim should be treated as **unverified in this pass** (not contradicted, just not re-confirmable with the tools available) — worth a quick manual check before it's used in a leadership-facing deck.

### 3. Net assessment

No factual corrections were found — all five checked claims held up, one (PartyKit) was strengthened with a more precise source. The report's own "Open questions" section already flags several of the same soft spots (formula depth limits, license risk tolerance, BlockNote's gov claims, AFFiNE stability, PartyKit status) honestly rather than overstating confidence, which is good practice. The main action item is coverage, not correctness: add governance/admin tooling, API/integrations, search, version history/audit trail, and accessibility as a follow-up pass, since a government-platform decision memo will get asked about all five.

**Scope note on the pass below:** the editor's coverage-gap list above (governance/admin tooling, public API/integrations, accessibility, i18n architecture, mobile parity, non-CSV import/export fidelity) is about *Notion the product*, and remains genuinely open — it is **not** addressed by the addendum that follows. What follows instead answers a narrower, code-level question that sits directly underneath this report's own §3 recommendations (build on Tiptap v3 + Yjs + Hocuspocus): given that WorkPortal's actual near-term need is a **small** block editor for onboarding pages and checklists — not a document suite — what exactly should we install, at what version, under what license, storing what shape of data, with which collaboration model, and structured like which Notion templates? One correction was made to the body while researching this: **§2.1's Tiptap row is updated in place** — Markdown import/export is now a free, official MIT extension (`@tiptap/markdown`, Oct 2025), not a paid conversion feature as the row previously implied; see the inline correction and citation there.

---

## Gap-fill addendum (2026-09-05)

Scope of this addendum: current versions and licences for the editor/collaboration stack (Tiptap v3, BlockNote, Lexical, Yjs, Hocuspocus) as of September 2026; the minimal feature set a *small* onboarding/checklist block editor actually needs; a storage-schema recommendation for Postgres; a collaboration-model recommendation for v1; runnable TypeScript for the Tiptap v3 setup including a custom assignable-checklist-item node; Markdown export; search indexing; and the structure of Notion's own onboarding/wiki templates to use as a shipping template outline. Sourced via 8 WebSearch queries and 15+ WebFetch reads (npm registry, tiptap.dev, blocknotejs.org, lexical.dev, GitHub, Notion template pages, PostgreSQL/Supabase docs) across six research passes; sources 34–73 above.

### A. Current versions and licences (verified September 2026)

| Package | Version | Licence | Notes |
|---|---|---|---|
| `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/suggestion`, `@tiptap/extension-task-item`, `@tiptap/extension-list` (Task/Bullet/Ordered lists), `@tiptap/extension-image`, `@tiptap/extension-table` (`TableKit`), `@tiptap/markdown` | **3.31.3** | **MIT** | Whole monorepo version-synced. `@tiptap/markdown` is new since the base report was written (Oct 2025) — official, bidirectional, CommonMark-based. |
| `@tiptap/extension-mention` | 3.30.3 | MIT | One point release behind core; same train. |
| Tiptap Cloud / Platform (hosted collab, comments-as-a-service, version history, AI Toolkit, Tracked Changes, DOCX/ODT/PDF/EPUB conversion) | — | Proprietary SaaS | Start $59/mo ($49 annual) → Team $179/mo → Business $1,199/mo → Enterprise custom [tiptap.dev/pricing]. Self-hosted Hocuspocus documents don't count toward any plan — self-hosting is a first-class path, not a crippled fallback. A handful of formerly-Pro extensions (emoji, drag-handle, table-of-contents) were open-sourced to MIT in the 2025 pricing overhaul. |
| `@blocknote/core`, `@blocknote/react` | **0.54.0** | **MPL-2.0** | Everything a minimal editor needs — permissive enough for closed-source commercial use. |
| `@blocknote/xl-pdf-exporter`, `@blocknote/xl-docx-exporter`, `@blocknote/xl-odt-exporter`, `@blocknote/xl-ai` | ~0.53–0.54.0 | **GPL-3.0**, dual-licensed | Commercial licence bundled into BlockNote Business ($195/mo) or Enterprise (custom); **not needed for our scope** — we don't need PDF/DOCX/ODT export or an AI block. |
| `lexical`, `@lexical/react`, `@lexical/list`, `@lexical/markdown`, `@lexical/yjs` | **0.50.0** | **MIT** | No paid tier exists at all — the cleanest licence story of the three frameworks, at the cost of more assembly work. |
| `yjs` | **13.6.32** stable (14.0.0-rc in progress on `main`, not yet `latest`) | MIT | |
| `@hocuspocus/server`, `@hocuspocus/provider` | **4.6.0** | MIT (copyright Tiptap GmbH) | Cross-runtime (Node 22+, Bun, Deno, Cloudflare Workers). Fully self-hostable; no dependency on Tiptap Cloud. |
| `y-prosemirror` | **1.3.7** | MIT | The binding under Tiptap's `Collaboration`/`CollaborationCursor` extensions. |

**Licence bottom line for our scope:** nothing in the minimal onboarding/checklist feature set (below) touches a GPL-3.0 or paid-SaaS package on any of the three frameworks. Tiptap v3 core + task-item + mention + suggestion + image + table + markdown are all MIT; BlockNote's core+react are MPL-2.0; Lexical is MIT end to end. The only way to accidentally cross into GPL/paid territory is reaching for BlockNote's `xl-*` export/AI packages or Tiptap's hosted Cloud/Conversion features — both avoidable for this surface.

### B. What a *small* block editor for onboarding pages/checklists actually needs

Scoped deliberately smaller than a document suite:

| Need | In scope | Out of scope for v1 |
|---|---|---|
| Headings (H1–H3), paragraphs, bold/italic/links, bullet & ordered lists | Yes — `StarterKit` | — |
| **Checklist item, assignable to a person, with a due date** | Yes — custom node extending `TaskItem` (§D) | Recurring tasks, sub-checklists |
| `@person` mention | Yes — `Mention` node #1, resolves against the People module | Presence/typing indicators |
| `#project` mention | Yes — `Mention` node #2, `char: '#'`, resolves against Projects | Cross-linking arbitrary pages (`[[wiki-link]]`) |
| `/` slash menu (insert heading/list/checklist/image/callout/table) | Yes — `Suggestion` utility, `char: '/'` | AI-generated content commands |
| Images | Yes — `Image`, upload to our own object storage, no embed widgets | Inline image editing/cropping |
| Callout box (info/warning/success) | Yes — **not built into any framework**; custom `Node` (§D) | Multiple visual themes beyond 3–4 variants |
| Tables | Maybe — `TableKit`, only if a template genuinely needs one (e.g. a resource list); skip if checklists cover the need | Spreadsheet-style formulas in tables |
| Embeds (YouTube, Figma, etc.) | **No** — explicitly out of scope per the project brief | — |
| Comments, track changes, AI writing assistance | No for v1 — all sit behind Tiptap Cloud/Pro or BlockNote XL; revisit only if a real need emerges | — |

This list maps directly onto the report's own §3.2 ("[AVOID] do not make everything a generic freeform block database") and §3.13 (cap scope to real numbers, not Notion parity) — the onboarding/checklist surface is exactly the kind of small, purpose-built prose surface those principles describe.

### C. Storage schema: `jsonb` block tree, not Yjs binary

Tiptap's own docs frame the choice as tied directly to whether you need CRDT collaboration: JSON is "easier to loop through" and is a normal queryable database value (`editor.getJSON()`), whereas Yjs state must be persisted as an opaque binary snapshot (`Y.encodeStateAsUpdate`) via Hocuspocus's `onStoreDocument`/`onLoadDocument` hooks — the docs warn against reconstructing a `Y.Doc` from anything else, since that forks history. Once you commit to Yjs, the content stops being directly queryable or diffable in the database.

**Recommendation:** store the Tiptap JSON document directly in a `jsonb` column, last-write-wins, with an application-maintained denormalized `search_text` column for indexing (no JSON parsing needed at query time) and periodic full snapshots in a `page_versions` table for history — no CRDT needed at 23-user scale:

```sql
CREATE TABLE pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  title         text NOT NULL,
  content       jsonb NOT NULL,                 -- Tiptap/ProseMirror JSON, source of truth
  search_text   text NOT NULL DEFAULT '',        -- denormalized plain text, app-maintained on save
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  version       integer NOT NULL DEFAULT 1,      -- optimistic-lock counter, see §E
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pages_search_vector_idx ON pages USING GIN (search_vector);
CREATE INDEX pages_tenant_idx        ON pages (tenant_id);

CREATE TABLE page_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  content    jsonb NOT NULL,
  edited_by  uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Server-side, extract `search_text` from the Tiptap JSON tree on every save (walking `content` nodes, joining `text` leaves) rather than relying on Postgres's `jsonb_to_tsvector` at query time — the latter exists and works (`jsonb_to_tsvector('english', content, '"string"')` pulls every string leaf) but a hand-rolled extraction lets you skip code blocks, weight headings, and strip node noise:

```ts
import type { JSONContent } from '@tiptap/core'

function extractPlainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (!node.content) return ''
  return node.content.map(extractPlainText).join(' ')
}

// on save:
const searchText = extractPlainText(doc)
await db.query(
  `UPDATE pages SET content = $1, search_text = $2, version = version + 1,
          updated_at = now(), updated_by = $3
   WHERE id = $4 AND version = $5`,
  [doc, searchText, userId, pageId, expectedVersion],
)
// 0 rows affected => someone else saved since this editor loaded the page —
// surface a "reload / merge" conflict prompt rather than silently overwriting.
```

### D. Collaboration for v1: last-write-wins with autosave, not Yjs+Hocuspocus

The base report (§3.6) recommends Yjs+Hocuspocus for the platform's collaboration layer generally, and that remains sound advice for a real-time-heavy surface. For *this specific* small onboarding/checklist editor at 23 users, it is worth deliberately not doing that on day one:

- Hocuspocus persistence is not automatic — you must store/load the binary Yjs update yourself, there is no official Postgres adapter (only an official SQLite one; Postgres means writing your own `fetch`/`store` against the same binary-blob contract), and the stored state is opaque and non-queryable without decoding.
- Simultaneous character-level editing of the *same* onboarding checklist is rare at this scale — people naturally partition which page/section they're editing. The general engineering consensus (echoed in Figma/Notion/Linear architecture writeups) is that CRDT machinery is often reserved for genuine same-passage concurrent editing, and plain last-write-wins per record is a legitimate, much simpler default elsewhere.
- The optimistic-locking pattern in §C (`version` column + "someone else saved, reload?" prompt) plus autosave every few seconds gives 90% of the practical benefit — no WebSocket service to run, secure, and operate, and content stays queryable.

**Recommendation:** ship v1 of the onboarding/checklist surface on LWW + autosave + optimistic locking. Keep the document-storage layer abstracted behind a small interface so Yjs/Hocuspocus can be swapped in later, behind the same `pages` table, if real contention emerges (e.g., if the platform later adds live meeting-notes co-editing, where the base report's Yjs+Hocuspocus recommendation should stand).

### E. TypeScript: Tiptap v3 setup with mentions, task items, and a custom assignable-checklist node

Illustrative — verify exact prop/attribute names against the installed `3.31.3` API surface before shipping; the shape below is accurate to the current docs but Tiptap v3's NodeView API has stricter null-checks than v2 (`getPos()` can now return `undefined`).

```ts
// extensions/assignable-task-item.ts
import TaskItem from '@tiptap/extension-task-item'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AssignableTaskItemView } from './AssignableTaskItemView'

export const AssignableTaskItem = TaskItem.extend({
  name: 'assignableTaskItem',

  addAttributes() {
    return {
      ...this.parent?.(),
      assigneeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-assignee-id'),
        renderHTML: (attrs) =>
          attrs.assigneeId ? { 'data-assignee-id': attrs.assigneeId } : {},
      },
      assigneeName: {
        // denormalized display name so the rendered HTML/markdown stays readable
        // without a lookup, even if the person record is later renamed/removed
        default: null,
        parseHTML: (el) => el.getAttribute('data-assignee-name'),
        renderHTML: (attrs) =>
          attrs.assigneeName ? { 'data-assignee-name': attrs.assigneeName } : {},
      },
      dueDate: {
        default: null, // ISO date string, e.g. "2026-09-30"
        parseHTML: (el) => el.getAttribute('data-due-date'),
        renderHTML: (attrs) => (attrs.dueDate ? { 'data-due-date': attrs.dueDate } : {}),
      },
    }
  },

  addNodeView() {
    // renders the checkbox + an assignee chip + a due-date badge;
    // clicking the chip opens the same person-picker used by @mention
    return ReactNodeViewRenderer(AssignableTaskItemView)
  },
})
```

```ts
// extensions/callout.ts — Tiptap ships no built-in callout node; this is the documented pattern
import { Node, mergeAttributes } from '@tiptap/core'

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info', // 'info' | 'warning' | 'success' | 'danger'
        parseHTML: (el) => el.getAttribute('data-variant'),
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },
})
```

```ts
// editor.ts — assembling the minimal onboarding/checklist editor
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-list'
import Mention from '@tiptap/extension-mention'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import { AssignableTaskItem } from './extensions/assignable-task-item'
import { Callout } from './extensions/callout'
import { personSuggestion, projectSuggestion, slashCommandSuggestion } from './suggestions'
import SuggestionExtension from './extensions/slash-command' // thin wrapper over @tiptap/suggestion, char: '/'

export function createOnboardingEditor(element: HTMLElement) {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ taskItem: false /* replaced below */ }),
      TaskList,
      AssignableTaskItem,
      Image,
      Callout,
      TableKit, // omit entirely if a template turns out not to need tables
      Mention.extend({ name: 'personMention' }).configure({
        suggestion: { ...personSuggestion, char: '@' },
      }),
      Mention.extend({ name: 'projectMention' }).configure({
        suggestion: { ...projectSuggestion, char: '#' },
      }),
      SuggestionExtension.configure({ suggestion: slashCommandSuggestion }),
      Markdown.configure({ html: false, transformCopiedText: true }),
    ],
  })
}
```

Two independent `Mention` instances (distinct `name`, distinct `char`) is the documented pattern for supporting both `@person` and `#project` triggers side by side — each gets its own `Suggestion` plugin instance under the hood via `@tiptap/suggestion`, the same generic utility used for the `/` slash menu.

### F. Export to Markdown

`@tiptap/markdown` (MIT, official, bidirectional, CommonMark via MarkedJS, shipped October 2025) supersedes the community `tiptap-markdown` package referenced implicitly by the base report's "DOCX/Markdown/ODT" paid-conversion line — see the correction in §2.1 above. Getting Markdown out and back in is now free:

```ts
// export
const markdown: string = editor.storage.markdown.getMarkdown()

// import (e.g. loading a template)
editor.commands.setContent(markdownTemplateString, { contentType: 'markdown' })
```

Custom node types (the assignable checklist item, the callout) need their own tokenizer/serializer registered with the extension if they should round-trip through Markdown cleanly rather than falling back to their closest built-in equivalent (e.g. a plain `- [ ]` checkbox, losing the assignee/due-date attributes) — acceptable for a "export for sharing outside the app" use case, not for a save format.

### G. Notion's own onboarding/wiki templates, as a structure to replicate

From Notion's official template gallery (not to be confused with adopting Notion itself, which the base report already rules out on data-residency grounds):

**New Hire Onboarding** — one database, one row per hire (not a shared checklist filtered by person):
- Board view grouped by a Status select (Not started / In Progress / Completed); cards show photo, name, department, start date.
- Opening a hire's page shows a checklist grouped under headings ("Basics", "HR & Benefits", "Tools") — populated by applying a team-specific **page template** when the row is created, not by filtering a shared list.
- A companion **30/60/90 Day Plan** page pattern: a callout intro, then phase headings (30/60/90 days) each with bulleted sub-sections (impact, customer experience, culture/team).
- Property types used: Select (department/status), Date (start date), Person (owner), Files (photo), Text (notes).

**Team Wiki / Home** — a single hub page plus one underlying wiki database, sectioned purely by a Category/Tags property rather than by relations:
- Hub page: icon, title, breadcrumb, search, an intro callout ("add owners and tags to pages").
- Sections rendered as link lists filtered by category: Team (getting started, mission/values), Policies (vacation, benefits), Company Updates (rendered as a **gallery view**, functioning as an announcements feed, each entry showing an Owner/Person property).
- No relations/rollups or synced blocks — everything lives in one database, disambiguated by property value, which is directly compatible with our "typed tables, not generic blocks" recommendation (base report §3.2).

**For WorkPortal**, this maps to two shippable v1 templates: (1) a **New Hire Checklist** page template — headings + assignable checklist items grouped by week/topic, applied per new hire (not a shared filtered list); and (2) a **Team Home** page — a short intro callout, a few `#project`/`@person` mention-linked sections, and a simple table or list of resource links — both buildable with exactly the node set in §B, no relations/rollups/synced-blocks machinery needed.
