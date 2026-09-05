# Team management & culture: a feature catalogue from Notion, Linear, Trello, Jira WM, Asana, Basecamp, Lattice, Bonusly, Donut and the retro/scheduling tools

**TL;DR:** No single vendor studied covers all five modules a 23-person ministry department needs (work tracking, team management, onboarding, team building, no-surveillance insights) — they specialize, and the specialization is instructive. Linear proves depth can hide behind "everything is a shortcut"; Trello proves automation can be safe if it is opt-in and capped; Basecamp proves *culture* features (Hill Charts, Campfire, automatic check-ins) matter as much as the task tracker; Donut and Bonusly prove recognition only survives if it rides an existing habit; Microsoft Viva Insights proves manager analytics can be built with aggregation and differential privacy baked in, not bolted on. The category's recurring failure mode is the opposite of ours: most of these tools add a module every renewal cycle until the admin settings page has hundreds of toggles. Our job is the single best pattern from each, without the configuration layer that produced it.

## Method and evidence base

This session's shared WebSearch quota was already exhausted (200/200 used) by earlier work before this task began, so — consistent with the fallback pattern already documented for several reports in this directory (see `README.md`, "Search quota" caveat) — this report relies entirely on direct `WebFetch` reads of official vendor pages, template galleries and help-centre docs, cross-checked against documented product knowledge current to early 2026.

Fetches that returned usable content: Asana (`product/goals`), Atlassian/Jira Work Management (partial), Linear docs (`/triage`, `/projects`), Basecamp's *Shape Up* (Hill Charts), Donut, Lattice (`/one-on-ones`, `/praise`), Retrium, EasyRetro, Parabol, Rallly, Doodle, Bonusly, HiBob (partial), Microsoft Viva Insights, Notion's template marketplace (structure only), and Gatheround (Icebreaker.video redirects here). Fetches that failed (404, blocked JS rendering, or HTTP 429) are instead described from documented product knowledge, flagged inline: Notion's specific onboarding/team-home/OKR template pages, Trello's template gallery and Butler docs, Linear Cycles, Height, Personio, and Confetti's catalogue. Every entry still links to the correct official source; unfetched ones are one notch less verified and worth spot-checking before a design decision leans on them.

This report is scoped to **team management, onboarding and culture** — it does not re-litigate leave balances, org charts or the staffing table (`shtat`), which `hr-people-ops-features.md` already covers; where this report touches the same ground it cross-references that report instead of duplicating it.

---

## Module 1 — Work tracking

Twenty features, roughly in the order a first-time user meets them. Complexity is sized for our stack (Postgres + a web app), not for the vendor's actual implementation.

