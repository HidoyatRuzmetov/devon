# v1.1 brief — the CTO's findings and asks (2026-09-12)

Recorded verbatim in intent so the spec, the agents and the verifiers work from the same words.

## What the CTO found when testing

1. **Role leakage.** Features meant for the boshqarma boshlig'i (department head) are visible to a
   normal xodim (member). Every feature needs its allow-list re-decided: what a member may see and do,
   what a head may, what the super admin may. Decide like a product person who knows how a ministry
   department works, then enforce on the server and hide in the client.
2. **The head's product is the member's product with more buttons.** It must be different: the head's
   home is for *management* (people, load, risk, decisions), the member's home is for *working*.
3. **AI features feel random and gray.** They seem to mostly translate to Uzbek. Each feature needs a
   clear purpose, its own prompt and instruction set, useful output, and a UI that shows it well.
4. **Overall polish.** The product progressed a lot but still feels annoying, gray, unfinished in
   places. Human taste; make things easy; people are lazy, so the product must be easy and appealing.

## New features asked for

- **Person page (head-only).** Click a xodim anywhere → a page with everything about them: profile,
  bo'lim, role, their cards (open, overdue, done), projects, workload, on-time rate, focus minutes,
  events participation, onboarding progress, activity timeline, visual stats. Members do not see
  each other's pages (only their own profile). Decide visibility case by case with judgement.
- **People table with dynamic columns (head).** The Xodimlar page becomes a table that works as
  people metadata. Default columns: Name, Bo'lim, Tasks (auto-listed), Workload. The head chooses
  columns from a registry of auto-generated indicators (ko'rsatkichlar): open tasks, overdue,
  workload score, on-time rate, projects, events RSVP rate, last active, focus minutes, unit role,
  joined date, and so on, so any table they want is wired automatically.
- **Custom columns with "notify to fill".** For data we cannot derive (e.g. where they studied), the
  head creates a column (typed) and triggers a notify action: every member gets an individual
  Telegram bot message and an in-app notification asking them to fill their value; members fill it
  in their profile; the head sees the table fill up.
- **Actions from the table.** Click a row → the person page. Assign a task to the person right from
  the row (quick-add with assignee preset).
- **ClickUp study.** Learn ClickUp and adopt what fits (custom fields, workload view, table views,
  dependencies, time estimates, recurring tasks, templates, dashboards, Me mode, multitask toolbar,
  goals, reminders, automations).
- **Use the new testing tooling** (chrome-devtools and playwright MCPs, LSP) to test and fix a lot of
  features; polish existing ones.

## Delivery rules for this round

- Result-oriented: features, UI/UX, backend and frontend first; harden as we go; the deep
  optimisation, load testing and full security sweep come once everything works. Never "MVP" or
  wireframe quality: fully built, fully working, four locales, both themes, both widths.
- Opus is the lowest model for any agent; Fable for architecture and adjudication; effort medium or
  high everywhere.
- Deadline is close. Ship the whole product; do not drift into meta-work.
