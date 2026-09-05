# Competitive matrix

**TL;DR**
1. No surveyed product — commercial or open-source — combines Jira-grade structure, Notion-grade flexibility, Uzbek-language support, and legal data residency in Uzbekistan at once: every commercial SaaS tool fails residency by construction (no self-host, no Central Asian region), and every open-source tool checked ships zero Uzbek localization [work-management-landscape.md §D/§E gap-fill; notion-model-and-block-editors.md §1.6].
2. The reference prototype's single best idea — weekly comment + automatic escalation into a review queue — has no branded equivalent anywhere in this survey; Linear's Project Health and Basecamp's Hill Charts are the closest analogs, and both are foreign SaaS with no residency option [portfolio-pm-analytics-dashboards.md §1; work-management-landscape.md §G7 gap-fill].
3. CIS/Uzbek government work runs on its own primitive — instruction→executor→deadline→report ("ijro intizomi") with sequential registration numbers — that every Western tool studied misses entirely; only CIS ECM suites (Bitrix24, Directum, ELMA365) partially model it, at the cost of vendor lock-in and the clutter their own users complain about [documents-approvals-and-workflows.md §7; uzbekistan-context.md §7].
4. Field-level privacy tiers on the People record (public/internal/restricted, audit-logged) is the highest-leverage permission feature in this whole survey and is done badly or not at all everywhere else — Notion's "broadest access wins" rule is a documented anti-pattern to avoid, not copy [auth-permissions-security-compliance.md §6; notion-model-and-block-editors.md §1.4].

## 1. Feature matrix

Columns: **Jira**, **Linear**, **Notion**, **Asana**, **ClickUp**, **Monday** (monday.com), **Lark** (Feishu), **Bitrix24**, **Plane**, **Huly**, **OpenProj** (OpenProject), **AppFl/AFF** (AppFlowy/AFFiNE), **Ref** (reference prototype). ✅ strong · 🟡 partial · ❌ none · ? unknown (not asserted by any research file).

