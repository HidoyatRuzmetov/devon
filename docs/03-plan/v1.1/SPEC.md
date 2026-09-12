# v1.1 specification — "the head's product" (2026-09-12)

Author: the orchestrating session (Fable), from BRIEF.md and the five recon reports in this folder.
Those reports are normative where this spec cites them; this spec decides where they left choices open.
Every agent building v1.1 reads BRIEF.md, this file, then the report its task names.

Product name in the UI stays **WorkPortal** (what the CTO and management already call it); "Devon" is
the codename in code and docs only. Remove "Devon" from user-facing copy where it appears.

## 1. Goals and non-goals

Goals, in priority order:
1. A head (boshqarma boshlig'i) and a member (xodim) get two different products in one shell: the head
   manages people, load, risk, decisions and settings; the member works. Nothing head-only is visible or
   reachable by a member, on the server first.
2. The people table with dynamic indicator columns and custom fields, the person page, and "notify to
   fill" — the CTO's named features — fully built.
3. Work becomes ClickUp-grade where it pays: custom fields, saved views with columns, estimates,
   workload, dependencies, recurring cards, templates, bulk bar, Me mode/focus list, goals, reminders,
   automations — each behind a department switch, off by default except what exists today.
4. AI features that a civil servant recognises as useful, honest about being simulated when no key is
   set, with a unique prompt per feature and outputs that are actually applied on Accept.
5. The phase-2 epics that make the product complete: Telegram Mini App, realtime presence, calendar
   feeds and web push.
6. Every finding in WALKTHROUGH-FINDINGS.md fixed; four locales; both themes; 390 px; motion catalogue.

Non-goals for this round (hardening-blitz measure/audit/release close it afterwards): load testing,
Lighthouse targets, backup drills, the release tag. Still no HR module (I-2), no documents suite, no chat.

## 2. Roles and the permission matrix

### 2.1 Subject kinds in `packages/contracts/src/permissions.ts`

Today `department_child` grants any active member every action, which is the root cause of
PERMISSIONS-AUDIT D1–D7 and D14–D15. Replace the flat model with four kinds:

| kind | who may read | who may write | used for |
|---|---|---|---|
| `department` | any active member (profile, settings values, roster) | head only | department settings, invite, members, headship, deletion request |
| `department_managed` | head only | head only | per-person analytics, AI budget/spend/all traces, custom-field definitions and notify-to-fill, people table and indicators, person pages of others, Telegram groups, labels, onboarding templates, saved-view sharing policy, work schedules and capacity, goals, automations, feature switches |
| `department_child` | any active member | any active member may **create**; update/archive/delete fall through to `owned` | cards, projects, events, pages, comments, polls, carpools, saved views, pins |
| `owned` | as `department_child` | the object's owner set **or** the head | edit/move/reassign/archive a card (owner set = giver, assignee, creator); edit a project and its milestones and members (owner = project owner); edit/cancel an event (organizer); delete a page or restore a version (author); delete a comment/photo/carpool/poll (author) |
| `personal` | owner only | owner only | unchanged (I-1), no super-admin lens, ever |
| `instance` | super admin | super admin | unchanged |

`can(actor, action, subject)` takes the owner set in the subject (`{ kind: 'owned', departmentId,
ownerUserIds: [...] }`) so every route passes real ids and the check stays centralised (I-7). Remove
every hand-rolled `isHead` check in modules in favour of these kinds. Exhaustive unit tests for every
cell of §2.2; cross-role integration tests (member → 403 on every head-only route; list endpoints omit
head-only fields).

### 2.2 The matrix

PERMISSIONS-AUDIT §4 is adopted as written, with these decisions where it left options open:

- Structure: `allow_structure_edit` **defaults to off**; `allow_self_assign` stays on; deleting or
  archiving a bo'lim is head-only regardless of settings. The settings key-casing bug (D1) is fixed and
  covered by a test that flips each switch and observes the effect.
- Joining: `join_requires_approval` **defaults to on** for new departments; a join-approval queue exists
  (endpoints + UI on the department's Members tab + inbox notification to the head + Telegram); the
  demo department keeps approval off so joining stays one step in demos.
- Passwords: a head may reset a member's password (temporary password + forced change, audited,
  member notified); the super admin may reset anyone's. The login screen's forgot-password copy says
  exactly who to ask, and the request is one click (creates an inbox item for the head).
- Analytics: department aggregates for everyone; anything with a person axis (load per person,
  overdue ranking, cycle time by person) head-only; unit-level aggregates for everyone; export inherits
  the chart's gate.
- Workload view: head-only. A member sees their own load on Home ("Mening yuklamam") and on their own
  person page. No leaderboard anywhere.
- AI: feature availability visible to all; budget, spend and all traces head-only; own traces
  visible to the member.
- People: members get a directory (name, photo, title, bo'lim, unit role, work contact actions allowed
  by the head's setting); the table with indicators, the person page of others and custom-field values
  of others are head-only. A member sees and edits their own person page and own field values.
- Create-department CTA appears only in the no-department state; a member already in a department
  finds it under the hub's overflow, not as the primary action.
- `/admin/*` and `/departments/requests` are route-gated in the client with the shared no-permission
  state; the server was already correct.

### 2.3 Department switcher

`actor.departmentId` is resolved per request from a signed `devon_dept` cookie set by
`POST /me/active-department` (must be one of the actor's active memberships; default = first
membership). The client switcher calls it and invalidates queries. Every department-scoped route keeps
working through `can()` unchanged.

## 3. Two products in one shell

### 3.1 Sidebar

Member (xodim): Bosh sahifa · Bildirishnomalar · **Ish** (Vazifalar, Guruh loyihalari, Shaxsiy) ·
**Jamoa** (Tadbirlar, Xodimlar, Tuzilma) · **Bilim** (Sahifalar, Tahlil) · Hisob sozlamalari.
Head adds a **Boshqaruv** group: Xodimlar jadvali (people table), Yuklama (workload), Maqsadlar (goals),
Maydonlar (custom fields), Avtomatlashtirish (automations), Boʻlim sozlamalari (settings incl.
Imkoniyatlar switches, invite, members with join approvals, Telegram groups, notification defaults, AI
budget). Sidebar and palette entries declare the action they need; `useCan` hides them. `/ai` for a
member is the "what helpers exist" panel; for the head it is the budget/flags/spend screen.

### 3.2 Head Home — the management dashboard

Greeting, then tiles in this order, each with a real number (NumberFlow), a one-line meaning, and a
drill-down: **Qaror kutmoqda** (cards awaiting the head's decision: mentions of the head, join
approvals, field requests unfilled, automation failures) · **Kechikayotgan ishlar** (overdue by person,
top 5, click → person page) · **Xavf ostida** (at-risk cards from `computeRisk`, click → card) ·
**Bu hafta yuklama** (capacity bar per person from the workload service, click → workload) ·
**Loyihalar** (progress rings, slipping ones first) · **Tadbirlar** (next 7 days with RSVP counts) ·
**Yangi xodimlar** (onboarding progress per newcomer, click → person page) · **Maqsadlar** (goal
progress) · **AI xulosa** (the department catch-up briefing, head-only, with citations) · pinned charts.
An arrangeable layout (drag tiles, hide tiles; persisted per head). Empty states teach the next action.
The member Home stays the working view (due from me, needs my decision, around me, sprint, focus,
onboarding checklist) and gains "Mening yuklamam" (own capacity bar) and the focus list (§7).

### 3.3 Board default

The board shows the whole department grouped by bo'lim for everyone; a segmented control
"Hammasi | Mening" persists per user; the head's default is Hammasi sorted by overdue then load. At 26+
columns: column collapse-all, compact density, sort by load/overdue, project chips shown once. The
card avatar is the assignee; the giver is a small secondary avatar with a tooltip.

## 4. People

### 4.1 Directory (everyone)

`/people`: search-first, grouped by bo'lim, cards or a simple table (name, bo'lim, unit role, title),
hover card with work contact actions (Telegram deep link if linked and allowed, "open board column",
"assign a task" for anyone since any member may create a card for a colleague). No indicators, no
person-page link for members except their own row.

### 4.2 Indicators registry (shared)

`packages/contracts/src/indicators.ts`: a typed list, each with `id`, `labelKey`, `type`
(count|percent|duration|date|text|enum|list), `format`, `descriptionKey`, `headOnly` (all true except
`unit`, `unitRole`, `title`, `joinedAt`), `source` (`cards` | `projects` | `events` | `personal_aggregate`
| `onboarding` | `activity`). v1.1 set: `openCards`, `overdueCards`, `dueThisWeek`, `doneLast30d`,
`onTimeRate90d`, `workloadHours` (estimates this week vs capacity), `workloadPct`, `projects`,
`projectsOwned`, `eventsRsvpRate90d`, `pollsTurnout`, `focusMinutes7d` (aggregate only, never
content), `lastActiveAt`, `onboardingPct`, `unit`, `unitRole`, `title`, `joinedAt`, `telegramLinked`,
`cardsGivenOpen` (as giver). Computed by `GET /people/indicators?ids&keys` in batched SQL (one query
per source, never per person), cached 60 s per department, head-only; the same service feeds the
table, the person page and the head dashboard.

### 4.3 People table (head) — `/people/table`

TanStack Table + Virtual. Default columns: **Ism** (avatar + name + title), **Boʻlim**, **Vazifalar**
(open cards as chips, first three + "+N", click → board column), **Yuklama** (bar: hours vs capacity, or
open count when estimates are off). Column picker: every registry indicator and every person custom
field, grouped; drag to reorder; resize; per-column sort and filter (numeric ranges, enum sets, date
ranges, text); group by bo'lim (default) or unit role; density; a footer row with per-column
calculations (count, filled, average, sum, min, max as the type allows); CSV export (audited).
Saved views as a tab strip (private + shared, one department default set by the head; URL is the
state; "Saqlash / Har doim saqlash" prompt on change). Row click → person page. Row actions: assign a
task (quick-add sheet with assignee preset, title, due, priority, estimate), open board column,
message via Telegram deep link, "ask to fill" for a specific missing field. Selection + bulk bar:
assign task to many, ask to fill, export selection. 390 px: rows collapse to cards with the first three
columns. Everything four locales, motion catalogue (stagger, hover lift), states.

## 5. Custom fields and notify-to-fill

CLICKUP-RESEARCH A1 and A5 adopted with these decisions:

- One module `fields`: definitions `field_defs` (department, `applies_to` card|person, key, label
  i18n jsonb with AI-translate offer, type text|long_text|number|date|select|multi_select|person|url|
  checkbox|derived, options with colours, required, default, description, `show_in_table`,
  `show_on_card_tile`, `self_editable` (person fields), `visible_to` everyone|head_only (person
  fields), order, archived_at) and `field_values` (department, def, subject_type, subject_id, value
  jsonb, updated_by, updated_at) with RLS, unique (def, subject), GIN on value. Caps: 20 card fields,
  10 person fields, with the reason in the copy. I-2 blocklist enforced on the definition (name in all
  four locales, both scripts, normalised) with the translated refusal. Person fields are stored against
  the membership (department-scoped). Head-only person values are never in list endpoints and every head
  read is audited. `packages/ai` strips person field values from every prompt payload (golden case).
- Filter grammar: `field:<key>:<value>` and `field:<key>:boʻsh` across work views, saved views,
  analytics and the palette.
- **Notify to fill**: from the field manager or a table column header, the head triggers a request for
  a person field: creates one `field_request` per active member without a value (dedupe on open
  request), emits `fields.request.created` → inbox notification (reason `field_request`, deep link to
  `/account#fields`) and an individual Telegram bot message in the member's locale with an inline
  "Toʻldirish" web-app/link button; never a group message. Progress (filled / total) on the field, a
  reminder job after N days (default 3, configurable), the head can nudge once more; the member's
  `/account` shows "Mening maʼlumotlarim" with required-missing highlighted; filling resolves the
  request and, if the head asked for it, notifies the head in a daily batch, not per fill.
- Card fields appear in the card detail property column in the head's order, inline-editable, as
  columns in the table, as chips on the tile when `show_on_card_tile`; required fields block moving to
  done with an inline message.

## 6. Person page — `/people/:userId`

Head sees anyone; a member sees only their own (`/people/me` redirects). Header: avatar, name, title,
bo'lim, unit role, joined, last active, Telegram linked, custom-field summary chips; actions (head):
assign a task, ask to fill, open board column, message. Tabs: **Umumiy** (KPI tiles from the registry
with NumberFlow; charts: throughput per week 12w, on-time trend, load by project, events participation;
risk list of their overdue/at-risk cards) · **Vazifalar** (their cards with the work filter bar, giver
and assignee both) · **Loyihalar** (with role and progress) · **Tadbirlar** (RSVPs, carpools, polls) ·
**Onboarding** (checklist progress, only while incomplete) · **Maydonlar** (custom field values, missing
highlighted, ask-to-fill) · **Faollik** (activity timeline from audit-derived events, work only, never
personal workspace content). Own page for a member: same tabs minus Faollik of others, plus "edit my
fields". Print-friendly.

## 7. Work extras (CLICKUP-RESEARCH A2–A13, EPIC-017)

All behind **Imkoniyatlar** switches in department settings (head-only; members see the switches
read-only): custom fields, person fields, estimates, workload, dependencies, recurring cards, templates,
goals, focus list, automations, reminders. Defaults: everything off except what v1.0 already had; the
demo department has them all on.

- **Saved views with columns** on `/work/table` (A2 as written): column picker incl. custom fields,
  reorder, resize, pinned title, tab strip, department default view, footer calculations.
- **Estimates** (A3): `estimate_min` on cards, natural-language entry in four locales, a light time log
  (logged minutes per card per person), remaining, shown per person in workload.
- **Workload** (A4, head-only): `/work/workload` week grid, six weeks, hours vs capacity, three-step
  colour, "Hisobga olinmagan" panel, drag between cells with undo, work schedule and per-person capacity
  overrides in settings (members may set their own capacity), holidays greyed.
- **Dependencies** (A10): blocks/blocked-by with cycle guard; "blocked" chip on tiles; arrows on the
  Gantt; automations can react.
- **Recurring cards** (A7): rule (daily/weekly/monthly/custom RRULE subset), next instance created by a
  job when the current one is done or at the schedule, chip on the tile, series edit vs instance edit.
- **Templates** (7.2): card and project templates; department templates curated by the head, personal
  templates; create-from-template in quick-add and the project stepper; gallery with preview.
- **Bulk bar** (A8) on board, table, mine, archive: assign, label, priority, due, move, estimate, archive
  with undo; keyboard multi-select.
- **Me mode and focus list** (A9): "Mening" segmented control on every work view; a focus list of up to
  five pinned cards ("Diqqat markazi") on My tasks and Home; opt-in visibility to the head, off.
- **Reminders** (7.4): on a card, "remind me at" → inbox + Telegram; snooze from the notification.
- **Goals** (A11, head): a goal with targets bound to filters (count of done cards matching, percent
  on-time, a number field), auto-computed progress, shown on the head dashboard and a `/goals` page.
- **Automations** (EPIC-017): triggers card created / moved to status / assigned / due soon / overdue /
  field changed; actions assign, set priority, add label, notify person or head, move, add checklist
  from template, create follow-up card; a head-only rule builder with a run log and a kill switch;
  loops guarded (a rule cannot trigger itself twice in one chain).

## 8. AI rebuilt

AI-AUDIT §3–§5 is adopted. Decisions:

- Feature set: `quick_add` (with `today` and member list; labels applied on Accept), `subtasks`,
  `plan` (scope person-sprint | project; real inputs: due dates, capacity, priorities, blockers; the whole
  ordered plan is applied on Accept), `risk_explain` (explains `computeRisk`, never re-decides),
  `catch_up` (scopes: my since-last-visit, my week, department week for the head; drives the Friday
  department digest and the head dashboard briefing; citations enforced server-side), `draft_event`
  (checklist, poll and carpool applied on Accept), `thread_digest` (decisions + open questions with
  cited comment ids), `ask_analytics` (uses the filter grammar with known labels/projects/units/members;
  answers with the numbers and the filter it used; never leaks an English fallback), `translate`
  (explicit target picker; uz-Latn↔uz-Cyrl handled locally), plus new `draft_reply` (comment box and
  inbox mention; compose, never auto-post), `board_risk_digest` (head, one batched call), `suggest_assignee`
  (top 3 with workload/experience reasons, the head chooses), `project_catch_up`, `duplicate_check` (title
  similarity prefilter + one confirmation call). Nine prompts total; each with system role, fetched
  inputs in a stated shape, constraints (user's locale, correct oʻ/gʻ via normalize-uz, never invent
  people or dates, cite ids), Zod output schema, few-shot examples, temperature per feature, golden
  cases, and a `validateOutput` hook enforcing citations.
- Honesty: `meta.simulated` from the gateway; the UI shows an amber "Namunaviy javob" strip and no fake
  model/cost/latency when simulated; the admin health page and `/ai` agree on whether a key is set.
- Surfaces: every host screen keeps the SparkleButton + AiPreviewPanel pattern with structured previews
  (parsed fields with confidence, ordered plan with reasons, briefing with risks and overloaded people,
  decisions and open questions, complete event draft, analytics answer with the filter); Edit ≠ Accept;
  no auto-posted AI comments; AI actions in Ctrl+K.
- `/ai`: head sees budget ring, per-feature spend this month, flags with descriptions and examples,
  traces with "who ran it"; member sees the helper catalogue (what, where, example) and own traces. The
  raw-JSON Yordamchi tab is removed.
- Gateway: temperature per feature, truncated-tool-call retry, blocked traces recorded, `ai-evals` in the
  integration profile, cost shown in soʻm.
- AI L2 (EPIC-016): probe `/v1/models` and `/v1/embeddings` at runtime; if an embeddings model exists,
  pgvector embeddings for cards, comments, pages and events via a job, semantic search in the palette
  and an "Ask" box with citations; otherwise the same UX on FTS + trigram with the settings screen saying
  so. Duplicate detection uses whichever is available.

## 9. Telegram Mini App (EPIC-015)

`apps/miniapp` (Vite, shares packages/ui tokens, Telegram theme params): initData HMAC verification
issuing a short-lived session bound to the linked user; screens: Bildirishnomalar (inbox with inline
actions), Doska (my column + department summary), card quick view (done, comment, snooze), Tadbirlar
(RSVP, carpool claim), Soʻrovnomalar (vote), Pomodoro companion (start/stop synced with the personal
workspace), Bugun (personal today list), Maydonlar (fill requested person fields — the notify-to-fill
button opens here). Bot commands open the Mini App via a web_app button; a dev-mode initData stub is
documented so it runs in a normal browser; real-bot verification when `TELEGRAM_BOT_TOKEN` is set.

## 10. Realtime, calendar, push (EPIC-018, EPIC-019)

Centrifugo: token endpoint, per-department channels authorised like `can()`, presence avatars on the
board, "editing" indicator on a card, typing in comments, live card moves and inbox counts replacing
polling; canvas live cursors only for a canvas the owner shares to a project or event (private canvas
stays private). Calendar: per-user secret ICS feeds (events, card due dates), regenerate/revoke,
add-to-calendar links; CalDAV read-only if feasible, else documented. Web push (VAPID) with opt-in in
inbox preferences and a service worker; reminders and mentions.

## 11. Notification pipeline repair (skeleton, before anything else)

STATE §7.1: the outbox → inbox path produces no notifications today. Fix in the skeleton: one registry
keyed on the events actually emitted, each mapping to a reason, recipients rule (assignee, giver,
watchers, mentioned, organizer, head, department), a deep link and a Telegram text builder; deliver by
channel per user preferences and quiet hours; a domain-events lint test that fails when an emitted event
name has no registry entry and vice versa; Telegram individual messages through the existing bot
adapter; the head is notified of join requests, field-fill completions (batched), automation failures.
Every later feature (fields, automations, reminders, Mini App) rides on this.

## 12. Smaller decisions from the walkthrough

Global "+ Yangi → Yangi vazifa" opens the composer; Ctrl+K searches cards, projects, pages, events,
people and actions with sections; `/department` without id shows the user's own department; event sheet
never clips at 1440×900 and has no horizontal scroll at 390; `toLocale*` calls use the app locale; the
three on-time percentages are reconciled with labelled denominators; undo on every mutation; the page
editor's delete is a menu item; the demo seed is scrubbed (no "Test kartochkasi", no "Nomsiz sahifa", no
triplicates, no `--`, no ASCII apostrophes) and extended with custom fields, estimates, a goal, a
recurring card, templates, an automation rule, join requests; blitz/test departments and accounts are
purged from the demo seed; login defaults to uz-Latn and light; admin status dots get labels; audit rows
show before/after; the AI trace has a "who ran it" column; the timeline is readable.

## 13. Delivery plan (maps to `.claude/workflows/v11-blitz.js`)

1. Skeleton S1 (master, Opus): §2 permission model + §3.1 sidebar/useCan + §3.2 head Home shell +
   §4.2 indicators service + §2.3 switcher.
2. Skeleton S2 (master, Opus): §11 notifications repair + join approval queue + head password reset +
   §3.3 board defaults + §12 seed scrub and defaults + ClickApps switches scaffold.
3. Wave (parallel worktrees, Opus/high): head-console (§3.2 fill, §4.3, §6), custom-fields (§5),
   work-plus (§7), ai-refit (§8), telegram-miniapp (§9), realtime-calendar (§10).
4. Merge → Integrate with chrome-devtools/playwright as all three roles → Critique (Opus) → Fable
   adjudication → Fix → Recapture and report.
5. hardening-blitz: sweep, measure, audit, release.
