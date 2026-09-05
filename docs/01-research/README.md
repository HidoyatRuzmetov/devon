# Research index

Twenty-five reports plus a competitive matrix, produced 2026-09-04/05 on Sonnet-class agents with
editorial spot-checks and gap-fill addenda. Every report ends with numbered [ADOPT] / [ADAPT] /
[AVOID] recommendations and a Sources list. The plan (`docs/03-plan/FEATURE-PLAN.md`), the technical
design (`docs/03-plan/TECH-SPEC.md`) and the design system (`DESIGN.md`) cite these files.

## Product and context

| File | Dimension | Words | Verified | Gap-fill |
|---|---|---|---|---|
| work-management-landscape.md | Linear, Asana, ClickUp, Monday, Basecamp, Smartsheet; why Jira is hated | 8.8k | yes | yes |
| all-in-one-suites-lark-bitrix.md | Lark, Bitrix24 (CIS), Microsoft, Google, Zoho; the steal list from Trello/Miro/Notion/Jira | 8.9k | yes | yes |
| notion-model-and-block-editors.md | Notion's model; Tiptap 3.31, BlockNote, Lexical, Yjs; the small editor we build | 7.9k | yes | yes |
| open-source-foundations.md | Plane, Huly, OpenProject, openDesk, Frappe HR, licences; compose, do not fork | 8.4k | yes | yes |
| govtech-and-public-sector-patterns.md | GOV.UK, USWDS, Singapore, Estonia, Diia; how internal tools spread | 9.7k | yes | yes |
| uzbekistan-context.md | Ministry structure, EGDI, OneID, E-Imzo, data localisation, Labour Code leave, 2026 holidays, 84-term glossary | 10.9k | yes | yes |
| uzbekistan-gov-visual-identity-research.md | digital.uz/gov.uz tokens (`#013d8c`, Montserrat), OneID/IT Park/UZINFOCOM palettes, symbols law, three proposed palettes | 4.4k | live CSS | n/a |
| zero-training-ux-and-onboarding.md | Progressive disclosure tiers, teaching empty states, newcomer onboarding design, first sessions per persona, metrics | 11.9k | yes | yes |
| product-team-management-and-culture-features.md | Feature catalogue: work tracking, team management, onboarding, team building, non-surveillance insights | 6.1k | n/a | n/a |
| hr-people-ops-features.md | Leave, positions/shtat, trips, attestation; what to refuse | 8.9k | yes | yes |
| documents-approvals-and-workflows.md | Instruction→executor→deadline→report; approvals; (document registry now out of scope) | 9.0k | yes | yes |
| portfolio-pm-analytics-dashboards.md | Weekly pulse, RAG failure modes, OKRs in government, one-pagers | 9.2k | yes | yes |
| competitive-matrix.md | 43 capabilities × 13 products, loved/hated, white space, complexity budget | 3.4k | n/a | n/a |

## Technology (code-level)

| File | Dimension | Words | Verified | Gap-fill |
|---|---|---|---|---|
| design-systems-craft-and-motion.md | shadcn/Tailwind v4, tokens, OKLCH, Uzbek glyphs, craft references | 7.8k | yes | yes |
| tech-animation-and-visual-craft.md | Motion system tokens, 28 micro-interactions with code, performance, dark mode, refusals | 6.6k | n/a | n/a |
| data-dense-ui-components.md | TanStack Table v9.2, pragmatic-dnd, FullCalendar 7, d3-org-chart, Recharts 3, cmdk; Excalidraw vs tldraw | 11.8k | yes | yes |
| tech-frontend-stack-deep-dive.md | Vite 8, React 19.2, TanStack, Tailwind 4, Base UI, Paraglide, Zod 4.5, Motion 12 with code patterns | 6.9k | n/a | n/a |
| frontend-architecture-and-sync.md | Architecture, sync engines (not yet), i18n, forms, offline queue | 8.5k | yes | yes |
| tech-realtime-boards-and-canvas.md | Centrifugo fan-out, fractional indexing, LWW vs Yjs, Excalidraw (MIT) vs tldraw (licence), JQL-lite | 6.0k | n/a | n/a |
| backend-architecture-and-multitenancy.md | Postgres 17 + RLS, Fastify, Drizzle, tenancy, jobs, search, on-prem ops | 9.8k | yes | yes |
| tech-backend-stack-deep-dive.md | Fastify 5 structure, Drizzle RLS, `set_config`, pg-boss 10, Centrifugo 6, CASL, Keycloak 26 Organizations, Compose | 7.7k | n/a | n/a |
| auth-permissions-security-compliance.md | Keycloak, RBAC + tiers + sharing, delegation, audit, ASVS L2, localisation law | 9.6k | yes | yes |
| notifications-telegram-mobile.md | Inbox model, Bot API 10.3, grammY, Mini App SDK, quiet hours, custom worker over Novu | 10.0k | yes | yes |
| ai-features-and-assistants.md | Vendor AI, 23-feature intelligent catalogue, Claude API mechanics, AI SDK 7, pgvector + RLS, evals, Uzbek model quality | 12.6k | yes | yes |
| engineering-quality-and-agentic-delivery.md | Vitest/Playwright/Storybook 9/MSW/Testcontainers configs, ESLint 9, Turborepo, Changesets, Renovate, agentic practices | 7.2k | yes | yes |

## Caveats to read before citing

- **Search quota.** The shared WebSearch quota was exhausted partway through both days; many
  reports (and all of the 2026-09-05 technical ones) fell back to direct fetches of primary sources
  (official docs, GitHub releases, npm, lex.uz, live site CSS). Each says so in a methodology note.
  Facts are from primary pages; community sentiment coverage is thinner.
- **Unverified items are marked.** Where a report could not confirm a fact live (e.g. two decree
  numbers in the identity report, Golos Text glyph coverage), it says "UNVERIFIED THIS SESSION".
  Re-verify anything that decides procurement or appears in an official document.
- **Scope drift.** `documents-approvals-and-workflows.md` and parts of `hr-people-ops-features.md`
  explore a document-registry direction that the plan (v2) deliberately excludes; keep them as
  reference for Phase 3 integrations only.
- Dates and versions are as of 5 September 2026.