| Capability | Jira | Linear | Notion | Asana | ClickUp | Monday | Lark | Bitrix24 | Plane | Huly | OpenProj | AppFl/AFF | Ref |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tasks | ✅ | ✅ issues | 🟡 db rows | ✅ | ✅ | ✅ | 🟡 via Base | ✅ | ✅ | ✅ | ✅ work pkgs | 🟡 claimed | ❌ |
| Subtasks | ✅ | 🟡 | 🟡 | ✅ | ✅ | ? | 🟡 | ✅ | ✅ | ? | ✅ | ? | ❌ |
| Projects | ✅ | ✅ | 🟡 db | ✅ portfolios | ✅ spaces | ✅ boards | 🟡 via Meegle | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 sketch only |
| Initiatives/goals | ? | ✅ Initiatives | ❌ | ✅ Goals | ✅ | ? | 🟡 OKR unexplored | ? | 🟡 cycles | ? | ? | ❌ | 🟡 quarterly bars |
| Weekly status updates | ❌ | ✅ Project Update | ❌ | ✅ color-coded | ❌ | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | 🟡 Friday ritual (unbuilt) |
| Kanban | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Base view | ✅ | ✅ | 🟡 | ✅ | 🟡 | ❌ |
| Timeline/Gantt | ? | ❌ no native | ✅ view | ✅ Timeline | ✅ | 🟡 | ✅ Base view | ✅ | 🟡 | ? | ✅ native | ❌ | ❌ |
| Calendar | ? | ❌ | ✅ +app | ✅ | ✅ | ? | ✅ bundled | ✅ | ? | ? | ? | ❌ | ❌ |
| Docs/wiki | 🟡 Confluence | ? | ✅ core | ❌ | ✅ Docs | 🟡 | ✅ | 🟡 | 🟡 | ✅ claimed | ✅ wiki | ✅ core | ❌ |
| Block editor | ❌ | ? | ✅ core model | ❌ | 🟡 | ? | 🟡 | ❌ | ? | 🟡 | ❌ | ✅ BlockSuite | ❌ |
| Custom fields/databases | ✅ admin-heavy | 🟡 rigid | ✅ core | ✅ | ✅ deep | ✅ no-code | ✅ Base | 🟡 | 🟡 | ? | 🟡 | 🟡 | ❌ |
| Approvals | ✅ JSM | ❌ | ❌ | 🟡 AI Studio | ❌ | ❌ | ✅ chat-native | ✅ | ? | ? | ? | ❌ | ❌ |
| E-signature | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Leave/time-off | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 approval tmpl | 🟡 Pro tier | ❌ | 🟡 HRM claimed | ❌ | ❌ | ❌ |
| Org chart | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 unexplored | ? | ❌ | ? | ❌ | ❌ | 🟡 1-level, static |
| Directory with privacy tiers | ❌ | ❌ | 🟡 flawed rule | ❌ | ❌ | ❌ | 🟡 Base field-level | ? | ❌ | ? | ❌ | ❌ | 🟡 stated, not built |
| Notifications inbox | 🟡 noisy | ✅ Inbox-first | 🟡 mentions only | 🟡 "overload" | ❌ | ? | ❌ | ❌ | ? | ? | ? | ❌ | ❌ |
| Telegram channel | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (zero CIS footprint) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Command palette | ❌ | ✅ Cmd+K | ✅ +AI Q&A | ? | ? | ? | ❌ | ❌ | ✅ | ? | ❌ | ? | ❌ |
| Keyboard-first | ❌ slow | ✅ core | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 | ? | ❌ | ? | ❌ |
| Offline | ❌ | ✅ desktop sync | ❌ none | ? | ? | ? | ? | ? | ? | ? | ? | ✅ CRDT local-first | n/a static |
| Mobile | ? | ✅ native apps | 🟡 | ? | ? | ? | 🟡 approvals | ? | ? | ? | ? | ✅ AppFlowy cross-platform | ❌ |
| Search | 🟡 JQL | ✅ | 🟡 Enterprise Search | ? | 🟡 Deep Search | ? | ? | ? | ? | ? | ? | 🟡 AI search claimed | ❌ |
| AI summaries | 🟡 Rovo | ? | ✅ Agent/Meeting Notes | ✅ AI Studio/Dash | ✅ Brain² | 🟡 AI Blocks | 🟡 Minutes add-on | 🟡 "Vibe+" rebrand | 🟡 inline doc AI | ❌ | ❌ | 🟡 claimed | ❌ |
| Audit log | ? | ? | 🟡 thin | ? | ? | ? | ? | ? | ? | ? | ? | ❌ | ❌ (stated as future) |
| RBAC granularity | ✅ schemes | 🟡 roles | 🟡 broadest-wins flaw | ? | ? | ? | 🟡 | ? | ? | ? | 🟡 | 🟡 claimed SAML/OIDC | ❌ none |
| Field-level permissions | 🟡 issue security | ❌ | ❌ page-level only | ❌ | ? | ? | ✅ Base | ? | ❌ | ❌ | ❌ | ❌ | 🟡 stated, not built |
| SSO/OIDC | ? | ? | 🟡 Enterprise | ? | ? | ? | ? | 🟡 AD claimed | ? | ? | ? | ✅ claimed | ❌ |
| Multi-tenant | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | ? | ? | ❌ |
| Self-host/on-prem | ✅ Data Center | ❌ SaaS-only | ❌ none | ❌ | ❌ | ❌ | ❌ | ✅ boxed edition | ✅ Docker/K8s | ✅ huly-selfhost | ✅ deep gov use | ✅ air-gapped (AppFlowy) | n/a demo |
| i18n incl. Uzbek/Russian | 🟡 RU yes, UZ no | ❌ none | 🟡 21 langs, no UZ | ? | ❌ no UZ | ? | ❌ zero CIS presence | 🟡 RU/CIS, no UZ | ? unverified | ❌ | 🟡 RU in progress, no UZ | ❌ | ❌ EN-only |
| Templates | ? | 🟡 | ✅ 30,000+ | ✅ guided | ✅ gallery | ✅ gallery | 🟡 approval tmpl | ? | ? | ❌ | ❌ | ❌ | ❌ |
| Forms | 🟡 JSM | ❌ | 🟡 | 🟡 | 🟡 | 🟡 | ✅ mobile-native | ? | ❌ | ❌ | ❌ | ❌ | ❌ |
| Files | ? | ? | 🟡 | ? | ? | ? | 🟡 15TB pool | ✅ 5GB free | ? | 🟡 MinIO | 🟡 | ? | ❌ |
| Meeting notes | ❌ | ❌ | ✅ AI Meeting Notes | ❌ | ❌ | ❌ | ✅ AI add-on | ❌ | ❌ | ❌ | ❌ | 🟡 claimed | ❌ |
| OKR | ? | ❌ | ❌ | ✅ Goals | ✅ Goals | ? | 🟡 unexplored | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 progress bars |
| Dashboards | ? | 🟡 Insights | 🟡 no canned rollup | ✅ Portfolios | ✅ widgets | ✅ | ✅ 20+ chart types | ? | ? | ❌ | ? | ❌ | ✅ strong, sample data |
| Time tracking | ? | ❌ | ❌ | ❌ | 🟡 | ? | ❌ unexplored | 🟡 Pro tier | ❌ | 🟡 | ✅ | ❌ | ❌ |
| Events/RSVP | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 sketch, dead button |
| Recognition | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Instruction/execution-control (ijro) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 CIS ECM ref | ❌ | ❌ | ❌ | ❌ | 🟡 auto-escalation concept |
| Data residency options | 🟡 fixed regions | 🟡 US/EU, meta always US | 🟡 Enterprise AWS only | ❌ | ❌ | ❌ | 🟡 SG/CN split | ✅ boxed = in-country | 🟡 self-host | 🟡 self-host | ✅ self-host, EU gov use | ✅ air-gapped | n/a |
| Licence/openness | ❌ proprietary | ❌ proprietary | ❌ proprietary | ❌ proprietary | ❌ proprietary | ❌ proprietary | ❌ proprietary | ❌ proprietary | ✅ AGPL-3.0 | ✅ EPL-2.0, SaaS at risk | ✅ GPL-3.0 | 🟡 AGPLv3/MIT split | n/a |