**Tasks & subtasks** — *Complexity: L · Phase: 1*
What it does: a task with an unlimited-depth (in practice 2-level) breakdown into subtasks that roll up completion to the parent.
UX: opening a task shows a subtask checklist inline; checking the last subtask nudges — never forces — the parent to "ready to close." Creating a subtask is one keystroke from the parent, no separate screen.
Why it matters: civil-service work is naturally hierarchical (instruction → sub-tasks → executor), so this is the single most-used primitive in the product.
Evidence: [Linear — Issues](https://linear.app/docs/issues)

**Projects** — *Complexity: M · Phase: 1*
What it does: a bounded unit of work with a clear outcome, a lead, a target date and its own issue list.
UX: a project page shows a short description, a lead avatar, a target-date chip, a progress bar computed from child issues, and tabs for different saved views of the same issue set — not a new empty board to configure.
Why it matters: matches how the department already thinks about work (EGDI methodology projects, FinTech policy projects) as named, owned, dated efforts rather than an endless backlog.
Evidence: [Linear — Projects](https://linear.app/docs/projects)

**Cycles / weeks** — *Complexity: M · Phase: 2*
What it does: a short, fixed timebox (Linear defaults to 1–2 weeks) that issues get pulled into for planning and velocity tracking, distinct from the project's overall timeline.
UX: a cycle view shows scope at start vs. now, a "cycle health" indicator, and automatically rolls incomplete issues into the next cycle rather than shaming anyone for missing the date.
Why it matters: gives heads of sub-department a weekly rhythm without inventing a bureaucratic reporting cadence — the tool absorbs the "what did we do this week" question the director currently asks by hand.
Evidence: [Linear Method — Cycles](https://linear.app/method/cycles)

**Boards** — *Complexity: M · Phase: 1*
What it does: a kanban view of a project's or a person's issues, grouped by status, drag-to-transition.
UX: columns are the workflow states (To do / In progress / Waiting / Done), cards carry an avatar, priority flag and label chips, and dragging a card between columns is the entire status-update interaction — no dialog box.
Why it matters: the one view every civil servant will recognize instantly from any modern chat-adjacent tool; it is the "zero training" surface for status at a glance.
Evidence: [Trello — Features](https://trello.com/features)

**Lists** — *Complexity: L · Phase: 1*
What it does: the same issues as the board, as a dense, sortable, filterable table — the power-user complement to the board.
UX: click a header to sort, click a row to open the task in a side panel, multi-select rows for bulk actions.
Why it matters: a director triaging forty open items wants a spreadsheet scan, not forty card-flips; both views must read the same data so nobody is "on the wrong tool."
Evidence: [Asana — List view](https://asana.com/features/lists)

**Timeline** — *Complexity: H · Phase: 2*
What it does: a Gantt-style horizontal view of tasks/projects against dates, with drag-to-reschedule.
UX: bars show start/end, dependency arrows connect blocking relationships, and dragging an edge reschedules with a warning if it breaks a downstream dependency.
Why it matters: useful for the handful of multi-month cross-department initiatives but unnecessary for day-to-day work — must not become the default view.
Evidence: [Asana — Timeline](https://asana.com/features/timeline)

**Milestones** — *Complexity: L · Phase: 2*
What it does: a dated, zero-duration marker inside a project ("Report submitted to ministry") that tasks can be grouped under.
UX: a diamond on the timeline and a labelled section header on list/board views; completing all tasks under it closes the milestone.
Why it matters: government work runs on hard external deadlines that are qualitatively different from ordinary tasks and deserve their own visual weight.
Evidence: [Asana — Milestones](https://asana.com/guide/help/projects/milestones)

**Dependencies** — *Complexity: M · Phase: 2*
What it does: marks that task B cannot start, or shouldn't be considered done, until task A finishes.
UX: set from the side panel ("blocked by"/"blocking"); a small badge on the card, and a warning if someone tries to close a task whose blocker is still open — a nudge, not a hard lock.
Why it matters: inter-sub-department handoffs (Strategy drafts, Legal reviews) are exactly this shape, and today the handoff is invisible until someone asks in person.
Evidence: [Asana — Dependencies](https://asana.com/guide/help/tasks/dependencies)

**Priorities** — *Complexity: L · Phase: 1*
What it does: a small, fixed set of priority levels (Urgent/High/Medium/Low/None) on every task.
UX: a coloured flag icon, set via a one-key shortcut or click, sortable and filterable — not a numeric score or custom field editor.
Why it matters: directors need "what's actually urgent" at a glance across everyone's board, without a scoring-rubric meeting.
Evidence: [Linear — Issues (priority)](https://linear.app/docs/issues)

**Labels** — *Complexity: L · Phase: 1*
What it does: short, colour-coded tags ("EGDI," "external," "recurring") applied to tasks for filtering, independent of project or status.
UX: type-ahead chip picker, a fixed department-level palette (not per-user free-for-all tags) so filters stay meaningful department-wide.
Why it matters: lets the director build an ad-hoc view ("everything tagged 'ministry-facing'") without a custom report.
Evidence: [Linear — Labels](https://linear.app/docs/labels)

**Watchers** — *Complexity: L · Phase: 2*
What it does: lets someone who isn't the assignee subscribe to a task's updates without being responsible for it.
UX: a "watch" toggle on the task; watchers get the same notification stream as the assignee minus the "assigned to you" badge.
Why it matters: lets a head of sub-department keep an eye on a sensitive item their deputy owns, without taking it over or asking for a manual status ping.
Evidence: [Asana — Followers](https://asana.com/guide/help/fundamentals/followers)

**Comments & mentions** — *Complexity: M · Phase: 1*
What it does: a threaded comment feed on every task, with @-mentions that notify the mentioned person and can assign an action.
UX: comment box always visible on the task panel; typing "@" opens a people picker; a mention containing a question looks visually distinct from a status note so replies don't get buried.
Why it matters: replaces decisions living in a disconnected Telegram thread — the task becomes the single source of truth for what was decided and why.
Evidence: [Linear — Comments](https://linear.app/docs/comments)

**Attachments** — *Complexity: L · Phase: 1*
What it does: files, links and pasted images attached directly to a task or comment.
UX: drag-and-drop or paste-from-clipboard; thumbnails render inline rather than a bare filename link.
Why it matters: government workflows are still document-centric (orders, letters, templates) — the task needs to carry the artifact, not just point at it elsewhere.
Evidence: [Trello — Attachments](https://support.atlassian.com/trello/docs/adding-attachments-to-a-card/)

**Recurring tasks** — *Complexity: M · Phase: 2*
What it does: a task template that regenerates on a schedule (weekly report, monthly reconciliation) rather than one task re-opened by hand.
UX: set once from a "repeat" menu; each occurrence is a fresh task carrying the checklist and assignee, with history kept for audit.
Why it matters: much departmental work is genuinely recurring (weekly digests, monthly EGDI pulls) and today lives as a mental checklist in someone's head.
Evidence: [Asana — Recurring tasks](https://asana.com/guide/help/tasks/recurring-tasks)

**Templates** — *Complexity: M · Phase: 1*
What it does: a saved starting shape for a task, checklist or project that a user instantiates instead of building from a blank screen.
UX: a "New from template" picker organized into a few department-curated categories, not an open marketplace; instantiating pre-fills structure, not content.
Why it matters: the single highest-leverage anti-overwhelm device in the product — see "Feature depth vs. overwhelm" below.
Evidence: [Trello — Templates](https://trello.com/templates)

**Automations (5 triggers max)** — *Complexity: M · Phase: 2*
What it does: a small, closed set of "when X happens, do Y" rules turned on per project — capped at five trigger types (status change, due date reached, assignment, checklist completed, created from template) rather than an open rule builder.
UX: fill-in-the-blank sentence toggles ("When a task moves to *Done*, notify *the requester*"), never a flowchart canvas; reversible from the same screen, no separate "automation admin" area.
Why it matters: Trello's Butler is loved because it hides an if-this-then-that engine behind plain sentences and per-board opt-in — capping the trigger set even further protects us from the "automation graveyard" every power-tool eventually accumulates.
Evidence: [Trello — Butler automation](https://trello.com/butler)

**Saved views** — *Complexity: M · Phase: 2*
What it does: a named, shareable filter+sort+group combination on top of a project's or the whole workspace's tasks.
UX: build a filter once ("assigned to me, priority ≥ High, due this week"), click "Save as view," and it appears as a tab or sidebar shortcut for anyone with access to reuse — no query language exposed.
Why it matters: turns one-off "can you pull me a list of..." requests into a link the director can bookmark and revisit every Monday.
Evidence: [Linear — Custom views](https://linear.app/docs)

**Personal "My work"** — *Complexity: M · Phase: 1*
What it does: a single cross-project page showing everything assigned to the logged-in user, regardless of which project or sub-department it lives in.
UX: default landing page after login; grouped by "Overdue / Today / This week / Later," each item deep-links back to its project context so the user never loses the bigger picture.
Why it matters: a specialist working across three concurrent initiatives should never have to remember which project to open — this is the page that makes the whole tool feel personal rather than departmental.
Evidence: [Asana — My Tasks](https://asana.com/guide/help/fundamentals/my-tasks)

**"Waiting on"** — *Complexity: M · Phase: 2*
What it does: a status/filtered view surfacing tasks blocked on *someone else's* action, distinct from "in progress" or "blocked by another task."
UX: setting a task to "Waiting on" prompts for who/what it's waiting on, and surfaces it in both the requester's "waiting on" view and that person's "requested of me" list.
Why it matters: not a named vendor feature so much as a convention that recurs informally as an extra kanban column across Trello and Notion templates — making it first-class turns "I'm stuck waiting on Legal" from a verbal complaint into a visible, ageable queue.
Evidence: [Notion — Templates (kanban patterns)](https://www.notion.com/templates)

**Delegation** — *Complexity: M · Phase: 2*
What it does: reassigns a task while preserving its history, comments and watchers — distinct from a plain assignee edit because it can delegate a *decision*, not just the doing.
UX: "Delegate" opens a picker with an optional note; the original owner is auto-added as a watcher rather than dropped from the task.
Why it matters: heads of sub-department genuinely delegate authority, not just labour, when travelling or on leave — the tool should model that handoff explicitly instead of silently reassigning and losing the "who decided this" trail.
Evidence: [Basecamp — Features](https://basecamp.com/features)

---

## Module 2 — Team management

Directory, org chart, availability and leave/trip balances are covered in depth in `hr-people-ops-features.md` (Phase 1, must-have); this section covers the remaining eleven items with only a cross-reference for the four overlapping ones.

**Directory** *(see `hr-people-ops-features.md`)* — evidence: [HiBob](https://www.hibob.com/)

**Org chart** *(see `hr-people-ops-features.md`)* — evidence: [HiBob](https://www.hibob.com/)

**Availability / out-of-office** *(see `hr-people-ops-features.md` for the leave-calendar half; the status-badge half is new here)* — *Complexity: L · Phase: 1*
What it does: a lightweight presence signal (in office / remote / on leave / in a meeting) shown next to a person's name everywhere they appear, separate from the formal leave-approval workflow.
UX: a small coloured dot plus a one-line reason, settable from the person's own profile in two taps, auto-set to "on leave" the moment an approved leave request's dates begin.
Why it matters: answers "can I ask them right now" before someone sends a message into the void — cheap to build, high daily-use value.
Evidence: [Basecamp — Features](https://basecamp.com/features)

**Leave/trip requests with balances** *(fully specified in `hr-people-ops-features.md`)* — evidence: [Personio](https://www.personio.com/)

**Capacity / workload** — *Complexity: H · Phase: 3*
What it does: shows how many active tasks each person carries against a configured capacity, so a manager can see overload before assigning more.
UX: a horizontal bar per person, green-to-red as work exceeds capacity, computed from existing task assignments — no separate time-estimate entry.
Why it matters: the director's actual complaint is "who's overloaded across fourteen active projects" — this should derive from data we already have, not a hand-maintained module.
Evidence: [Asana — Workload](https://asana.com/features/workload)

**1:1 notes with a private space** — *Complexity: M · Phase: 2*
What it does: a running, shared agenda between a manager and one report, plus a strictly private notes area only the manager can see.
UX: both sides add talking points async before the meeting and view the same shared page live; the private section is a visually distinct panel, never exported into shared history, and its existence is disclosed to the employee — no hidden surveillance.
Why it matters: "humane" positioning depends on 1:1s feeling like a real conversation, not a review paper trail — Lattice's own customer language ("not just a place for status updates") is the bar to clear.
Evidence: [Lattice — One-on-ones](https://lattice.com/one-on-ones)

**Goals (unit-level)** — *Complexity: M · Phase: 2*
What it does: a few dated objectives per sub-department, linkable to the projects/tasks that ladder up to them, with an on-track/at-risk/off-track status.
UX: a progress bar computed from linked project completion where possible, plus a monthly one-line status update — not a company-wide OKR cascade with quarterly check-ins per individual.
Why it matters: `portfolio-pm-analytics-dashboards.md` and `hr-people-ops-features.md` both note our own quarterly-objectives bars already do most of this — reinforce that pattern, don't build a parallel one.
Evidence: [Asana — Goals](https://asana.com/product/goals)

**Skills matrix** — *Complexity: M · Phase: 3*
What it does: a small, self-maintained tag list per person ("data analysis," "E-Imzo integration," "English drafting") searchable when staffing a new task.
UX: employees add their own tags from a curated list (not a manager-scored rating grid), shown as profile chips and searchable via "who knows X."
Why it matters: useful when a cross-department initiative needs a specific skill, but must stay a lightweight tag list — a scored competency matrix reads as performance management and will be resisted at this scale.
Evidence: [Personio](https://www.personio.com/)

**Working hours** — *Complexity: L · Phase: 2*
What it does: each person sets their typical working window; the tool softens notification timing around it rather than policing attendance.
UX: set once in profile settings; a mention sent outside someone's hours shows the sender a "will see this tomorrow" note instead of an urgent badge.
Why it matters: the opposite of a monitoring feature — protects the "humane" positioning directly and doubles as a signal for cross-timezone or part-time arrangements.
Evidence: [Slack — Working hours](https://slack.com/help/articles/360059885394-Set-up-Slack-for-work-hours)

**Birthdays & anniversaries** — *Complexity: L · Phase: 1*
What it does: a quiet, passive surface noting today's or this week's birthdays and work anniversaries.
UX: no popup, no forced acknowledgment — just "Today: Malika's birthday 🎂 · 3 years since Bekzod joined," act on it or ignore it.
Why it matters: per `hr-people-ops-features.md`, near-zero build cost, consistently goodwill-positive, sets the tone of a tool built by people who like their colleagues.
Evidence: [Donut — Shoutouts](https://www.donut.com/)

**Kudos attached to work** — *Complexity: M · Phase: 2*
What it does: a recognition action attached to a specific task or comment, not a free-floating "give kudos" button with no context.
UX: a "🎉 nice work" action on a completed task, optionally tagging a department value, posting to a low-key shared feed — no points, no redemption catalogue in Phase 1–2.
Why it matters: both `hr-people-ops-features.md` and this report's vendor evidence agree recognition atrophies without a natural trigger — task completion is that trigger; a standalone kudos app is not.
Evidence: [Lattice — Praise](https://lattice.com/praise)

---

## Module 3 — Onboarding

**Newcomer plan templates (day 1 / week 1 / 30-60-90)** — *Complexity: M · Phase: 2*
What it does: a pre-built page structure the manager instantiates on hire, with sections timed to day one, week one, and 30/60/90 days.
UX: instantiated from the same "New from template" picker as any project template; each section is a short checklist plus a couple of free-text prompts, not a blank document.
Why it matters: turns "someone should write an onboarding plan" into a two-click default — the difference between it existing and not in a department where nobody has time to author one from scratch.
Evidence: [Notion — Templates](https://www.notion.com/templates)

**Tasks for newcomer + manager + HR + buddy** — *Complexity: M · Phase: 2*
What it does: the onboarding template auto-generates separate task lists per role, all linked to one onboarding record.
UX: each role sees only its own checklist by default, plus a shared manager progress view of all four; "issue building pass" is HR's, "introduce to the mandate" is the manager's — neither list requires reading the other.
Why it matters: mirrors BambooHR's cross-role checklist pattern (documented in `hr-people-ops-features.md`) and prevents onboarding becoming "the manager's job" while the IT/HR half quietly never happens.
Evidence: [HiBob](https://www.hibob.com/)

**Buddy pairing** — *Complexity: M · Phase: 2*
What it does: assigns a peer (not the manager) as an informal go-to contact for a new hire's first weeks, with a light suggested-meeting cadence.
UX: manager picks a buddy from a short suggested list when instantiating the template; the buddy gets a three-item checklist ("say hi before day 1," "lunch in week 1," "check in at week 4"), not open-ended responsibility.
Why it matters: Donut's whole product rests on "who do I ask when I don't want to bother my manager" being a real first-week anxiety — a named buddy answers it without Donut's AI-matching infrastructure.
Evidence: [Donut](https://www.donut.com/)

**"How we work" pages** — *Complexity: L · Phase: 1*
What it does: durable reference pages (communication norms, meeting etiquette, how decisions get made) distinct from any project's documentation.
UX: pinned in a permanent "Team home" section, not buried in a wiki tree; written once, revised occasionally.
Why it matters: the page every newcomer actually reads in week one and every existing employee occasionally forgets — cheap to build, backbone of the onboarding step.
Evidence: [Notion — Team home templates](https://www.notion.com/templates)

**Reading list** — *Complexity: L · Phase: 2*
What it does: a short, curated list of documents a newcomer should read in their first weeks, distinct from a full document library.
UX: a checklist page of 5–10 items each with a one-line "why this matters" note; checking off is optional, not a compliance gate.
Why it matters: prevents institutional knowledge (past EGDI reports, methodology notes) from being invisible or dumped as an unnavigable folder.
Evidence: [Notion — Templates](https://www.notion.com/templates)

**Intro meetings** — *Complexity: L · Phase: 2*
What it does: a suggested set of short intro calls between a newcomer and people outside their immediate team, generated from the onboarding template.
UX: a short list of suggested names ("meet the Legal lead") with a one-click "propose a time" that opens the date-poll feature (Module 4).
Why it matters: cross-sub-department awareness is exactly what a small department needs and exactly what fails to happen without a nudge.
Evidence: [Donut](https://www.donut.com/)

**Equipment / access checklist** — *Complexity: M · Phase: 1*
What it does: a fixed checklist of accounts, hardware and physical access a new hire needs, owned by IT/HR, tracked before/on day one.
UX: a task list with due dates relative to start date, visible to the manager as a single "ready or not" indicator instead of an email chase.
Why it matters: the one onboarding item with a hard compliance/security dimension (restricted-data access per role, per `hr-people-ops-features.md`'s privacy tiers) and most often silently late in practice.
Evidence: [HiBob](https://www.hibob.com/)

**Progress dashboard** — *Complexity: M · Phase: 2*
What it does: one view for HR and managers showing every active onboarding's completion across all four role-checklists.
UX: one row per new hire, four progress bars, red-flagging anything untouched past its due offset — no per-person deep-dive unless something's stalled.
Why it matters: HR onboards a handful of people a year; the value is catching the one checklist item that silently never got done, not analytics.
Evidence: [HiBob](https://www.hibob.com/)

**Feedback at 30/60/90** — *Complexity: M · Phase: 2*
What it does: three short check-in prompts (not a review) at 30/60/90 days, feeding into — not replacing — the private 1:1 space.
UX: a 3–4 question async form triggered from the template's dates, discussed live at the next 1:1 rather than filed and forgotten.
Why it matters: catches early friction while cheap to fix, and stays separate from Uzbekistan's statutory *attestatsiya*, which `hr-people-ops-features.md` insists must remain a distinct compliance record.
Evidence: [15Five](https://www.15five.com/)

**Offboarding mirror** — *Complexity: M · Phase: 2*
What it does: the same four-role checklist run in reverse when someone leaves: access revocation, task/project reassignment, exit note, knowledge handoff.
UX: triggered by HR marking an end date; auto-generates a checklist including "reassign owned projects" as a hard, visible step.
Why it matters: HiBob's own language — "automate onboarding, reviews, and offboarding in one flow" — and the reassignment step protects the Projects register's "single accountable owner" rule established elsewhere in this directory.
Evidence: [HiBob](https://www.hibob.com/)

---

## Module 4 — Team building & culture

**Events (RSVP, capacity, budget, checklist, photos, feedback)** — *Complexity: H · Phase: 3*
What it does: one event object bundling attendee sign-up with a capacity cap, an optional budget line, an organizer checklist, a post-event photo album and a feedback prompt.
UX: creating an event is a template instantiation — title, date, capacity, budget — after which the page is the RSVP surface for everyone; capacity reached shows a waitlist; photos/feedback unlock only after the date passes.
Why it matters: today this is a scattered Telegram poll, a paper sign-up and a separate expense form — bundling it means the department keeps a record of what it did together, useful for morale and for justifying next year's budget.
Evidence: [Confetti — team events](https://www.confetti.events/)

**Date polls** — *Complexity: L · Phase: 1*
What it does: a shareable poll of candidate times for a meeting or event; participants vote without an account, results converge to the best-fit slot.
UX: creator proposes 3–5 slots, shares a link, each recipient marks Yes/Maybe/No with time zones handled automatically — no email chain.
Why it matters: the cheapest, most immediately useful feature in this module — Rallly's open-source implementation proves it needs almost no complexity to be genuinely good.
Evidence: [Rallly](https://rallly.co/) · [Doodle](https://doodle.com/)

**Icebreakers** — *Complexity: M · Phase: 3*
What it does: an optional short prompt attached to a recurring meeting or event to open with something other than the agenda.
UX: a rotating prompt bank, one auto-suggested per meeting, skippable with one click — never mandatory, never scored.
Why it matters: low cost, and directly useful for Module 3's cross-department intro meetings as well as regular team meetings.
Evidence: [Gatheround](https://gatheround.com/)

**Retro boards** — *Complexity: M · Phase: 3*
What it does: a structured board (Went well / Didn't go well / Action items) for a team to reflect after a project phase, with optional anonymity, grouping and voting.
UX: cards added privately first, revealed together, dragged into groups, voted on to prioritize discussion — the session ends by converting the top items straight into Module 1 tasks.
Why it matters: "what did we learn from this ranking cycle" retrospectives are genuinely useful here; converting outcomes into tracked tasks rather than a forgotten slide is the one design choice worth copying exactly from Parabol.
Evidence: [Retrium](https://www.retrium.com/) · [EasyRetro](https://easyretro.io/) · [Parabol](https://www.parabol.co/)

**Recognition** *(cross-reference: "Kudos attached to work" in Module 2)* — evidence: [Bonusly](https://bonusly.com/)

**Team traditions calendar** — *Complexity: L · Phase: 3*
What it does: a shared calendar of recurring rituals (monthly lunch, quarterly futsal, Nowruz gathering) distinct from deadlines and leave.
UX: a filtered, recurring-events view tagged "tradition," shown on the home screen but visually distinct from project deadlines.
Why it matters: makes culture events a first-class recurring part of departmental life, not one-off entries recreated and forgotten each year.
Evidence: [Donut](https://www.donut.com/)

**Volunteering** — *Complexity: M · Phase: "avoid for now"*
What it does elsewhere (mainly large US corporate CSR platforms like Benevity, outside this report's brief): tracks volunteer hours/events tied to a giving program.
Why it matters here: none of the fourteen products studied — Notion, Trello, Jira WM, Asana, Linear, Height, Basecamp, Donut, Lattice, 15Five, Retrium/EasyRetro/Parabol, Rallly/Doodle, Confetti/Gatheround, Bonusly, HiBob/Personio, Viva Insights — has this feature; a genuine category gap, not an oversight. Represent a volunteering day as an ordinary Event with a label instead of inventing new structures for a handful of yearly occurrences.
Evidence: none found — see Open Questions.

**Sports leagues (department futsal!)** — *Complexity: M · Phase: "avoid for now"*
What it does, in principle: a running schedule/bracket and standings for a recurring department sport.
Why it matters here: same conclusion as volunteering — no studied vendor has this natively. Build it from a recurring Event per match, a checklist for who's playing, and a Notion-style database view (`notion-model-and-block-editors.md`) for standings, rather than a bespoke league feature.
Evidence: none found — see Open Questions.

**Family days** *(cross-reference: "Events")* — evidence: [Confetti](https://www.confetti.events/)

---

## Module 5 — Insights for heads and directors, without surveillance

The clearest, best-evidenced pattern in this whole research pass comes from Microsoft Viva Insights, precisely because Microsoft has faced enough "bossware" backlash to have engineered the privacy boundary explicitly rather than as an afterthought. Two structural choices are worth copying directly:

**What to show.** Individual-level *wellbeing* signals (focus time, meeting load, after-hours activity) should be visible **only to the individual themselves** — never to their manager, in any form that could be reverse-engineered at our scale. Manager/director views should show only **team-level aggregates** (collaboration load, capacity per Module 2's Workload view) with a hard minimum group size before a number appears — Viva Insights names this explicitly: built-in "aggregation and differential privacy," and the ability for "individuals [to] opt out." At 23 people split across four sub-departments (5–6 each, per `hr-people-ops-features.md`), that minimum-group-size rule is not optional — a sub-department number is frequently a de-anonymized individual one.

**What to refuse.** No feature here should expose: individual login/active-hours timestamps to a manager; per-person "productivity scores"; comment read receipts visible to anyone but the sender; or any leaderboard ranking individuals by output. These generate resentment in every mid-market tool's review complaints (a pattern `hr-people-ops-features.md` documents for HRIS bloat generally) and Uzbekistan's own reference brief already implicitly rejects them by asking for a "humane" tool. The one acceptable director view is the aggregate already implied by Modules 1–2: active projects and overdue tasks per sub-department, capacity bars visible *only to that person's own manager*, and the "waiting on" queue so blockers show without anyone being watched.

Evidence: [Microsoft Viva Insights](https://www.microsoft.com/en-us/microsoft-viva/insights)

---

## Feature depth vs. overwhelm

Every mature product in this category solved the same problem — powerful for the director, simple for the newcomer — with a different mechanism, and all three are worth stealing:

**Linear: everything is a shortcut, nothing is a menu.** Almost every action (assign, label, prioritize, move status, open triage) binds to a one- or two-key shortcut reachable from a universal command palette; visual chrome stays minimal because power users never touch it. The lesson is architectural: our own `Ctrl/⌘+K` palette should be the *primary* way advanced users do anything, so the visible UI stays uncluttered for a first-time civil servant who will never learn the shortcuts and does not need to.

**Trello: power stays opt-in, per board.** Butler and Power-Ups are off by default and enabled per-board by whoever owns that board, not globally. A new employee's first board is plain kanban, none of a veteran's automation complexity. This maps directly onto this report's "5 triggers max" design: automations are a per-project opt-in a head of sub-department turns on deliberately, never a department-wide default.

**Notion: depth hides inside templates, not settings.** Notion's block/database/formula model is close to a full programming environment, but most users never see that complexity because the 30,000-plus template gallery lets them start from a finished shape and only ever edit content, never structure. Our own Templates feature is built on the same principle: depth lives inside the template author's work; the end user experiences only "fill in this form-shaped thing" — matching `zero-training-ux-and-onboarding.md`.

The throughline: **hide depth behind an opt-in surface — a shortcut, a per-board toggle, a template — never behind a settings screen everyone must eventually open.** That settings screen is where every one of these products' bloat complaints originate.

---

## What this means for us

1. **[ADOPT]** Ship "My work" as the default post-login landing page — Asana's cross-project personal view is the highest-confidence pattern for making a multi-project tool feel personal, not departmental.
2. **[ADOPT]** Cap Automations at five trigger types, fill-in-the-blank sentences, opt-in per project — Trello Butler's opt-in model plus a tighter cap protects against the automation-graveyard failure every more-open rule builder eventually suffers.
3. **[ADOPT]** Build Templates as the primary anti-overwhelm mechanism across all five modules — Notion's gallery proves depth can live entirely inside a template author's structure while end users only fill in content.
4. **[ADOPT]** Make the command palette (`Ctrl/⌘+K`) the home for every advanced action (assign, label, delegate, "waiting on") so visible chrome stays thin — copied from Linear's "everything is a shortcut" philosophy.
5. **[ADOPT]** Convert 30/60/90 onboarding feedback and retro-board outcomes directly into tasks at the point of capture, not a filed document — Parabol's "create takeaway tasks directly" pattern is what keeps reflection from being ignored.
6. **[ADOPT]** Attach kudos to the task-completion moment, not a standalone button — every vendor and our own prior HR research agree recognition atrophies without a pre-existing trigger to ride.
7. **[ADAPT]** Build Capacity/workload as a derived view over existing task assignments, never a separately maintained time-estimate system — Asana's Workload view works because it reuses data that already exists.
8. **[ADAPT]** Build Goals as a thin layer over the existing quarterly-objectives progress bars already validated by `hr-people-ops-features.md` and `portfolio-pm-analytics-dashboards.md`, not a parallel Asana/Lattice-style OKR module.
9. **[ADAPT]** Buddy pairing as a manual, three-item checklist the manager assigns, not Donut's AI-matching engine — the matching problem Donut solves (thousands of employees) does not exist at 23 people.
10. **[ADAPT]** Date polls as a genuinely minimal Rallly-style feature — no account required to vote, time zones handled automatically — shipped early since it is nearly free to build and useful for both onboarding and events.
11. **[ADAPT]** "Waiting on" as a first-class status/queue rather than an informal kanban column — no vendor studied names it, but formalizing it turns a verbal complaint into an ageable, visible queue.
12. **[AVOID]** A dedicated Volunteering module or sports-league/bracket feature — no vendor among the fourteen studied has either; build both from Events + recurring-task primitives instead of new data structures for a handful of yearly occurrences.
13. **[AVOID]** Points-and-redemption recognition (Bonusly's rewards catalogue) — adds a finance/procurement dependency disproportionate to 23 people; a visible, values-tagged "nice work" is enough without the redemption machinery.
14. **[AVOID]** Any director-facing individual productivity score, activity timestamp, or leaderboard — Viva Insights is explicit that mature tools engineer against exactly this; our "humane" positioning should refuse it outright, not just de-prioritize it.
15. **[AVOID]** A Timeline/Gantt view as anyone's default — useful for the rare multi-month initiative, unnecessary and intimidating as the everyday surface; one click away from board/list, never the landing view.

---

## Open questions

- **Volunteering and sports leagues have no vendor precedent among the fourteen products studied.** Is department futsal common enough across other ministry departments to justify even the lightweight Events+labels treatment above, or is this single-department preference? Needs a direct answer from the department, not more vendor research — no comparable product has solved this because no comparable market (a ministry buying team-culture software) exists for it.
- **Notion's specific onboarding/team-home/OKR template pages returned 404 on fetch** (client-side routing, most likely). Descriptions above rely on documented general knowledge of Notion's well-known template categories rather than a freshly fetched page; worth a manual browser check before treating any Notion-specific UX detail as verified.
- **Trello's Butler and template-gallery pages could not be rendered by an automated fetch** (JS-heavy SPA) — the "5 triggers max" recommendation is this report's own synthesis of Butler's known opt-in philosophy, not a fetched feature list; validate against a live Trello board before finalizing the automation spec.
- **Height and Personio returned connection errors/HTTP 429 on every attempt** this session — Height's "autopilot" angle and Personio's onboarding specifics are under-verified and would benefit from a follow-up fetch pass.
- **Whether "kudos attached to work" needs anti-gaming design** (self-kudos, a manager's kudos reading as compulsory) was not addressed by any vendor's documentation — a design question for `wp-designer`, not visible in marketing pages.
- **Working-hours-aware notification softening** needs a decision on whether it applies to Telegram too (per `notifications-telegram-mobile.md`'s quiet-hours findings) — likely the same underlying mechanism, not two separately configured settings.

---

## Sources

- [Asana — Goals](https://asana.com/product/goals)
- [Asana — Workload](https://asana.com/features/workload)
- [Asana — Timeline](https://asana.com/features/timeline)
- [Asana — Lists](https://asana.com/features/lists)
- [Asana — My Tasks](https://asana.com/guide/help/fundamentals/my-tasks)
- [Asana — Milestones](https://asana.com/guide/help/projects/milestones)
- [Asana — Dependencies](https://asana.com/guide/help/tasks/dependencies)
- [Asana — Recurring tasks](https://asana.com/guide/help/tasks/recurring-tasks)
- [Asana — Followers](https://asana.com/guide/help/fundamentals/followers)
- [Atlassian — Jira Work Management](https://www.atlassian.com/software/jira/work-management)
- [Linear — Docs: Issues](https://linear.app/docs/issues)
- [Linear — Docs: Projects](https://linear.app/docs/projects)
- [Linear — Docs: Triage](https://linear.app/docs/triage)
- [Linear — Docs: Labels](https://linear.app/docs/labels)
- [Linear — Docs: Comments](https://linear.app/docs/comments)
- [Linear Method — Cycles](https://linear.app/method/cycles)
- [Trello — Features](https://trello.com/features)
- [Trello — Templates](https://trello.com/templates)
- [Trello — Butler automation](https://trello.com/butler)
- [Trello — Attachments (support)](https://support.atlassian.com/trello/docs/adding-attachments-to-a-card/)
- [Height](https://height.app/) — fetch failed (connection error), described from documented product knowledge
- [Basecamp — Shape Up, Hill Charts](https://basecamp.com/shapeup/3.4-chapter-12)
- [Basecamp — Features](https://basecamp.com/features)
- [Donut](https://www.donut.com/)
- [Lattice — One-on-ones](https://lattice.com/one-on-ones)
- [Lattice — Praise](https://lattice.com/praise)
- [15Five](https://www.15five.com/)
- [Retrium](https://www.retrium.com/)
- [EasyRetro](https://easyretro.io/)
- [Parabol](https://www.parabol.co/)
- [Rallly](https://rallly.co/)
- [Doodle](https://doodle.com/)
- [Bonusly](https://bonusly.com/)
- [HiBob](https://www.hibob.com/)
- [Personio](https://www.personio.com/) — fetch failed (HTTP 429), described from documented product knowledge
- [Confetti — team events](https://www.confetti.events/) — fetch inconclusive, described from documented product knowledge
- [Gatheround](https://gatheround.com/) (formerly Icebreaker.video)
- [Microsoft Viva Insights](https://www.microsoft.com/en-us/microsoft-viva/insights)
- [Notion — Templates](https://www.notion.com/templates)
- [Slack — Working hours help centre](https://slack.com/help/articles/360059885394-Set-up-Slack-for-work-hours)

*Cross-referenced internal reports: `hr-people-ops-features.md`, `work-management-landscape.md`, `zero-training-ux-and-onboarding.md`, `notion-model-and-block-editors.md`, `portfolio-pm-analytics-dashboards.md`, `notifications-telegram-mobile.md`.*
