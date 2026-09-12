# ClickUp research — what Devon should steal, adapt and refuse (v1.1 input)

2026-09-12. Research document, not a contract. Nothing here enters scope until it is filed as
`proposed` in `docs/03-plan/backlog.json` (CLAUDE.md, "Do not add scope mid-epic"). Binding
documents win every disagreement: `docs/03-plan/TECH-SPEC.md`, `docs/03-plan/FEATURE-PLAN.md`,
`DESIGN.md`, `agentic/INVARIANTS.md`.

**Method.** `help.clickup.com` refuses plain fetches (HTTP 403), so the help centre was read through
the Playwright MCP against its public Zendesk article API (`/api/v2/help_center/en-us/articles.json`,
1 174 articles, 12 pages) and the article bodies rendered to text. Marketing pages
(`clickup.com/features`, `/features/views`, `/features/dashboards`, `/features/custom-fields`) were
read with WebFetch. Every claim below carries the article URL it came from; §13 is the full list.
Devon claims carry a repo path. No ClickUp account was created and no ClickUp screenshots were taken
(that needs a login); Devon's current state is cited as the tracked evidence PNGs under
`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/final/`.

**Two renames worth knowing before reading.** The brief asks about "LineUp" and the "Multitask
toolbar". ClickUp has renamed both, and the new names are themselves the finding:

- **LineUp → Personal Priorities.** "Personal Priorities (formerly LineUp) helps you stay on top of
  your most important work, and lets your team know what you're working on."
  ([help](https://help.clickup.com/hc/en-us/articles/32481768821527-What-are-Personal-Priorities))
  It survives as a *card* on My Tasks and as a strip in the lower-left corner of the workspace.
- **Multitask Toolbar → Bulk Action Toolbar.** "The Bulk Action Toolbar used to be called the
  Multitask Toolbar."
  ([help](https://help.clickup.com/hc/en-us/articles/6309768265495-Manage-tasks-with-the-Bulk-Action-Toolbar))

Both renames move from a ClickUp-invented noun to a plain description of the job. That is the same
rule `DESIGN.md` §5 already gives us for copy, and it is the reason neither feature should arrive in
Devon under a brand name.

---

## 1. The shape of ClickUp, and why it does not transfer wholesale

ClickUp's power comes from one structure and one switchboard:

- **Hierarchy**: Workspace → Space → Folder/Subfolder → List → task → subtask. Almost everything
  (statuses, Custom Fields, Automations, views) can be attached at any level and is inherited
  downward. "Custom Fields can be added to Spaces, Folders, Subfolders, Lists, or your entire
  Workspace." ([Intro to Custom Fields](https://help.clickup.com/hc/en-us/articles/6303536766231-Intro-to-Custom-Fields))
- **ClickApps**: per-workspace or per-Space feature toggles — Custom Fields, Priorities, Tags, Time
  Estimates, Time Tracking, Sprints, Sprint Points, Dependency Warning, Multiple Assignees, Work in
  Progress Limits and more. Only owners and admins can toggle them.
  ([Intro to ClickApps](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps))

Devon has no Hierarchy: one department, bo'limlar as colour groups (`packages/db/src/schema/structure.ts`
— `units`, `unitRoles`), cards owned by one person, projects as a flat set
(`packages/db/src/schema/projects.ts`). **Every "attach at any level, inherit downward" mechanic in
ClickUp collapses in Devon to "department-level, one place, done."** That is a simplification, not a
loss: it removes the single largest source of ClickUp's configuration debt, and it means a Devon
field/view/goal needs exactly one scope (`department_id`) and one RLS policy (I-1).

The ClickApps idea, on the other hand, transfers almost perfectly — see §12.

---

## 2. Custom Fields

**What it is.** Typed fields added to tasks. The type list
([Custom Field types](https://help.clickup.com/hc/en-us/articles/6303499162647-Custom-Field-types)):
Button, Checkbox, Date, Dropdown (≤500 options, colours, default, ordering), Email, Files, Formula,
Labels (≤500 options, multi-select), Location, Money, Number, People (with "show people from my
entire Workspace", multi-select, teams), Phone, Progress (Auto) — computed from subtasks/checklists/
assigned comments, Progress (Manual), Rating, Relationships, Rollup, Signature, Text (2 048 chars),
Text area / Long Text (50 000 chars, rich text). Fields can be **required**, given **defaults**,
**pinned**, and given **per-field permissions**. A **Custom Field Manager** lists every field in the
workspace with columns for creator, date, locations, inherited-from, visibility, pinned,
required-in-tasks, visible-to-guests, and offers merge/move/convert
([manager](https://help.clickup.com/hc/en-us/articles/13066263096727-Intro-to-Custom-Field-Manager)).
Fields drive **search, sort, filter and grouping** — including a hover "quick-filter by this value"
in List view
([search/sort/filter](https://help.clickup.com/hc/en-us/articles/12665650881943-Search-sort-and-filter-tasks-by-Custom-Fields)).
**Formula Fields** calculate over numeric, date and time fields, can reference other formulas one
level deep, and cannot be sorted/filtered/grouped when they use `TODAY()`
([Intro to Formula Fields](https://help.clickup.com/hc/en-us/articles/6308656424983-Intro-to-Formula-Fields)).
**Custom Fields by task type** let a "Bug" and a "Vendor" in the same List carry different fields
([by task type](https://help.clickup.com/hc/en-us/articles/30976239926167-Intro-to-Custom-Fields-by-task-type)).

**Why users love it (Jakob's Law).** This is the Airtable/Notion database mental model, which office
staff now meet before they meet a project tool: *a row is a thing, a column is a property, the
property has a type, and the type decides the editor, the filter widget and the chart axis.* Nobody
needs it explained. The payoff people feel is that one act of typing data ("deadline reason:
ministry order") immediately becomes a filter chip, a table column, a group-by and a chart series
without any further configuration.

**Devon verdict: ADOPT, narrowed — and extend it to people, which ClickUp only half-does.**
This is the highest-leverage item in the whole report, because Devon's filter grammar
(`packages/contracts/src/filter-grammar.ts` — today only `assignee`, `giver`, `due`, `label`,
`project`, `status`, `text`), its table (`apps/web/src/features/work/components/table-screen.tsx`,
whose columns are a hard-coded `GRID_COLUMNS = '40px minmax(300px,1fr) 180px 120px 260px 140px'`) and
its analytics (`apps/web/src/features/analytics/`) all become extensible from one addition.

Narrowings, each with a reason:
- **Types: text, long text, number, date, select (single), multi-select, person, url, checkbox, and
  one formula-lite.** Refuse Money (a ministry department tracks no budget in Devon), Location and
  Map (no Map view, and addresses collide with I-2), Files (attachments already exist on cards),
  Signature (an approval ceremony we do not have), Rating (one step from a per-person score, which
  `FEATURE-PLAN.md` refuses), Button (that is an Automations trigger, EPIC-017), Relationships/Rollup
  (needs a relation graph Devon does not have; the one relation worth having is Dependencies, §6).
- **Formula-lite, not formulas.** Ship a fixed, translated menu of derivations — `days_between(a,b)`,
  `a - b`, `a + b`, `a / b`, `percent(a, b)` over number/date fields — not a function language.
  ClickUp's own limits document why: no text fields, `TODAY()` breaks sorting/filtering/grouping, one
  level of nesting, and "Formula Fields are not compatible with templates." A menu has none of those
  sharp edges, needs no formula parser in the gate, and is translatable into four locales, which an
  English function name is not (I-9).
- **One scope: the department.** No per-unit or per-project field sets in v1.1. A field applies to
  every card; `applies_to` distinguishes cards from people.
- **Keep: required, default value, option colours, per-field description, archive-don't-delete.**
  These are the four things that make a field survive contact with 30 people, and they are cheap.

---

## 3. Views

### 3.1 The catalogue

ClickUp names 15+ view types ([Intro to views](https://help.clickup.com/hc/en-us/articles/6329880717719-Intro-to-views)):
List, Board, Calendar, Team, Gantt, Activity, Timeline, Workload, Mind Map, Table, Map, Dashboard,
Whiteboard, Chat, Doc, Embed, Form, plus an "Artifact" view. Every Space/Folder/List gets a List and
Board view by default; views live in a **Views Bar**, can be **pinned**, **grouped**, favourited, set
as default, made **private**, and shared publicly or by link.

**Devon has five of these already**, as routes under `/work`
(`apps/web/src/features/work/manifest.tsx`): `/work` (people board), `/work/table`,
`/work/timeline`, `/work/calendar`, `/work/mine`, plus `/work/archive` and `/work/card`. The
`saved_views` table (`packages/db/src/schema/work.ts`) already encodes exactly this idea —
`layout` enum `people_board | table | timeline | calendar | mine`, a `filter` string, a `shared`
boolean and an `owner_user_id`. Devon's Views Bar is missing, not its data model.

| ClickUp view | Devon verdict |
|---|---|
| List | **Skip as a separate view.** Devon's people board *is* the list, grouped by person. A second ungrouped list would be the table view with fewer features. |
| Board | **Have it**, and better suited: Devon's column is a person, not a status — the department's actual question is "who is carrying what", not "what stage is it in". |
| Table | **Adopt properly** (§3.2) — this is where Custom Fields cash out. |
| Calendar | **Have it.** Adopt ClickUp's two missing conventions: *Today* button + arrows + day/week/month segmented control, and drag-to-reschedule ([Calendar](https://help.clickup.com/hc/en-us/articles/6310085740183-Intro-to-Calendar-view)). `DESIGN.md` §8 already promises Google-Calendar conventions here. |
| Gantt / Timeline | **Have Timeline** (`/work/timeline`). Adopt from Gantt only two things: the **today line** and **drag the bar ends to change start/due**. Refuse the Gantt sidebar-hierarchy, baselines, critical path, PDF export. |
| Workload | **Adopt** (§3.3) — the single most valuable new view for a boshqarma boshlig'i. |
| Team / Box | Skip — a per-person board is already the Team view. |
| Everything | **Skip, by architecture.** "Everything" is ClickUp's cross-Space level; Devon's department *is* the everything level, and crossing a department boundary is forbidden (I-8a). |
| Me mode | **Adopt as a mode, not a route** (§9). |
| Activity | Skip as a view; Devon has a per-card activity timeline (`card-detail.tsx`) and an audit log for the real "what happened" question. |
| Map, Mind Map, Form, Embed, Chat, Doc, Whiteboard, Dashboard-as-view | Skip. Chat is refused outright (`FEATURE-PLAN.md`); Doc is `/pages`; Whiteboard is the private canvas in `/personal`; Map needs the Location field we refused; Form is a public intake surface a closed department does not need. |

### 3.2 Table view and saved views

**What it is.** "Every task is a row with a fixed height, and the fields are columns"; add/remove
columns including creating a new Custom Field inline; **pin a column** so it survives horizontal
scroll; row height; show/hide subtasks; click-to-edit cells; copy/paste to Excel with or without
headers; **drag the corner of a cell to fill down**; bulk edit via the toolbar
([Table view](https://help.clickup.com/hc/en-us/articles/6329890854935-Create-and-share-a-Table-view)).
**Column calculations** at the foot of any column: Count / Count values / Count unique / Count empty,
Percent empty / not empty, Earliest / Latest / Range for dates, and Sum / Average / Range / Min / Max
/ Median for numbers — per group *and* for the whole column
([Calculate columns](https://help.clickup.com/hc/en-us/articles/6310124537751-Calculate-columns-in-List-and-Table-view)).
**Saved filters** come in two flavours: *personal* (only you) and *Workspace* (everyone, editable by
everyone), optionally saving the sort with the filter
([Saving view filters](https://help.clickup.com/hc/en-us/articles/6311659064983-Saving-view-filters)).
Changing a view raises a "Save the view / Autosave view" prompt in the lower-right
([List view](https://help.clickup.com/hc/en-us/articles/6310260883351-Intro-to-List-view)).

**Why users love it.** It is Excel with referential integrity. The three specific delights are
*fill-down* (an Excel muscle memory that works), *column calculations* (the answer appears under the
column you were already looking at, with no chart to configure), and *the view remembers itself*.
The personal-vs-shared split is the quiet one: it lets one person keep a messy working view without
negotiating with the team.

**Devon verdict: ADOPT** — §11-A2. Devon's table already has the hard parts (sticky header, sort,
row checkboxes, a bulk bar, virtualisation) per `table-screen.tsx`; it is missing dynamic columns,
saved views as tabs, and column calculations. `DESIGN.md` §8 already binds this screen to "Linear
list, Notion table, Airtable … group by, saved views, bulk bar with undo", so this is closing a gap
the design contract already opened. Current state:
`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/final/worktable__1440__light__uz-Latn.png`.

### 3.3 Workload view

**What it is.** An infinite horizontal canvas of people × time, zoomable by day/week/month, showing
each person's committed effort against their capacity, "displayed in shades of red, yellow, or
green" ([Use Workload view](https://help.clickup.com/hc/en-us/articles/6310449699735-Use-Workload-view)).
Effort is measured by **Time Estimates, task count, Sprint Points, or a Custom Field** — or as
**% out of capacity**, where "25% of a 40 hour weekly capacity saves 10 hours". Capacity is per
person per weekday: "Weekly capacity is the total of a person's working days, not a fixed five-day
week. For example, someone who works four days at 8h each has 32h of weekly capacity."
([Set capacity limits](https://help.clickup.com/hc/en-us/articles/30799771936279-Set-capacity-limits-in-Workload-view)).
Members set their own capacity; admins/managers set anyone's. Non-working days and public holidays
have no capacity and render grey. A **Backlog sidebar** lists what is "unscheduled, overdue,
unassigned, or doesn't have a time estimate" — i.e. everything the view cannot account for.

**Why users love it.** It answers a manager's real question ("can I give this to Nodira this week, or
is she already full?") with a colour, before any conversation. And the backlog sidebar is honest: it
tells you how much of the picture is missing instead of quietly under-reporting.

**Devon verdict: ADOPT, with one hard constraint.** This is the feature a boshqarma boshlig'i will
notice first. The constraint: **it is a load view, never a performance view.** `FEATURE-PLAN.md`
refuses "per-person productivity scores or leaderboards", and a red bar next to a name is one
design mistake away from being read as one. Mitigations, binding on the spec in §11-A4: no ranking
or sorting by utilisation; no "efficiency" derived numbers; the red state reads as "over capacity —
move something", never "behind"; and the copy is about the work, not the person. Also adopt the
backlog sidebar verbatim in spirit — under-counted work is the failure mode that discredits the
whole view.

---

## 4. Dashboards and cards

**What it is.** A canvas of resizable cards over workspace data; ClickUp claims "60+ cards", grouped
as Featured, AI, Custom (charts), Sprints, Statuses, Tags, Assignees, Priorities, Time Tracking,
Tables, Embed
([Intro to cards](https://help.clickup.com/hc/en-us/articles/25757497269143-Intro-to-cards)).
Dashboards have **dashboard-wide filters combined with per-card filters**, view/edit modes,
auto-refresh every 30 minutes, PDF export, chart drill-down and scheduled reports
([Intro to Dashboards](https://help.clickup.com/hc/en-us/articles/6312197753239-Intro-to-Dashboards)).
The marketing framing is "change statuses, reassign owners, and update fields right from the
dashboard" ([clickup.com/features/dashboards](https://clickup.com/features/dashboards)).

**Why users love it.** One page a head can open in a meeting. The genuinely good idea is not the 60
cards — it is **dashboard filter + card filter composing**, so "this quarter" is set once and every
card obeys, and **acting from the report** so the dashboard is not a dead end.

**Devon verdict: ADAPT.** Devon already has `/analytics` with a filter bar, chart cards and saved
filters (`apps/web/src/features/analytics/{filter-bar,chart-card,sections}.tsx`,
`savedFilterSchema` in `.../analytics/types.ts`), plus `/` (Home) built as fixed KPI tiles
(`apps/web/src/features/home/home-screen.tsx`), and EPIC-010 already promises "pin to Home". So
Devon does not need a dashboard *product*; it needs the head's page to become **arrangeable, with
per-card filters that compose with the page filter** (§11-A6). Refuse: 60 card types (ship ten),
scheduled email reports (EPIC-006 owns digests), public sharing (I-8a), auto-refresh timers (Devon is
realtime via Centrifugo), and AI cards that generate prose nobody asked for.

---

## 5. Goals and Targets

**What it is.** "Goals are high-level objectives that are made up of smaller, measurable Targets."
Four Target types — **Number** (range, up or down), **True/False**, **Currency**, **Task** (a single
task, a subtask, or an entire List). Goal progress is the roll-up of its Targets; a Goal has an
owner, a colour, a Goal Folder, sharing/permissions, and a Dashboard card showing a donut of percent,
target count, owner and last-updated
([Create a Goal](https://help.clickup.com/hc/en-us/articles/6325733579671-Create-a-Goal),
[Goals cards](https://help.clickup.com/hc/en-us/articles/6325664888727-Goals-cards)).

**Why users love it.** It is the OKR shape everyone has seen in a slide deck, but the progress bar
moves by itself because a Target can be "this List is done". The relief is not having to update a
status report.

**Devon verdict: ADAPT, small.** A boshqarma does have quarterly commitments, and there is nowhere in
Devon to put them today — they currently live in a `/pages` document that nobody updates. Adopt the
Goal + typed Target model with **three** target types: number (with a direction), yes/no, and
cards-done (a saved filter reaching zero, or a project reaching 100 %). Refuse Currency (no budgets
in Devon), Goal Folders (a department has ten goals, not a hierarchy), and per-person goals, which
would be an appraisal system and is out (`FEATURE-PLAN.md` refuses HR). One owner per goal, visible
to the whole department, progress recomputed on write. Spec in §11-A11.

---

## 6. Time estimates, time tracking, and dependencies

### 6.1 Time Estimates

**What it is.** A ClickApp; per-task estimate entered in natural language ("1h", "30 mins"),
optionally **per assignee** on multi-assignee tasks, with a **rollup** of subtask estimates onto the
parent, a workspace "hours per day" setting, and a column in List/Table
([Intro to Time Estimates](https://help.clickup.com/hc/en-us/articles/6304177391767-Intro-to-Time-Estimates),
[per assignee](https://help.clickup.com/hc/en-us/articles/7255524972055-Set-Time-Estimates-per-assignee)).

**Devon verdict: ADOPT (required by Workload).** Natural-language entry included — Devon already
parses Uzbek dates in `packages/contracts/src/filter-grammar.ts` and
`apps/web/src/features/work/lib/quick-add.ts`, so "2 soat", "yarim kun", "3h" belongs in the same
parser. `personal_tasks.estimate_min` already exists (TECH-SPEC §3), so the unit (minutes) and the
name are already chosen — use `estimate_min` on `cards` too, and do not invent a second convention.
Refuse per-assignee estimates: a Devon card has exactly one assignee by design.

### 6.2 Time tracking

**What it is.** Start/stop timers, manual entries, billable flags, timesheets, rollup, and an
explicit "ClickUp time tracking does not take screenshots"
([Intro to time tracking](https://help.clickup.com/hc/en-us/articles/6304291811479-Intro-to-time-tracking)).

**Devon verdict: SKIP.** Estimates answer "will this fit"; tracking answers "how long did you take",
which in a government department reads as surveillance and sits a millimetre from the attendance
tracking `FEATURE-PLAN.md` refuses by name. That ClickUp has to state in its own help centre that it
takes no screenshots tells you what users assume this feature is for. Devon's Pomodoro
(`packages/db/src/schema/personal.ts` — `pomodoro_sessions`) already gives a person their own
time data, privately, owner-only under I-1. That is the right place and the right scope.

### 6.3 Dependencies

**What it is.** Exactly two relationships — **blocks** and **blocked by / waiting on** — creatable
from a task, from Gantt by dragging a node between bars, in bulk, and from Automations. A
**Dependency Warning** ClickApp warns when you close a task that is still waiting on another;
**Reschedule Dependencies** moves dependents automatically when a predecessor's dates move; you are
notified when a task becomes unblocked
([Intro to Dependency Relationships](https://help.clickup.com/hc/en-us/articles/6309155073303-Intro-to-Dependency-Relationships)).

**Why users love it.** Two words, no PERT vocabulary, and the notification that closes the loop:
*your* task just became unblocked. That notification is most of the value.

**Devon verdict: ADAPT.** Adopt the two relationship types, the unblocked notification, and the
warning-on-done. Adapt auto-reschedule: instead of an automation that silently moves other people's
deadlines (in Devon those belong to *other people*, which is a social act), offer it as a suggested
change with a preview and a single undoable apply — the same `AiPreviewPanel` / undo-toast pattern
`DESIGN.md` §3 and I-11 already require. Refuse start-to-start / finish-to-finish variants and
critical-path analysis. Spec in §11-A10.

---

## 7. Recurring tasks, templates, automations, reminders, notifications

### 7.1 Recurring tasks

**What it is.** Daily (with skip-weekends), Weekly, Monthly (same day / first / last / "default day
of the month", e.g. *second Wednesday*), Yearly, and **"Days after" completion**. Closing early
recurs immediately unless "On Schedule" is set; a recurrence can carry the task's dependencies;
future instances can be shown on the calendar; tasks can recur on non-working days
([Use recurring tasks](https://help.clickup.com/hc/en-us/articles/6309885016471-Use-recurring-tasks)).

**Why users love it.** "Every second Wednesday" and "3 days after it's done" are how real
administrative rhythms are actually described, and both are one dropdown.

**Devon verdict: ADOPT — and note the column already exists and is dead.** `cards.recurrence jsonb`
is defined in `packages/db/src/schema/work.ts` and is referenced **nowhere** in `apps/api/src`,
`packages/contracts/src` or `apps/web/src` (grep: zero hits). EPIC-017 already owns "recurring cards";
this is the spec for it (§11-A7). Adopt the five schedules plus "days after done" and the
close-early-recurs-now behaviour; adopt showing the next instance greyed on `/work/calendar`. Refuse
recurrence on project objective tasks in v1.1 (the shared-card semantics need their own decision).

### 7.2 Templates

**What it is.** A Template Center of pre-made and saved templates for tasks, Docs, views, Lists,
Folders and Spaces; a **default task template for a List**; **date remapping** on apply; preview
images; tags and department filters; an **audit log** of templates created/merged/applied with
error reasons and durations
([Intro to templates](https://help.clickup.com/hc/en-us/articles/6326144923159-Intro-to-templates)).

**Devon verdict: ADAPT, department-local.** Devon already has the pattern in one place —
`onboarding_templates` / `onboarding_runs` in `packages/db/src/schema/pages.ts`, where a checklist
template becomes a newcomer's personal tasks (EPIC-011). Generalise that shape to **card templates**
(title, description, checklist, labels, custom-field defaults, estimate, relative due offset) and
**project templates** (a set of objective/subjective tasks with offsets), stored per department,
created from an existing card/project via "Shablon sifatida saqlash". Adopt date remapping (offsets
from the apply date — the thing that makes a template usable twice). Refuse: a community/public
gallery, cross-department sharing (I-8a), and preview images. Templates should be reachable from
`Ctrl/⌘+K` (I-13), which is where a repeat task actually starts.

### 7.3 Automations

**What it is.** Trigger + optional Condition + Action, inherited down the Hierarchy, with usage
metering ("when the limit has been exceeded, your Workspace's Automations are paused for that
month"), an activity log, email/webhook/integration actions
([Intro to Automations](https://help.clickup.com/hc/en-us/articles/6312102752791-Intro-to-Automations)).

**Devon verdict: ADAPT — and stay inside EPIC-017's "five triggers".** `FEATURE-PLAN.md` refuses
"custom workflow engines", and EPIC-017 already scopes exactly five triggers. ClickUp's contribution
here is not the engine, it is the **three-slot sentence** ("when X, if Y, do Z") and the **activity
log with failure reasons**, both of which make a rule debuggable by a non-engineer. Take those two
and nothing else. The usage meter is a warning about what an unbounded engine costs.

### 7.4 Reminders

**What it is.** "Smaller action items that don't require a task", created anywhere with `Alt+R`,
optionally delegated to someone else, recurring, landing in the **Inbox Later tab** and moving to
**Primary** when due ([Intro to reminders](https://help.clickup.com/hc/en-us/articles/6326047586199-Intro-to-reminders)).

**Devon verdict: ADAPT, low priority.** The honest read is that ClickUp needed reminders because its
tasks are heavy. Devon already has two lighter homes: `/personal` nested tasks and the inbox. The one
piece worth stealing is **the keyboard-first capture that does not become a card** — a `⌘K` →
"Eslatma" that writes a `personal_tasks` row with a due time and is delivered by the existing
notification pipeline (I-14: events → channel adapters, never a direct Telegram call). Refuse
delegated reminders: assigning someone a thing that is not a card creates a second, invisible work
system.

### 7.5 Notifications

**What it is.** Per-channel (Inbox / Email / Browser-Desktop / Mobile) presets — **Default, Focused,
Mentions only, Custom, Disabled** — over a long trigger matrix where a handful of triggers are marked
"Cannot be deactivated" (assigned to me, @mention, comment assigned to me, status changes). Smart
Notifications suppress mobile pushes while you are active on desktop
([Notification settings](https://help.clickup.com/hc/en-us/articles/6325918957335-Notification-settings)).

**Devon verdict: ADAPT the presets, skip the matrix.** Devon's EPIC-006 already has per-type,
per-channel preferences and quiet hours, which is the matrix. What it should add is the **three
presets in front of the matrix** (Hammasi / Muhimlari / O'zim sozlayman) so that the 90 % of people
who will never open the matrix still get a sane, chosen-by-them answer, and the
**cannot-be-disabled floor** (a card assigned to you, a card of yours cancelled, a department pause)
so that a person cannot mute themselves out of their own job. Smart Notifications is the right
default for Telegram-vs-web and is nearly free given Devon's session table
(`app.sessions.last_seen_at`).

---

## 8. Bulk Action Toolbar (ex-Multitask Toolbar)

**What it is.** Select rows (hover → circle, or Shift+click), get a toolbar: Archive, Assignees,
Move/Add to another List, Copy, Convert to Subtasks, **Custom Fields**, Dates, Delete, Dependencies,
Duplicate, Merge, Milestones, Priority, Relationships, Remove from List, Status, Tags, Task Type,
Followers — up to **1 000 tasks**, with a "Send notifications" checkbox you can clear
([Bulk Action Toolbar](https://help.clickup.com/hc/en-us/articles/6309768265495-Manage-tasks-with-the-Bulk-Action-Toolbar)).

**Why users love it.** Friday clean-up. Twenty cards, one gesture. The "don't notify" checkbox is the
mature detail — bulk edits are usually bookkeeping, and notifying twenty people about bookkeeping is
how a team learns to ignore notifications.

**Devon verdict: ADOPT, extended to every work surface.** `table-screen.tsx` already ships "row
checkboxes and a bulk action bar (assign/label/archive)" (its own header comment). Three gaps:
(1) it exists only on `/work/table` — it belongs on `/work`, `/work/mine`, `/work/calendar` and
`/work/archive` too; (2) it lacks due date, priority, project, watchers and custom-field values;
(3) there is no quiet-edit affordance. Take the notification suppression and take the cap (Devon's
cap should be lower and enforced server-side — a bulk write is still one audit row per card under
I-5, in one transaction). Undo-toast, not a confirm dialog (I-11). Spec in §11-A8.

---

## 9. Home / My Work / Me mode / Personal Priorities

**What it is.** Three overlapping things:
- **My Tasks (formerly Home)** — a canvas of personal cards: AI StandUp, Recents, Agenda, **LineUp**,
  Assigned to me, Reminders, Assigned comments, My Work, Personal List; reorderable, resizable,
  showable/hideable, with a greeting you can switch off
  ([My Tasks](https://help.clickup.com/hc/en-us/articles/18944788880791-My-Tasks-page-formerly-Home)).
- **Me Mode** — a per-view toggle showing only what is yours, configurable to include subtasks,
  assigned comments and checklist items; **creating a task while it is on assigns it to you**; a view
  can **default to Me Mode for everyone**; an **assignee sidebar** filters to any set of people
  ([Me Mode](https://help.clickup.com/hc/en-us/articles/6308948062871-Intro-to-Me-Mode-and-the-assignee-sidebar)).
- **Personal Priorities (ex-LineUp)** — a hand-ordered short list of what you are working on now,
  pinned to the lower-left corner of the workspace, **also visible on your profile and in Teams Hub**,
  where tasks others cannot see render as "Private task". Members and admins can add tasks to *other*
  people's priorities. Clearing one changes nothing about the task
  ([Personal Priorities](https://help.clickup.com/hc/en-us/articles/32481768821527-What-are-Personal-Priorities)).

**Why users love it.** "Assigned to me, sorted by due date" is the single most-opened screen in every
work tool. Me Mode wins because it is the *same* screen, not a different one — the person keeps their
place. And Personal Priorities works because *"what I will actually do today" is a different, much
shorter list than "what is assigned to me"*, and no filter can compute it.

**Devon verdict: ADOPT all three, with one refusal.**
- **Me mode**: Devon has `/work/mine` as a route. Add the *toggle* to `/work`, `/work/table`,
  `/work/calendar`, `/work/timeline` (`filter-bar.tsx`), including the "new cards are assigned to me
  while it is on" behaviour — that is the bit that makes it feel like a mode and not a filter.
  Keep `/work/mine` as the URL the toggle produces so the URL stays the state (`DESIGN.md` §8).
- **Assignee sidebar**: adopt as a multi-select of people in the filter bar — Devon's board already
  is per-person, so this is "show me these three columns", which is exactly what a bo'lim boshlig'i
  wants.
- **Focus list (Personal Priorities)**: adopt as a hand-ordered list of ≤7 cards, on `/` (Home) and in
  the sidebar foot. **Refuse the part where other people can add to it, and refuse showing it on your
  profile.** In ClickUp that is a management affordance; in a ministry department a list on your
  profile of what you are supposed to be doing right now, editable by your boss, is a different
  product and one this one has said no to. Devon's version is private-by-default and owner-only
  (I-1's personal-workspace rule), with an opt-in "bo'lim boshlig'iga ko'rsatish" switch, off.
- **Home cards**: adopt the *arrangeable* part (§11-A6); `home-screen.tsx` is a fixed tile set today.

---

## 10. The rest, briefly

| Feature | What it is | Devon verdict |
|---|---|---|
| **Custom task statuses** | Statuses per Space/Folder/List in three groups (Active / Done / Closed), status templates, "you can't create custom Closed statuses", reverse order, show-status-progress pie ([Manage task statuses](https://help.clickup.com/hc/en-us/articles/6309452618647-Manage-task-statuses)) | **SKIP the customisation, keep the grouping.** `FEATURE-PLAN.md` refuses custom workflow engines; Devon's `card_status` enum is `active / done / archived`, which is ClickUp's three groups with the configurability removed. Worth stealing: the *idea* that "Done but not gone" and "closed" are different states — Devon already has that (done card → person's archive, department-readable). |
| **Priorities** | Exactly four levels, Urgent / High / Normal / Low, and "It's not possible to customize Priority labels and colors" ([Set task Priorities](https://help.clickup.com/hc/en-us/articles/6304483666199-Set-task-Priorities)) | **ADOPT as validation, no work needed.** Devon has `card_priority` already. ClickUp — the most configurable tool in the category — hard-codes this one deliberately, because a shared priority vocabulary is worthless if every team renames it. Do not accept a request to make Devon's priorities configurable; cite this. |
| **Tags** | Free-form coloured labels at Space level, a Tag Manager, bulk tagging, filter and inherit-on-move ([Intro to tags](https://help.clickup.com/hc/en-us/articles/6304056754583-Intro-to-tags)) | **HAVE IT** (`labels` table, `cards.labels uuid[]`, `label:` in the filter grammar). Gap worth closing: a **label manager** for the head (rename/recolour/merge/archive), which is how a 30-person department stops accumulating "shoshilinch", "Shoshilinch" and "urgent". |
| **Sprints / Sprint Points** | Sprint Folders, sprint statuses, spillover management, burndown/burnup/velocity cards, points with rollup and per-assignee values ([Intro to Sprints](https://help.clickup.com/hc/en-us/articles/6303974210071-Intro-to-Sprints), [Sprint Points](https://help.clickup.com/hc/en-us/articles/6303883602327-Use-Sprint-Points)) | **SKIP at department level; Devon already has the right version.** `/personal` has sprints of 3h/day/week (`personal_sprints`), which is the useful core (a time box you commit to) without agile ceremony a boshqarma does not run. Points: skip — Devon measures in hours, and two effort currencies is one too many. Spillover is the one idea worth carrying into `/personal`: "move what's left to the next sprint" as one button. |
| **Docs** | Nested pages, wikis, synced blocks, Docs Hub, tags, comments, export to PDF/HTML/Markdown, `/`-commands ([Intro to Docs](https://help.clickup.com/hc/en-us/articles/6328174371351-Intro-to-Docs)) | **HAVE IT, smaller** (`/pages`, `pages` + `page_versions`, EPIC-011). Worth stealing: **synced blocks** (one canonical "how we do X" paragraph, embedded in several pages, updated once) — cheap, and it is the thing a department's how-we-work pages actually need. Skip the hub, skip export formats beyond PDF. |
| **Whiteboards** | Real-time multiplayer canvas, shapes/connectors, convert a sticky into a task ([Intro to Whiteboards](https://help.clickup.com/hc/en-us/articles/6326615000471-Intro-to-Whiteboards)) | **SKIP for v1.1.** `/personal` already has a private Excalidraw canvas (`personal_canvases`). Making it shared means presence, conflict resolution and a permission model for a surface nobody has asked for. Worth stealing later, and only one bit: **turn a sticky into a card**. |
| **ClickApps** | Per-workspace / per-Space feature toggles, owner-and-admin only ([Intro to ClickApps](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps)) | **ADOPT the pattern** (§12). This is how Devon stays "calm by default, dense on demand" while shipping everything above. |

---

## 11. Prioritised adoption list for v1.1

Ordering is by (value to a department) × (leverage over the rest of the list) ÷ (risk). A1–A4 are the
spine: A1 makes A2 and A6 worth building, A3 makes A4 possible. Every item below assumes the standing
rules and does not restate them per item: `department_id` + RLS on every table (I-1), `can()` on
every route, audit + outbox in one transaction (I-5, I-14), four locales (I-9), all five screen
states (I-10), undo over confirm (I-11), reachable from `⌘K` (I-13), tokens only, and a module that
ships by adding files (`MODULE-GUIDE.md`; migration prefix `0300` for work, `0700` for analytics/pages).

### A1 — Custom fields on cards *and* on people **(P0)**

**Where it lives.** Definitions: `/department/fields` (a new section in department settings, head
only). Values on a card: the card detail's right-hand property column
(`apps/web/src/features/work/components/card-detail.tsx`), under the built-ins, in the head's
configured order. Values on a person: `/people` → person sheet, and their own `/account`.

**Default behaviour.** A fresh department has **zero** custom fields and no empty-state clutter — the
Fields section shows one empty state with one button. Field types: `text`, `long_text`, `number`
(with unit suffix and decimals), `date`, `select`, `multi_select`, `person`, `url`, `checkbox`,
`derived` (formula-lite: `days_between`, `difference`, `sum`, `ratio`, `percent` over two named
number/date fields). Each definition carries: name (four locales — the head writes one, AI translate
offers the other three via the existing `/ai` preview pattern), type, options with colours, required
(off), default, description, `applies_to ∈ {card, person}`, `show_in_table` (on), `show_on_card_tile`
(off), `archived_at`. Deleting is soft and hides values rather than dropping them — ClickUp's own
"your data in Custom Fields is not deleted by switching them" is the right instinct.

**What the head configures.** Everything above, plus order. Two things the head cannot do: create
more than **20** active card fields and **10** person fields (a hard cap, with the reason in the copy
— a cap is the only thing that stops a field list becoming a form); and create a person field whose
name or key matches the **I-2 blocklist**. That blocklist is not new — `packages/db/migrations`
already lints column names against `birth*`, `dob`, `passport*`, `pinfl*`, `address*`, `salary*`,
`nationality`, `religio*`, bare `inn` (`MODULE-GUIDE.md`, DB migrations section). Person fields are
user data going into a value column rather than a column name, so the same list must be enforced at
the API on the *field definition* (name in all four locales, normalised, both scripts) with a
translated refusal: "Devon HR tizimi emas" plus what to use instead. This is the single largest risk
in this document: person custom fields are one careless field away from being the HR module
`FEATURE-PLAN.md` refuses and I-2 forbids.

**What the member sees.** On their card: extra rows in the property column, inline-editable, each
with the field's description as a tooltip; required fields block the card moving to `done` with an
inline message, never a modal. On themselves: the person fields on `/account`, editable where the
head marked them self-editable, read-only otherwise. A member never sees the Fields settings screen —
`/department/fields` renders `NoPermissionState` (I-10).

**Data/API.** New module `apps/api/src/modules/fields/`, schema `packages/db/src/schema/fields.ts`,
migration `0310_fields_definitions.sql`: `field_defs(id, department_id, key, applies_to, type,
label_i18n jsonb, options jsonb, required, default_value jsonb, config jsonb, order_key, archived_at,
…)` and `field_values(department_id, field_def_id, subject_type, subject_id, value jsonb, …)` with a
unique index on `(field_def_id, subject_id)` and a GIN index on `value`. Values join, never widen
`cards` — a card with no custom fields costs zero extra bytes and the board query is untouched.
Extend `packages/contracts/src/filter-grammar.ts` with `field:<key>:<value>` (and `field:<key>:bo'sh`
for empty), which is one grammar addition that makes every view, saved view, analytics filter and
`⌘K` search field-aware at once.

**Refuses.** Money, location, files, rating, signature, relationship/rollup fields; per-unit or
per-project field sets; a formula language; more than one level of derivation.

### A2 — Table view: dynamic columns, saved views as tabs, column calculations **(P0)**

**Where it lives.** `/work/table` (`table-screen.tsx`, currently a fixed six-column grid —
`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/final/worktable__1440__light__uz-Latn.png`).

**Default behaviour.** The default column set is exactly today's six, so nothing regresses. A `+`
control at the right edge of the header opens a column picker listing built-ins and every card custom
field with a toggle each, plus "Yangi maydon" which jumps to A1's create flow inline. Columns drag to
reorder, resize, and the title column pins. A **saved-views tab strip** sits above the table:
`Barchasi` plus the user's saved views plus the department's shared views, an active-tab pill, `+`
at the end. Changing a filter/sort/column set on a saved view raises the lower-right
"Saqlash / Har doim saqlash" prompt — ClickUp's own affordance, and the reason nobody loses a view by
accident. Every view is still a URL (`DESIGN.md` §8: "the URL is the state"), so a saved view is a
named URL and sharing is copy-paste. **Column calculations** live in a footer row: count / filled /
empty / percent filled for any type; min / max / sum / average / median for numbers and durations;
earliest / latest / span for dates. Per person-group *and* per column, as ClickUp does — that is what
turns the board's grouping into a report.

**What the head configures.** Which saved views are `shared` (the `saved_views.shared` boolean
already exists), the order of the shared tabs, and one **department default view** that new members
land on. Nothing else — column choices are per person.

**What the member sees.** Their own saved views (private by default, `owner_user_id` already on the
table), the shared tabs, and their own column layout persisted per view. A member can share a view to
the department only if the head has left "a'zolar ko'rinish ulasha oladi" on (default on).

**Data/API.** Mostly present: extend `saved_views.filter` usage and add `columns jsonb`, `sort jsonb`,
`pinned boolean` to `saved_views` in `0311_saved_views_columns.sql` (additive, expand-only per I-15).
`GET /api/v1/views`, `POST/PATCH/DELETE` with `can('update', {kind:'department_child'})`.

### A3 — Time estimates on cards **(P0, prerequisite for A4)**

**Where it lives.** Card detail property column; a column in A2; a chip in quick-add
(`quick-add-bar.tsx` / `lib/quick-add.ts`); the card tile only when the head turns it on.

**Default behaviour.** Optional `estimate_min integer` on `cards` (same name/unit as
`personal_tasks.estimate_min`). Natural-language entry in four locales — "2 soat", "yarim kun", "30
daqiqa", "2h", "2 часа" — parsed by the same grammar module that already parses Uzbek weekday names.
A project's estimate is the sum of its objective tasks; a person's week is the sum of what is due that
week. No estimate is a legitimate state and is never nagged; it shows as "—", and A4's backlog panel
counts it.

**What the head configures.** One switch in `/department/settings`: "Vaqt baholari" (off by default —
a department that does not want estimates never sees the field), and the department **work schedule**
(working days and hours per day, default Mon–Fri 8h, and the Uzbek public-holiday set), which A4
reads.

**What the member sees.** A small hourglass chip in the card's property column. Their own estimates
are theirs to set; the head can set them too, and the change is audited like every other write (I-5).

**Refuses.** Timers, timesheets, billable flags, per-assignee splits, "time tracked vs estimated"
variance per person (that is a performance metric — see §6.2).

### A4 — Workload view: capacity per person per week **(P0)**

**Where it lives.** New route `/work/workload`, sixth tab in the `/work` view bar
(`work-shell.tsx`), sibling to board/table/timeline/calendar/mine. Sidebar entry and `⌘K` command
via the existing `manifest.tsx` pattern.

**Default behaviour.** Rows are people, grouped by bo'lim exactly as the board groups them
(`board-column.tsx`'s grouping, reused — the same order in both screens is the whole point of Jakob's
Law). Columns are weeks: **6 weeks visible, current week first**, with day and month zoom levels.
A cell shows committed effort vs capacity as `18s / 40s` with a proportional bar. Colour: under 80 %
neutral, 80–100 % attention, over 100 % over-capacity — three steps, named in the legend, and the
legend says what to do, not what the person is. Effort measure switches between **hours** (from A3)
and **card count** for departments that skip estimates; a card with a start and a due spreads evenly
over its working days, a card with only a due date lands on the due week. Non-working days and Uzbek
public holidays are greyed and carry no capacity. A **"Hisobga olinmagan" panel** (ClickUp's backlog
sidebar) lists cards with no assignee, no due date, or no estimate, with a count in the header — the
view must state how much it cannot see. Clicking a cell opens that person's cards for that week in the
routed detail panel; dragging a card between cells changes its due date with an undo toast.

**What the head configures.** The department work schedule (shared with A3), each person's capacity
override (days worked and hours per day — ClickUp's "four days at 8h each has 32h" model, adopted
verbatim because it is correct and the naive five-day assumption is not), and whether the workload
view is visible to members or to the head and bo'lim boshliqlari only (default: visible to everyone —
`FEATURE-PLAN.md`'s "analytics belongs to everyone").

**What the member sees.** Their own row highlighted and their own capacity editable by them (ClickUp:
"Workspace members can set capacity for themselves"); everyone else's rows read-only. No sorting by
utilisation, no ranking, no total-per-person leaderboard, no "utilisation %" KPI anywhere in
`/analytics`. If a future request asks for one, it is refused under `FEATURE-PLAN.md`.

**Data/API.** `work_schedules(department_id, weekday, minutes)` and
`capacity_overrides(department_id, user_id, weekday, minutes, source)` in `0312_workload.sql`;
`GET /api/v1/work/workload?from=&to=&measure=` returning a precomputed per-person-per-bucket
aggregate (never a query in a loop — CLAUDE.md), reusing the analytics aggregate machinery in
`packages/db/src/schema/analytics.ts`.

### A5 — People fields on the directory **(P1, rides on A1)**

**Where it lives.** `/people` cards and the person sheet
(`.../final/people__1440__light__uz-Latn.png`), `/account` for your own values, `/department/fields`
for definitions.

**Default behaviour.** Person fields are A1's `applies_to='person'` definitions, stored against the
`memberships` row (which already carries `title_override`), so a person's fields are
department-scoped — the same human in two departments is described differently, which is correct and
which the current `users.title` cannot express. Intended uses: "Ish joyi / xona", "Ichki telefon",
"Mas'ul yo'nalish" (multi-select), "Ish kunlari" (feeding A4), "Telegram" (already linked), "Sertifikat
amal qilish muddati" (date). Values appear on the person card, are filterable
(`field:yonalish:EGDI`), and are groupable on the people directory.

**What the head configures.** The definitions, plus per field: `self_editable` (member can change it)
and `visible_to` (`everyone` | `head_only`). Head-only values are excluded from list endpoints
entirely (I-2: "contact details beyond work fields are optional, never returned by list endpoints")
and every head read of one is audited.

**What the member sees.** Their own values on `/account`, editable where permitted; colleagues'
`everyone` values on `/people`. Never sees a head-only field exists.

**Refuses.** Anything on the I-2 blocklist, free-text fields marked head-only *and* required (that
combination is a personnel file), bulk export of person fields (the analytics export covers cards,
not people), and any person field in an AI prompt payload (`packages/ai` must strip
`applies_to='person'` values — the golden test set gets a case).

### A6 — Head dashboard: arrangeable cards with composing filters **(P1)**

**Where it lives.** `/` (Home, `home-screen.tsx`) and `/analytics` (`sections.tsx`, `chart-card.tsx`).

**Default behaviour.** Home keeps its current default arrangement for everyone (no migration shock)
but the tiles become **cards in a grid**: drag to reorder, resize between one and three columns,
"Kartalarni boshqarish" to add/remove. Ten card types, not sixty: KPI tile, throughput line, on-time
gauge, load-by-person bar, load-by-unit bar, overdue trend, project progress list, event
participation, **goal progress ring (A11)**, and **saved-view table (A2)** — the last one being
ClickUp's "act from the report" idea: a live table of a saved view, with the row actions live.
**The page filter composes with per-card filters**: setting "this quarter · Data bo'limi" at the top
re-scopes every card, and a card that carries its own filter shows a small chip saying so. This is the
one dashboard mechanic worth copying exactly, because without it a head configures the same date
range eight times.

**What the head configures.** A **department default layout** ("Hammaga standart sifatida saqlash")
that new members inherit, plus which cards are available at all.

**What the member sees.** The same page, their own arrangement, everything scoped by what they may
read. Analytics is for everyone (`FEATURE-PLAN.md`), so a member's cards are not a reduced set —
except A4-derived cards if the head restricted the workload view.

**Data/API.** `dashboard_layouts(department_id, user_id nullable, cards jsonb)` in `0713_dashboards.sql`
— a null `user_id` is the department default. Extend the existing `saved_filters` rather than
inventing a second filter store.

### A7 — Recurring cards **(P1, EPIC-017)**

**Where it lives.** Card detail date row → "Takrorlanish"; a badge on the card tile; greyed future
instances on `/work/calendar`.

**Default behaviour.** Wire the **already-existing, currently dead** `cards.recurrence jsonb` column.
Schedules: daily (with "ish kunlari only"), weekly (pick weekdays), monthly (same date / first / last
/ "the second Wednesday"), yearly, and **"N kun bajarilgandan keyin"**. Completing a card before its
due date creates the next instance immediately unless "Jadval bo'yicha" is set — ClickUp's default,
and the one people expect. A new instance copies title, description, checklist template, labels,
assignee, estimate and custom-field defaults; it copies neither comments nor attachments nor done
state. The generator is a `pg-boss` job (TECH-SPEC §1), never a request-time side effect, and is
idempotent per `(card_id, occurrence_date)`.

**What the head configures.** Nothing by default. One guard: a member may set a recurrence on a card
assigned to someone else only if "a'zolar bir-biriga topshiriq bera oladi" is on (the setting that
already governs giver→assignee).

**What the member sees.** A recurrence chip on the card and a plain-language sentence ("Har oyning
oxirgi juma kuni") in all four locales — never an RRULE string.

### A8 — Bulk action bar on every work surface **(P1)**

**Where it lives.** `/work`, `/work/table`, `/work/mine`, `/work/calendar`, `/work/archive`.

**Default behaviour.** Shift-click and checkbox multi-select; a bottom-centre bar (bottom-right at
1440, per `DESIGN.md`'s toast placement) showing "N ta karta tanlandi" and actions: assignee, due
date, priority, labels, project, watchers, custom-field value, archive, delete. A **"Xabar
yubormaslik"** checkbox, off by default, suppresses the notification fan-out for bookkeeping edits —
suppressing notifications never suppresses the audit rows (I-5, I-5a). Cap: **200 cards** per
operation, enforced server-side, in one transaction, with one undo toast that reverses the whole
batch.

**What the head configures.** Nothing. **What the member sees.** The same bar, with actions they lack
permission for absent rather than disabled (I-6: the client only hides what it cannot use).

### A9 — Me mode, assignee filter, and the focus list **(P1)**

**Where it lives.** `filter-bar.tsx` (all work views), `/` (Home), sidebar foot.

**Default behaviour.** A "Menikilar" toggle in the filter bar of every work view; on, it filters to
your cards *and* new cards you create default to you. An assignee multi-select next to it. Toggling
rewrites the URL, and `/work/mine` is simply the board view with the toggle on. The **focus list**
("Bugungi diqqat") is a hand-ordered list of up to seven cards, added from a card's `⌘K` menu or
dragged from any view, with a "Clear" that changes nothing about the card — ClickUp's exact
semantics, which are what make it safe to use.

**What the head configures.** Nothing. **What the member sees.** Their own focus list only. An opt-in
switch shows it to their bo'lim boshlig'i; it is off, and there is no way for anyone else to add to
it (§9).

### A10 — Dependencies **(P2)**

**Where it lives.** Card detail, a "Bog'liqliklar" section; lines on `/work/timeline`; a chip on the
card tile when blocked.

**Default behaviour.** Two relations only: **bloklaydi** / **bloklangan**. Creating one from the card
or by dragging between bars on the timeline. Closing a blocked card shows an inline warning with the
blocker named and a "baribir yopish" that proceeds (a warning, never a hard block — Devon does not
enforce process). When the last blocker closes, the blocked card's assignee gets an inbox event
("ishingiz ochildi") through the normal outbox → notification path (I-14). Moving a blocker's due
date offers "3 ta keyingi kartani ham suring" as a **previewed, undoable** suggestion — never a
silent cascade.

**Data/API.** `card_links(department_id, from_card_id, to_card_id, kind, created_by)` in
`0313_dependencies.sql`, with a cycle check on write.

### A11 — Department goals **(P2)**

**Where it lives.** New route `/goals` (or a tab on `/analytics`); a card on Home (A6).

**Default behaviour.** A goal is a title, a period (quarter or custom), an owner, a colour, and 1–5
typed targets: **number** (from → to, direction), **ha/yo'q**, or **cards-done** (a saved view
reaching zero, or a project reaching 100 %). Progress is the mean of target progress, recomputed on
every relevant write and shown as a ring. Number targets are updated by hand with a one-line note;
cards-done targets update themselves, which is the entire reason anyone keeps a goal current.

**What the head configures.** Who may create goals (head only by default; "a'zolar ham maqsad qo'sha
oladi" available). **What the member sees.** Every goal, its progress, its owner, and which of their
cards feed a cards-done target — that link is what makes a goal mean anything on a Tuesday.

**Refuses.** Currency targets, goal folders, per-person goals, cascading/aligned OKR trees.

### A12 — Notification presets and the floor **(P2)**

Three presets in front of EPIC-006's existing matrix (Hammasi / Muhimlari / O'zim sozlayman), a
non-mutable floor (assigned to you, your card cancelled, department paused), and desktop-active
suppression of Telegram pushes using `sessions.last_seen_at`. See §7.5.

### A13 — Department feature toggles ("ClickApps") **(P2)** — see §12.

---

## 12. The ClickApps lesson, and why it is the safety valve for everything above

ClickUp ships an enormous surface and stays usable for a five-person team because **features are off
until an owner turns them on**, workspace-wide or per Space, and members can see but not change the
toggles ([Intro to ClickApps](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps)).

Devon should adopt exactly this shape in `/department/settings` as a "Imkoniyatlar" section, head
only, one switch per line with a one-sentence description and a link to the relevant `/pages`
how-we-work page. Candidate switches from this document: custom fields, person fields, time
estimates, workload view, dependencies, recurring cards, goals, focus list. **Defaults: everything
off except what exists today.** A department that just registered should see precisely the product
shipped in v1.0; the head turns on what their department actually needs, one switch at a time, and
the empty states teach the next action (I-10).

This is what makes an 13-item adoption list safe. Without it, v1.1 is how a calm product becomes a
configuration surface, which is the failure mode `FEATURE-PLAN.md`'s "calm by default, dense on
demand" exists to prevent — and which ClickUp itself is the industry's clearest cautionary example of.

---

## 13. Sources

ClickUp help centre (read 2026-09-12 via the public Zendesk article API; `help.clickup.com` returns
403 to plain fetches):

- Custom Fields: [intro](https://help.clickup.com/hc/en-us/articles/6303536766231-Intro-to-Custom-Fields) ·
  [types](https://help.clickup.com/hc/en-us/articles/6303499162647-Custom-Field-types) ·
  [by task type](https://help.clickup.com/hc/en-us/articles/30976239926167-Intro-to-Custom-Fields-by-task-type) ·
  [manager](https://help.clickup.com/hc/en-us/articles/13066263096727-Intro-to-Custom-Field-Manager) ·
  [search/sort/filter](https://help.clickup.com/hc/en-us/articles/12665650881943-Search-sort-and-filter-tasks-by-Custom-Fields) ·
  [formula fields](https://help.clickup.com/hc/en-us/articles/6308656424983-Intro-to-Formula-Fields) ·
  [rollup fields](https://help.clickup.com/hc/en-us/articles/11816472778775-Add-rollup-fields-to-List-view)
- Views: [intro](https://help.clickup.com/hc/en-us/articles/6329880717719-Intro-to-views) ·
  [List](https://help.clickup.com/hc/en-us/articles/6310260883351-Intro-to-List-view) ·
  [Board](https://help.clickup.com/hc/en-us/articles/6310080798615-Create-and-share-a-Board-view) ·
  [Table](https://help.clickup.com/hc/en-us/articles/6329890854935-Create-and-share-a-Table-view) ·
  [Calendar](https://help.clickup.com/hc/en-us/articles/6310085740183-Intro-to-Calendar-view) ·
  [Gantt](https://help.clickup.com/hc/en-us/articles/6310249474967-Create-and-share-a-Gantt-view) ·
  [Workload](https://help.clickup.com/hc/en-us/articles/6310449699735-Use-Workload-view) ·
  [Workload capacity](https://help.clickup.com/hc/en-us/articles/30799771936279-Set-capacity-limits-in-Workload-view) ·
  [Me Mode](https://help.clickup.com/hc/en-us/articles/6308948062871-Intro-to-Me-Mode-and-the-assignee-sidebar) ·
  [saved filters](https://help.clickup.com/hc/en-us/articles/6311659064983-Saving-view-filters) ·
  [column calculations](https://help.clickup.com/hc/en-us/articles/6310124537751-Calculate-columns-in-List-and-Table-view)
- Dashboards: [intro](https://help.clickup.com/hc/en-us/articles/6312197753239-Intro-to-Dashboards) ·
  [cards](https://help.clickup.com/hc/en-us/articles/25757497269143-Intro-to-cards)
- Goals: [create a Goal](https://help.clickup.com/hc/en-us/articles/6325733579671-Create-a-Goal) ·
  [Goals cards](https://help.clickup.com/hc/en-us/articles/6325664888727-Goals-cards) ·
  [goals and OKRs](https://help.clickup.com/hc/en-us/articles/6327987972119-Use-ClickUp-to-track-goals-and-OKRs)
- Effort and sequencing: [Time Estimates](https://help.clickup.com/hc/en-us/articles/6304177391767-Intro-to-Time-Estimates) ·
  [per assignee](https://help.clickup.com/hc/en-us/articles/7255524972055-Set-Time-Estimates-per-assignee) ·
  [time tracking](https://help.clickup.com/hc/en-us/articles/6304291811479-Intro-to-time-tracking) ·
  [Dependencies](https://help.clickup.com/hc/en-us/articles/6309155073303-Intro-to-Dependency-Relationships) ·
  [Sprint Points](https://help.clickup.com/hc/en-us/articles/6303883602327-Use-Sprint-Points)
- Repetition and rules: [recurring tasks](https://help.clickup.com/hc/en-us/articles/6309885016471-Use-recurring-tasks) ·
  [templates](https://help.clickup.com/hc/en-us/articles/6326144923159-Intro-to-templates) ·
  [Automations](https://help.clickup.com/hc/en-us/articles/6312102752791-Intro-to-Automations) ·
  [reminders](https://help.clickup.com/hc/en-us/articles/6326047586199-Intro-to-reminders) ·
  [notification settings](https://help.clickup.com/hc/en-us/articles/6325918957335-Notification-settings)
- Personal surfaces: [My Tasks (formerly Home)](https://help.clickup.com/hc/en-us/articles/18944788880791-My-Tasks-page-formerly-Home) ·
  [Personal Priorities (formerly LineUp)](https://help.clickup.com/hc/en-us/articles/32481768821527-What-are-Personal-Priorities) ·
  [Bulk Action Toolbar (formerly Multitask Toolbar)](https://help.clickup.com/hc/en-us/articles/6309768265495-Manage-tasks-with-the-Bulk-Action-Toolbar)
- Classification: [task statuses](https://help.clickup.com/hc/en-us/articles/6309452618647-Manage-task-statuses) ·
  [priorities](https://help.clickup.com/hc/en-us/articles/6304483666199-Set-task-Priorities) ·
  [tags](https://help.clickup.com/hc/en-us/articles/6304056754583-Intro-to-tags) ·
  [Sprints](https://help.clickup.com/hc/en-us/articles/6303974210071-Intro-to-Sprints)
- Content surfaces: [Docs](https://help.clickup.com/hc/en-us/articles/6328174371351-Intro-to-Docs) ·
  [Whiteboards](https://help.clickup.com/hc/en-us/articles/6326615000471-Intro-to-Whiteboards) ·
  [ClickApps](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps)
- Marketing pages: [clickup.com/features](https://clickup.com/features) ·
  [views](https://clickup.com/features/views) ·
  [dashboards](https://clickup.com/features/dashboards) ·
  [custom fields](https://clickup.com/features/custom-fields)

Devon repository (read-only, at commit `21f8d86`):
`docs/03-plan/TECH-SPEC.md` · `docs/03-plan/FEATURE-PLAN.md` · `docs/03-plan/backlog.json` (EPIC-017
already owns automations/recurring/templates) · `DESIGN.md` §3, §8 · `agentic/INVARIANTS.md` ·
`MODULE-GUIDE.md` · `packages/db/src/schema/{work,app,structure,personal,projects,pages,analytics}.ts` ·
`packages/contracts/src/{filter-grammar,permissions,field-tiers}.ts` ·
`apps/web/src/features/work/{manifest.tsx,components/*}` · `apps/web/src/features/{home,analytics}/*` ·
`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/final/*.png`.

## 14. Open questions for the head of product (each with a default)

1. **Person custom fields at all?** They are the item closest to the I-2 line. *Default if unanswered:
   ship them, capped at 10, with the blocklist enforced server-side and every head-only read audited.*
2. **Is the workload view visible to members?** *Default: yes* — `FEATURE-PLAN.md` says analytics
   belongs to everyone, and a load view people cannot see becomes a thing done to them.
3. **Does the focus list ever become visible to a bo'lim boshlig'i?** *Default: opt-in per person, off.*
4. **Estimates in hours only, or also in "kun"?** *Default: stored in minutes, displayed in the unit
   the department's work schedule implies (8h = 1 kun).*
5. **Does A2's saved-view tab strip replace `/work/mine` as a route?** *Default: no — `/work/mine`
   stays as a stable URL and a `⌘K` target (I-13); the toggle simply navigates to it.*
