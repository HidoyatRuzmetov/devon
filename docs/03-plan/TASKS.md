# Devon — master task list (2026-09-05)

Every epic below is in `backlog.json` (status `ready`, ordered by dependency). The ship loop takes
them one by one; `wp-pm` freezes criteria from the outcomes here plus TECH-SPEC, `wp-lead` splits
each epic into the work items listed (adjusted as needed), makers build, verifiers verify against
`agentic/HARDENING.md`, and `wp-release` ships. Nothing is "phase 2": the loop runs until the backlog
is empty.

## EPIC-000 Foundation
- Monorepo (pnpm + Turborepo), packages/config presets, exact pins from TECH-SPEC §1.2, provenance checks.
- `packages/ui`: DTCG tokens → Tailwind v4 `@theme` (Palette B light/dark), type scale, motion tokens, base primitives (Button, Input, Select, Dialog, Sheet, Toast, Skeleton, EmptyState, Kbd), Storybook 9 with a11y + glyph test page (Oʻ Gʻ ʼ).
- `packages/i18n`: Paraglide with uz-Latn/uz-Cyrl/ru/en, transliteration script Latn→Cyrl, `check-i18n` four-way parity, `TERMS.md` terminology pass (job titles, unit words, statuses, actions) with sources from ministry sites/job postings.
- `packages/db`: Drizzle, migrations, RLS helpers, `audit` schema with grants/trigger/hash chain, `normalize_uz()`, seed framework with `--demo` flag and demo chip.
- `apps/api`: Fastify skeleton with context, db, errors, security (helmet/CSP/CORS/rate-limit/compress), openapi, sessions core, super admin bootstrap (first-run setup URL), `/healthz`, `/readyz`, maintenance plugin stub.
- `apps/web`: shell (sidebar, top bar, command registry, inbox drawer, detail panel), router with loaders, Query persister, theme/tenant attribute, four-locale switch, empty/loading/error/offline states.
- `infra`: Compose (caddy, api, worker, web, postgres, valkey, minio, centrifugo, clamav, pgbackrest, glitchtip optional), `.env.example`, sentinel skeleton (host service, localhost only, signed commands), backup scripts, CI (GitHub Actions/GitLab CI with gate profiles), Renovate config.
- `e2e`: Playwright projects (3 widths × 2 themes × 2 locales), routes.json, axe runner, k6 smoke, Lighthouse CI config.
- ADR-000…011. All gates green on the scaffold, including cross-department isolation and audit immutability tests.

## EPIC-001 Accounts
- Register (login/email optional, password policy, name fields, photo upload with ClamAV + sharp variants, title optional, locale/timezone), login, logout, sessions/devices page, sign-out-everywhere.
- Optional 2FA: TOTP enrol/verify/recovery codes; Telegram code path (stub until EPIC-007); rate limits; lockout; uniform errors.
- Password reset by super admin (temp + forced change) and by Telegram code; must-change-password flow.
- Profile page and settings (locale, timezone, notifications placeholder, delete account with 30-day anonymisation).
- Fresh-account landing: "Create a department or join one".