## 2. Loved / hated

| Product | Loved | Hated | Source |
|---|---|---|---|
| Jira | Configurability handles any evolving process | Workflow/screen/field/permission-scheme sprawl demands a dedicated admin nobody on a 23-person team can spare | work-management-landscape.md §2 |
| Linear | Sub-100ms perceived latency; opinionated Cycles force a rhythm without setup | Deliberately no Gantt/timeline; "our way or no way" frustrates non-engineering teams | work-management-landscape.md §1 |
| Notion | Editing feels like typing, not filing; 30,000+ templates remove the blank-page problem | "Broadest access wins" permission rule causes silent oversharing; databases visibly slow past ~1,000 rows | notion-model-and-block-editors.md §1.4, §1.7 |
| Asana | One dataset, multiple views (List/Board/Timeline/Calendar) on the same items | Notification overload is the most-cited complaint; Starter→Advanced pricing jumps 127% | work-management-landscape.md §1 |
| ClickUp | "Everything" positioning removes app-switching between docs/chat/sprints | #1 cited complaint for years: overwhelming UI, hundreds of settings, slow pages with many custom fields | work-management-landscape.md §1 |
| Monday.com | Visual color-block boards; plain-language no-code automation recipes | 10-seat minimum inflates cost for a small team; "everything is a board" breaks on hierarchical work | work-management-landscape.md §1 |
| Lark | Approvals surface inside chat with one tap, no app-switching; cut a customer's approval cycle from a week to hours | Zero footprint or local support in Central Asia; own FAQ concedes not every country is served | all-in-one-suites-lark-bitrix.md §Lark |
| Bitrix24 | "Everything connected" saves time; cited as the most cost-effective CRM+PM combo in reviews | Interface "occasionally feels crowded," "cluttered when more than one module runs concurrently" | all-in-one-suites-lark-bitrix.md §Bitrix24 |
| Plane | Jira/Linear power without the chrome; command-palette-driven navigation, inline doc AI | No confirmed government adopter anywhere; inherits a Django+React model built for software teams | open-source-foundations.md |
| Huly | Broadest single-codebase scope claimed (PM+Notion+Slack+CRM+HRM+ATS) | Its own hosted SaaS is shutting down July 2026 even while the OSS repo stays active — a live commercial-viability warning | open-source-foundations.md |
| OpenProject | Deepest government reference-customer list of anything surveyed (Berlin, Cologne, two German federal ministries, Bundeswehr) | Heavier, more traditional Rails/Angular interface than the "five-second readability" bar this project needs | open-source-foundations.md |
| AppFlowy/AFFiNE | Explicit air-gapped/on-prem support by design (AppFlowy); MIT-licensed unified doc+canvas engine (AFFiNE) | AppFlowy's AGPLv3 needs legal review before reuse; AFFiNE is still a pre-1.0 "canary" branch | open-source-foundations.md; notion-model-and-block-editors.md §2.3 |
| Reference prototype | Calm editorial tone, five-second readability, and the Friday-ritual/auto-escalation idea itself | Zero interaction anywhere — no create, edit, search, auth, roles, or real data | reference-site-audit.md |

