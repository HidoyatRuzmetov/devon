# Reference site audit — "Department Operations Hub"

Source: https://department-operations-hub.aabdulakhadov.chatgpt.site/ (vibe-coded prototype by supervisor, dated 26 Aug 2026)
Audited: 2026-09-04, end to end, every section clicked, DOM/CSS/network inspected.

## What it is technically
- Static single-page React app built with Vite (rolldown runtime), no backend, no routes (sidebar buttons swap views in memory), no forms, no persistence. Every "Profile" / "RSVP" / row is a non-functional label. Cloudflare-hosted.
- Styling: shadcn/ui-style CSS variables (`--background`, `--card`, `--primary`, `--sidebar*`, `--radius: .85rem`), Tailwind utility classes.
- Typography: body `Aptos, "Segoe UI", Arial, sans-serif`; headings `Georgia, serif` at 24px. Uppercase letter-spaced eyebrow labels ("INTERNAL OPERATIONS", "WORKFORCE", "NEXT 30 DAYS").
- Palette (worth keeping as a starting mood, not a rule):
  - background `#f4f2ed` (warm off-white), foreground `#1c2520`, card `#fff`, border `#deddd7`, muted `#eceae4`, muted-fg `#6b746e`
  - primary `#315b4c` (deep green), accent `#e1e9e5`, ring `#709283`, destructive `#ad3d36`
  - sidebar `#19362e` (dark forest green), sidebar-primary `#d8a35e` (amber/gold), sidebar-accent `#28483e`, sidebar-border `#315148`
  - sub-department identity colours: green (SR), amber/brown (DB), slate blue (ID), plum (EF)
- Layout: fixed 260px dark sidebar (logo, "WORKSPACE" nav with counts, "Sample workspace" note, user card), light content area with sticky header (eyebrow + serif H1 + "SAMPLE DATA" chip + date), max-width cards grid, `.85rem` radius, soft shadows.

## Sections (all six), with content and what each implies
1. **Overview** — 4 KPI cards (Total workforce 23 with avatar stack; Sub-departments 4, avg team 5.5; Active projects 14, "3 due soon", "82% on track"; Portfolio health 82% progress bar, "+6% since last month"). Then "Sub-department snapshot" list (name, headcount, active projects, chevron) and "Upcoming deadlines (next 30 days)" (date tile, title, unit). Then "Department priorities — this quarter" (3 objectives with % progress: EGDI performance 76%, AI-ready data layer 62%, scale pilots 48%).
   → Implies: a home that answers "how are we doing, what is due, what matters this quarter" in one screen.
2. **People** — 23 profile cards: initials avatar, name, position, sub-department chip, work email, work phone, education (field + university), "Profile" link (dead). Banner: "Dates of birth and personal contact details should be visible only to authorized HR and managers."
   → Implies: directory + field-level privacy (public work profile vs restricted HR record).
3. **Organization** — org chart (Director → 4 sub-departments with head + headcount), then tabbed "Sub-department views": mandate paragraph, 3 responsibility bullets, team roster, active work list (numbered projects).
   → Implies: hierarchy is a first-class object; each unit has mandate, people, projects.
4. **Projects** — summary tiles (On track 8, Needs attention 3, Avg progress 57%), then a register table: project/owner (unit · person), status chip (On track / Planning / At risk / Blocked), progress bar %, deadline, latest comment + "N comments · when". Footer rule: "project leads update progress and one short comment every Friday; a missed deadline or blocked dependency automatically moves the item into the management review queue."
   → Implies: lightweight portfolio tracking with a weekly ritual and an automatic escalation queue. This operating rule is the single most valuable idea on the site.
5. **Activities** — 4 upcoming events (team building, sports, volunteering, social) with date tile, category, RSVP-open/Planning state, description, place, time, capacity "18 / 25", RSVP button (dead). Sidebar checklist of what each plan should include (owner/budget, date/location/transport, capacity/RSVP deadline, accessibility/dietary, safety/weather backup, post-event feedback). Note: "Attendance should always be optional."
   → Implies: culture/events module with RSVP and capacity — a humane touch most work tools lack.
6. **Development roadmap** — Employee record fields worth adding (role context, capabilities, assignments, availability, restricted HR). Phase 1 Now: reliable operations (verified directory with data owners, standard project status + weekly comments, unit/portfolio views, role-based access to sensitive fields, one source of truth). Phase 2 Next: connected workflows (HR/email/calendar integrations, automated deadline reminders, leave/training/activity calendars, document links + approval history). Phase 3 Later: decision intelligence (workload/capacity balancing, skill-gap and succession insights, delay/dependency alerts, executive portfolio forecasting). Principles: privacy by design (separate public/internal/restricted; log who viewed/changed sensitive data), clear ownership (employees verify quarterly, leads update weekly, unit heads approve), useful integrations (stable IDs across systems).
   → Implies: the supervisor already thinks in terms of an "operating system" for the department, ownership rituals, and privacy tiers. Treat this page as the brief behind the brief.

## Domain facts encoded in the sample data
- Department: "Information & Analytical Activities" (Ministry of Digital Technologies context), director + 4 sub-departments: Strategy & Rankings (EGDI, global indices, policy briefs, international coordination), Data & BI Analytics, Innovation & Digital Transformation, Economic Development & FinTech. 23 people, positions from Specialist → Senior → Lead → Chief Specialist → Head of Sub-department → Director.
- Projects are policy/analytics initiatives (EGDI 2026 Evidence Audit, Digital Government Strategy 2030, AI-Ready Data Layer, GovTech Pilot Portfolio, FinTech Regulatory Scan, …), 1–3 month horizons, single accountable owner, comment-driven status.
- Uzbek names, .uz emails, +998 phones, Tashkent universities and venues. English UI.

## What is good (keep)
- Calm, editorial visual tone: warm paper background, dark green sidebar, serif headings, small-caps eyebrows. Feels institutional without feeling like Jira. Low visual noise.
- Every screen is readable in five seconds; numbers are big, labels are plain language.
- The operating rules (Friday update ritual, auto-escalation queue, quarterly profile verification, privacy tiers) — these are product ideas, not decoration.
- Activities module and "attendance is optional" — humane.
- The roadmap's ordering: trustworthy records first, integrations second, intelligence third.

## What is missing (everything that makes it a tool rather than a poster)
- No interaction at all: no create/edit, no detail pages, no search, no filters, no comments, no notifications, no auth, no roles, no data.
- No tasks below the project level; no documents/notes; no calendar; no leave; no approvals; no files; no mobile; no Uzbek/Russian; no dark mode; no keyboard; no empty/loading/error states; no onboarding.
- Org chart is one level; no history; no cross-department view; no tenant concept for other ministries.

## Verdict for the build
Keep the mood (palette family, editorial typography, five-second readability, operating rituals). Replace everything else. The reference is a well-taken photograph of the destination, not a vehicle.