## EPIC-002 Departments
- Create-request form (name, description, bo'limlar rows with colours, locale, emoji/colour); pending state screen; super admin notification.
- Approval/rejection (reason) → department creation, head membership, join key generation, password set.
- Invite sheet: link `/join/<key>`, password, QR, "Copy invitation" localised text in four locales, rotate key/password, join-approval toggle.
- Join by link (auth interception, password prompt) and by form (key + password); pending-approval state; rate limits; audit.
- Memberships: list, roles, remove, leave, transfer headship; department switcher; settings page (self-assign, structure edit, join approval, Telegram group permission, quiet hours, locale, colours, deletion request).

## EPIC-003 Structure
- Units CRUD with unlimited nesting (ltree/closure), colours, drag reorder, rename inline, delete with undo (members become unassigned).
- Unit roles: self-assign as head/deputy/member (settings-gated), assign others (head), badges.
- Org chart (vendored d3-org-chart) that renders departments with no unit heads gracefully; member cards; keyboard navigation; export PNG.

## EPIC-004 Work core
- Cards: full model, giver/assignee pickers from members, due with risk badge, priority, labels, links with unfurl (SSRF-safe), attachments, nested checklist, comments with mentions, activity timeline, watchers, undo archive.
- People board: columns per member grouped by bo'lim (colour sections, unassigned last), virtualised, DnD (mouse + keyboard + announcements), fractional ordering, card peek and full page, quick-add bar with member/date parsing (rules; AI later).
- Views: table (inline edit, group, density), timeline, calendar, "mine", saved views; filter grammar + parser + tests; archive page per person (department-readable, restore).
- Realtime board updates via Centrifugo; optimistic mutations; offline queue.

## EPIC-005 Group projects
- Projects with members, objective tasks (shared cards/checklist items) and subjective tasks (per member), milestones, progress computation, project page, project cards appearing in members' columns, templates, archive.

## EPIC-006 Inbox and notifications
- Event bus → notifications with reasons; inbox drawer and page; preferences per type/channel; quiet hours; deadline reminders; daily/weekly digests; ICS feeds; email adapter (optional SMTP).

## EPIC-007 Telegram
- Bot (grammY, webhook, throttler), linking via `/start <code>` + QR, locale-aware templates, commands, inline actions (RSVP, poll vote, done, snooze), reset/2FA codes, department group connect via join key with kinds selection, group updates and weekly summaries, pointer-not-payload serializer + test.

## EPIC-008 Events
- Event CRUD with categories, illustrations/covers, capacity + waitlist, RSVP with guests/change/cancel, comments, change notifications with diff, reminders, carpooling (offer/claim/waitlist, driver contact via app), polls (date/single/multi, anonymous, deadline, results animation), who-brings-what list, photos (links), feedback, calendar view, ICS, cancel flow.

## EPIC-009 Personal workspace
- Sprints (3h/day/week/custom) with goal and rollover; nested tasks with checkboxes, drag, keyboard; today/focus view; notes; canvas (Excalidraw + stickies overlay); Pomodoro (defaults 25/5/15/4, editable, sessions log, sounds, notifications, mini widget in the shell, stats); privacy enforced by RLS; link a personal task to a department card.

## EPIC-010 Analytics
- `analytics_daily` aggregates + on-write patches; analytics page with filter bar/grammar, saved filters, sections per TECH-SPEC §9, animated charts, CSV/PNG export, pin to Home; personal stats; performance budget (no heavy query on request path).

## EPIC-011 Pages and onboarding-lite
- Pages (Tiptap, versions, mentions, checklist items), how-we-work template, onboarding template → newcomer checklist in personal workspace on join (opt-in per department).

## EPIC-012 AI helpers L1
- Gateway (GLM-5.2, budgets, traces, flags, evals), features per TECH-SPEC §8 with previews and accept flows, settings page, promptfoo sets, Uzbek/Russian golden set, `ai-evals` gate blocking.

## EPIC-013 Super admin console
- Requests queue, departments (view-as read-only, pause department, archive/restore), accounts (search, lock, reset password, 2FA reset, delete), global analytics with polished visualisations, audit viewer + chain verification + export, health page, registration toggle, pause switch (four-locale message, 503 page, API 503, bot reply, Caddy fallback), wipe switch (sentinel command, password + 2FA + phrase + 60 s countdown, host CLI), docs.

## EPIC-014 Hardening and release 1.0
- Execute `agentic/HARDENING.md` H1–H30 across the product; write `docs/03-plan/PRODUCTION-READINESS.md` with before/after measurements (request counts, bytes, query counts, LCP/INP/CLS, bundle, p95, memory); fix everything fixable; list external configuration precisely; tag v1.0.0 with a four-locale changelog.

## EPIC-015 Telegram Mini App
- Inbox, board peek, RSVP, polls, Pomodoro companion; `initData` validation; theme mapping; haptics.

## EPIC-016 AI L2
- Embedding sidecar (bge-m3), semantic search, ask with citations, related cards, similar projects, permission-aware retrieval tests.

## EPIC-017 Automations, recurring cards, templates gallery
- Five triggers, fill-in-the-blank rules, per-department opt-in; recurrence engine; gallery for projects/events/pages.

## EPIC-018 Realtime polish
- Presence on boards, typing indicators, live cursors on canvas (Yjs behind flag).

## EPIC-019 Calendar sync and web push
- CalDAV/Graph adapters, VAPID push opt-in.

## EPIC-020 Operations
- Install guide for another server, restore drills scripted, update channel, k3s option, runbooks.