## 3. White space

Capabilities nobody in this survey does well for a government department:

- **Sequential, per-tenant registration numbers on documents/instructions, with executor/deadline/report lifecycle.** Every Western tool (Notion, Linear, Asana, ClickUp, Monday, Jira) is silent on this; only CIS ECM suites approximate it, and their own users call the result "cluttered" [documents-approvals-and-workflows.md §7; uzbekistan-context.md §4, §7].
- **Field-level privacy tiers on a People record, enforced server-side with a mandatory audit log of restricted reads.** No commercial vendor studied ships this; Notion's page-level model explicitly does the opposite (broadest grant wins silently) [auth-permissions-security-compliance.md §6; notion-model-and-block-editors.md §1.4].
- **A staffing-table-aware org chart that treats a vacant, approved position ("shtat jadvali") as a first-class object, not just a headcount number.** Every commercial HRIS studied (BambooHR, Rippling, Personio, HiBob, Deel, Factorial) models organizations as a graph of people only, deleting the node when someone leaves [hr-people-ops-features.md §"Deep dive: org chart"].
- **Time-boxed, dual-visible delegation ("acting in place" while on leave) with delegated actions logged distinctly from the delegate's own.** Not found in any RBAC system, HRIS, or PM tool surveyed [auth-permissions-security-compliance.md §7].
- **Uzbek-language interface, full stop.** Sixteen-plus commercial and open-source tools were checked specifically for this; none ship it. Russian coverage is common among mature tools; Uzbek is a genuine market gap, not a minor localization task [work-management-landscape.md §E gap-fill].
- **Telegram as the primary approval and notification surface (not an add-on), satisfying legal data-localization for anything sensitive.** Lark's chat-native approval card is the best UX reference anywhere in this survey, but Lark itself has no CIS presence and is foreign-hosted; nobody has built the Lark pattern on top of Telegram [documents-approvals-and-workflows.md §5; notifications-telegram-mobile.md §4].
- **A weekly-comment-plus-automatic-escalation ritual as a native, non-configurable product object, self-hostable in-country.** Linear's Project Health field and Basecamp's Hill Charts are the closest analogs and both are foreign SaaS with no residency option — the pattern is proven but not procurable [portfolio-pm-analytics-dashboards.md §1, §2; work-management-landscape.md §G7 gap-fill].
- **Komandirovka (business trip) and attestation as distinct, legally-shaped workflow objects separate from generic "leave" or "performance review."** No Western SaaS or open-source HRIS models either; conflating them with leave/review would misrepresent their legal stakes [hr-people-ops-features.md §"Deep dive: business trips", §"Deep dive: attestation"].

## 4. Complexity budget

UX-complexity cost (L/M/H) to build well vs. value (L/M/H) for a 23-person department, for ~25 candidate capabilities:

| Capability | Complexity | Value | Reasoning |
|---|---|---|---|
| Weekly status comment + auto-escalation | L | H | A state machine over dates and one boolean (comment posted); the reference prototype's own best idea, unbuilt |
| Command palette (Cmd/Ctrl+K) | L | H | cmdk is MIT and drop-in; the single most-cited "why it feels fast" reason across every tool studied |
| RBAC mirroring the org chart (Director/Head/Employee) | L | H | Needs no policy engine — it's the hierarchy everyone already understands |
| Audit log on restricted-field reads | L | H | One append-only table plus a write hook; legally load-bearing under Uzbekistan's data-localization law |
| Self-service "who viewed my record" | L | M | Same audit table, a filtered view — near-zero marginal cost once the log exists |
| Kanban board | L | M | pragmatic-drag-and-drop is a solved, MIT-licensed library problem |
| Attestation tracking (due date, commission, outcome) | L | M | A compliance-calendar entity, not a workflow engine |
| Telegram bot: notifications + inline approve/deny | M | H | Bot API mechanics are simple; the payoff is owning the channel this market actually uses |
| Leave/time-off with Uzbek Labor Code categories | M | H | The 3-tap request/balance/approve pattern is proven everywhere; only the leave categories are local |
| Field-level privacy tiers (public/internal/restricted) | M | H | Three tiers, server-enforced — touches every People query, so real but bounded work |
| Multi-tenant schema (tenant_id + RLS from migration #1) | M | H | Cheap if designed in now; a documented, expensive retrofit later (Notion's own Postgres-sharding lesson) |
| Komandirovka as its own workflow entity | M | H | A small, distinct lifecycle; legally load-bearing and has no off-the-shelf analog to lean on |
| Org chart with position/vacancy modeling | M | H | Position ≠ Employee is a real data-model decision, not hard engineering |
| Telegram Mini App as the mobile client | M | H | Avoids native app-store cost and MDM/distribution fights entirely |
| Offline-tolerant mutation queue (read cache + write queue) | M | M | Real office-wifi problem; TanStack Query's persisted cache covers most of it cheaply |
| Object sharing (lightweight ReBAC exception layer) | M | M | Needed for the rare cross-hierarchy share; not needed on day one |
| Delegation / acting-in-place | M | M | Real problem, low frequency — defensible to defer to Phase 2 |
| AI weekly-digest drafted from structured activity | M | M | Low-hallucination because input is structured, but needs the LLM gateway/routing layer first |
| E-signature for informal internal acknowledgment (Documenso-style) | M | L | Most approvals here don't need real legal signature; low daily value |
| Block editor / wiki (Tiptap + Yjs + self-hosted Hocuspocus) | H | M | Real-time collaboration infrastructure is nontrivial ops for a team with no dedicated SRE |
| E-Imzo legal-signature integration | H | M | Real PKI engineering plus a state-operator partnership; correctly a Phase 2/3 item |
| OneID SSO integration | H | L (for v1) | No public self-serve API; needs a government relationship before any code is written |
| Gantt/timeline view | H | L | The department's actual need (start/end + milestone) doesn't require dependency scheduling; every vendor gates this behind a paywall for a reason |
| AI workspace Q&A / RAG chatbot | H | L (until privacy tiers exist) | The NYC MyCity failure mode is exactly what happens if this ships before permission-aware retrieval |
| Generic custom-field / no-code workflow builder | H | L | The precise mechanism (workflow × screen × permission schemes) that made Jira need an admin priesthood; three research files independently warn against it |
| Recognition/kudos as a standalone feature | L | L | Atrophies without a paired ritual trigger; cheap to build, easy to waste |

**Build-first shortlist (high value, low complexity):** weekly status comment + auto-escalation, command palette, org-hierarchy RBAC, audit log on restricted reads, self-service "who viewed my record," kanban board, and attestation tracking. These six to seven items are each low-cost individually, collectively cover the reference prototype's own stated priorities (trustworthy records, visible ownership, privacy by design), and require no new infrastructure beyond Postgres and a small app layer — no LLM gateway, no PKI, no real-time collaboration engine, no state-operator partnership.

## Sources

All findings above are drawn from `docs/01-research/`: ai-features-and-assistants.md, all-in-one-suites-lark-bitrix.md, auth-permissions-security-compliance.md, backend-architecture-and-multitenancy.md, data-dense-ui-components.md, design-systems-craft-and-motion.md, documents-approvals-and-workflows.md, engineering-quality-and-agentic-delivery.md, frontend-architecture-and-sync.md, govtech-and-public-sector-patterns.md, hr-people-ops-features.md, notifications-telegram-mobile.md, notion-model-and-block-editors.md, open-source-foundations.md, portfolio-pm-analytics-dashboards.md, uzbekistan-context.md, work-management-landscape.md, zero-training-ux-and-onboarding.md — plus `docs/00-reference/reference-site-audit.md`.
