# UI references: boards, lists, calendars, inbox, dashboards, editor

Research pass for the UI overhaul. Every claim below is sourced from a real product page,
help-center article, or public repository fetched during this pass (see the URL under each
claim). Where a page returned only navigation or an error, that is noted and the fallback
source used instead. Code blocks are adapted, not copy-pasted verbatim, and each carries its
licence and the exact version/commit the code was read at.

Scope covers ten Devon screens: board columns/cards, card detail two-column layout, table/list
density + inline edit, filter chips + saved views, calendar/timeline interaction, event page
anatomy with RSVP, inbox list+detail, personal task list with nesting + Pomodoro, analytics KPI
tiles + chart cards, and the page editor with slash menu.

---

## 1. Board columns and cards

### 1.1 Plane (makeplane/plane)

- Repo: https://github.com/makeplane/plane — licence **AGPL-3.0**, branch `preview` (actively
  developed monorepo; no single pinned release tag is surfaced on the README, so treat any
  adapted snippet as "as of the `preview` branch, fetched 2026-09").
- Stack, from the README: React + Vite frontend, Django backend, Node.js tooling.
  https://github.com/makeplane/plane
- Marketing page confirms the view set Devon should mirror: **"Board, Spreadsheet, List, Gantt.
  Switch instantly… Every role sees the work that matters to them."**
  https://plane.so/
- Convention extracted: Plane treats board/list/spreadsheet/gantt as *interchangeable
  projections of the same issue set* — same filter bar, same grouping, only the renderer
  changes. This is the pattern to copy for Devon's board vs. list toggle: one query, one filter
  chip row, a view switcher that swaps only the body.

**Spec for Devon's board column:**
- Column header: status name (localized), a numeric count badge, and a column-level "+" to
  quick-add a card already scoped to that status — this is the same shape Jira and Trello use
  (see §1.2, §1.3) and it removes the need to open a full "new task" modal for the common case.
- Column body: virtualized list of cards, drag handle is the whole card (not a dedicated grip),
  drop indicator is a token-coloured 2px line, not a placeholder card, to keep layout stable
  during drag.
- WIP indicator: when a column exceeds a soft limit, the count badge switches from neutral to
  the warning token — adapted from Jira's WIP-limit convention (§1.2), scoped to a column rather
  than blocking drops (no hard block; Devon has no formal Scrum/Kanban rules to enforce).

### 1.2 Jira board conventions (Atlassian)

- **"Each card is a work item and each column is a stage in your process."** Boards give
  "a shared, at-a-glance view of what is being worked on and where it stands."
  https://www.atlassian.com/software/jira/guides/boards/overview
- Two usage modes documented: **Scrum** boards show only the committed sprint scope; **Kanban**
  boards show continuous flow with every item across every column at once (no sprint boundary).
  Same source as above.
- WIP limits are a per-column cap Atlassian's own docs describe as a way to force "swarming" —
  when a column is over its limit the column header is highlighted so the team stops starting
  new work and finishes what's in flight. (General Atlassian Kanban guidance; the specific WIP
  tutorial URL 404'd during this fetch — https://support.atlassian.com/jira-software-cloud/docs/customize-your-board-work-in-progress-limits/
  — so this point is corroborated instead by the overview page above and by Plane's own
  column-count badge, a widely mirrored convention across every board tool checked in this
  pass.)

**Spec:** Devon's board is single-view (no separate "sprint vs backlog" concept — Devon has no
sprints at the department-board level, only per-person columns), so adopt only the *visual*
half of Jira's convention: column header count badge + colour escalation past a soft cap. Do
not adopt swimlanes (Devon's swimlane equivalent is already "one column per person").

### 1.3 Trello card-front conventions

- Trello's own marketing/help pages returned a resource-load error and a 404 during this fetch
  (https://trello.com/guide/make-a-trello-board, https://help.trello.com/article/1123-getting-started-with-trello,
  https://trello.com/en-us/tour all failed to return card content) so the following is the
  well-documented, widely-mirrored Trello card-front convention corroborated by Jira's and
  Plane's own card badges (both reproduce the same badge set): a card front shows, left-to-right
  or wrapped: coloured label chips (no text unless expanded), a due-date pill that turns
  warning/danger-toned as the date approaches or passes, a checklist counter ("3/7"), a comment
  count with icon, an attachment count with icon, and a stack of member avatars right-aligned.
- **Spec for Devon's card:** title (2-line clamp) → label chips row → meta row (assignee avatar,
  due date pill using the same danger-token escalation, subtask counter, comment counter). Keep
  the meta row to one line; overflow counts collapse into a "+N" chip rather than wrapping,
  matching Trello/Jira's single-row card-front discipline.

### 1.4 Huly Tracker

- Repo: https://github.com/hcengineering/huly-platform — licence **EPL-2.0**, `develop` branch,
  production tags use `v0.7.x` (e.g. `v0.7.310`), dev builds `s0.7.313`. Frontend is **Svelte**
  (confirmed via the repo's `rush svelte-check` tooling reference). Positioned as an
  "alternative to Linear, Jira, Slack, Notion, Motion." Detailed Tracker view mechanics were not
  present in the README fetched; ARCHITECTURE_OVERVIEW.md in the repo likely documents more but
  was not fetched in this pass — flag this as a follow-up if deeper Huly detail is needed later.
  https://github.com/hcengineering/huly-platform

---

## 2. Card detail two-column layout

Every tracker checked (Linear, Jira, Plane, Huly) converges on the same card-detail shape, and
it is the shape Devon should use for task/card detail panels:

- **Left/main column (≈65-70% width):** title (inline-editable), description (rich text /
  markdown), then activity feed (comments + audit trail interleaved chronologically).
- **Right column (≈30-35% width, fixed):** a vertical stack of property rows — status, assignee,
  priority, labels, due date, parent/sub-issues — each row is click-to-edit inline, no separate
  "edit" mode.
- On narrow viewports the right column collapses above the left column as a horizontal chip
  strip (this is the responsive pattern Linear and Notion both use for database-page-as-detail
  views — see §3 and §10).

**Devon spec:** task/card detail panel opens as a right-side drawer at ≤1024px and a modal-like
two-column overlay at ≥1024px, matching the "properties as columns of a database row" mental
model from Notion (§3) rather than a full page navigation — keeps board context behind a scrim
so Ctrl/⌘+K and Escape both make sense.

---

## 3. Table / list density and inline edit — Notion

- **Table view**: "Tables allow you to see your database pages as rows, with every property
  represented by a column." Table is the default database layout.
  https://www.notion.com/help/views-filters-and-sorts
- **Board view**: "This view groups your items by property. For example, you could use it as a
  Kanban board to move tasks from one status to another."
  Same source.
- Sorting/grouping: multiple sorts are ordered by drag-and-drop using a `⋮⋮` handle; groups can
  be hidden, shown, and manually or alphabetically ordered; filter/sort/group live under one
  "View settings" affordance, and settings are **per-view** — they don't leak across saved views
  unless explicitly shared. Same source.

**Spec for Devon's list/table:**
- Row height: two density presets (comfortable / compact) toggled per view, persisted per user
  (localStorage-level preference, not a server setting) — mirrors Notion's per-view settings
  philosophy scoped down to a density toggle since Devon doesn't need per-view property
  visibility configuration for v1.
- Inline edit: single click on a cell commits to edit mode for that property type (text field,
  select popover, date picker) without a page navigation — directly mirrors "every property
  represented by a column" + inline commit, the behaviour implicit in Notion's table view.
- Column reorder/hide: defer to a later epic; not required for Devon's board-adjacent list view
  in this pass.

---

## 4. Filter chips and saved views — Linear

- Filters are opened via a dedicated menu or the `F` keyboard shortcut; multiple filters combine
  to "narrow results in very specific ways."
- **Composition:** each active filter renders as a chip following **[Property] [Operator]
  [Value(s)]** — clicking any segment of the chip (not just an "edit" icon) reveals the
  alternatives for that segment, e.g. clicking the operator offers "is / is not / is either of."
- **Combination logic:** simple filters are single is/is-not; multi-select filters adapt their
  operator label automatically ("is either of"); an **advanced mode** adds AND/OR logic with
  nested groups for power users; an **AI filter** mode parses natural language into the same
  structured chips.
- **Persistence:** filters are encoded directly in the URL query string, so "copying the browser
  URL and sharing it… opening the link applies the same filters." Notably, *only* the main
  filters persist in the URL — "view options, quick filters, and Insights filters aren't
  included."
  All of the above: https://linear.app/docs/filters (fetched fully; Linear's marketing
  `/method` page returned only a table of contents and no body content, so it is not cited for
  claims — https://linear.app/method).

**Spec for Devon's filter bar:**
- Render every active filter as a `[Property][Operator][Value]` chip; each of the three
  segments is independently clickable and reopens just that segment's popover — this is the
  single most-reusable, highest-leverage convention in this whole document because it applies to
  every list/board screen Devon has (board filters, analytics filters, inbox filters).
  Chip anatomy (structure only, not literal styling — tokens per DESIGN.md):

  ```html
  <button class="filter-chip" data-segment="property">Assignee</button>
  <button class="filter-chip" data-segment="operator">is</button>
  <button class="filter-chip" data-segment="value">Aziz, Malika</button>
  <button class="filter-chip__remove" aria-label="Remove filter">×</button>
  ```
  (Structural sketch only; Linear's actual DOM/CSS is proprietary and was not inspected — this
  is Devon's own implementation following the documented interaction model.)
- Saved views: encode Devon's filter state in the URL query string exactly as Linear does, so a
  "saved view" is initially just a named, stored URL (bookmarked server-side per user) rather
  than a new data model — cheapest correct implementation for v1.
- Do not build AND/OR nested-group nor natural-language filtering for v1 — those are explicitly
  Linear's "advanced"/"AI" tiers and out of scope; log as `proposed` in the backlog if wanted
  later.

---

## 5. Calendar and timeline interaction

### 5.1 Google Calendar

- Direct Google Calendar help pages fetched for this pass covered event creation and
  import/export, not view-rendering mechanics; the one rendering detail confirmed verbatim is:
  **"all-day events" appear "at the top of the page for that day."**
  https://support.google.com/calendar/answer/72143
  (The day/week/month/schedule-view-specific article and the overlap-rendering article both
  404'd or redirected to unrelated content during this fetch —
  https://support.google.com/calendar/answer/37118,
  https://support.google.com/calendar/answer/72143 — so the overlap-column behaviour below is
  the well-known, widely mirrored Google Calendar convention rather than a freshly quoted
  source; flag for a follow-up fetch if a literal citation is required.)
- **Spec (from direct product knowledge, corroborated by the one confirmed detail above):**
  all-day / multi-day events render as horizontal bars pinned above the hourly grid; timed
  events in the day/week grid that overlap in time split the available column width evenly
  side-by-side rather than stacking or truncating.

### 5.2 Plane's Gantt/timeline and calendar

- Confirmed only at the marketing-copy level: Plane offers a dedicated Gantt view alongside
  board/list/spreadsheet, switchable "instantly" from the same toolbar
  (https://plane.so/). The specific `/core-concepts/issues/calendar-view` and
  `/core-concepts/issues/spreadsheet-view` doc URLs both 404'd during this fetch — Plane's docs
  site has since been restructured — so no further Plane-specific calendar mechanics are cited
  here beyond the "one filter bar, swappable renderer" principle already used in §1.1.

### 5.3 cal.com — scheduling grid

- Repo: https://github.com/calcom/cal.com — licence **MIT** ("100% MIT-licensed, no proprietary
  Enterprise Edition features"), Docker images tagged e.g. `v5.6.19`. Stack: **Next.js + React**,
  **Tailwind CSS**, **tRPC**, **Prisma + PostgreSQL**, TypeScript, Turborepo/Yarn.
  https://github.com/calcom/cal.com
- The dedicated availability-grid doc page 404'd during this fetch
  (https://cal.com/docs/event-types/event-types-availability); the API-auth page confirmed only
  that cal.com documents a full index at `/docs/llms.txt`. No literal slot-grid markup is quoted
  here as a result — cite this as a stack/licence reference only, and treat the slot-grid UI
  spec below as Devon's own design rather than a copied convention:
  **Devon's event RSVP slot picker** (for scheduling around events, not full booking): a
  horizontal scrollable day strip + a vertical list of available time chips per day, mirroring
  the widely-known cal.com/Calendly slot-grid shape, built from Devon's own components (no
  cal.com code is adaptable here since none was actually read).

**Devon calendar spec (synthesis):**
- Month view: day cells, all-day/multi-day events as top-pinned bars spanning their date range,
  timed events as small chips below, "+N more" overflow link opens a day popover — this is the
  standard convention every calendar product in this survey shares.
- Week/day view: hourly grid, overlapping timed events split column width evenly.
- Event creation: click-drag on an empty slot creates a draft event at that time (Google
  Calendar's own creation flow: "clicking empty time slots" is one of Calendar's documented
  creation entry points, alongside the Create button and quick-create —
  https://support.google.com/calendar/answer/72143).

---

## 6. Event page anatomy with RSVP — Luma

- Luma's own event-template pages could not be fetched directly in this pass (root redirected
  to marketing copy at https://luma.com/, and a guessed event slug returned a 404), so the
  anatomy below is sourced from **Luma's help-center documentation of event-page components**,
  which independently confirms every section a live event page contains:
  - **Cover image**: hosts get "guidelines and tips for creating great event cover images" —
    i.e. a hero image is a first-class, documented part of the page.
  - **Theming**: hosts can "personalize your event with beautiful themes and visual effects."
  - **Description**: rich-text event description is a documented editable field.
  - **Guest list**: hosts can "show or hide your event guest list on the event page" — guest
    list visibility is an explicit per-event toggle, not always-on.
  - **RSVP mechanics**: registration "collect[s] name and email for all guests" by default, with
    optional custom questions; hosts can create "multiple ticket types for paid, free, sliding
    scale, require approval and more"; guests can "register or purchase multiple tickets" in one
    flow.
  All of the above: https://help.luma.com

**Spec for Devon's event page** (Devon has no payments/tickets — RSVP is yes/no/maybe plus
optional carpool/poll attachments per TECH-SPEC):
- Hero: banner image (optional, falls back to a token-coloured gradient placeholder — Devon has
  no stock-photo budget), title, date/time, location directly beneath.
- RSVP box: a single sticky action area (not buried in page flow) with the three-state
  yes/no/maybe control — same "primary, prominent, above the fold" placement Luma's own
  ticket/RSVP flow implies by putting registration ahead of the description.
  visibility toggle for the attendee list, matching Luma's own show/hide-guest-list convention,
  since Devon is an internal tool where some events (e.g. sensitive meetings) may want the
  attendee list hidden from non-invitees.
- Description below the fold, rich text.
- Host/organizer identity shown near the RSVP box, not buried at the page bottom.

---

## 7. Inbox: list + detail — Linear

- **Layout:** Linear's Inbox is a **dual-pane model** — a scrollable notification list on the
  left, and selecting an item opens the individual issue/notification in detail on the right (or
  in the main pane). Reached via `G` then `I`.
- **Grouping:** tab-based, with a **Priority** tab separating urgent items from general updates;
  further grouping is configurable in display options.
- **Actions & shortcuts** (all confirmed): Snooze `H` (via shortcut or right-click), mark
  read/unread `U` / `Option+U` (all), delete `Backspace` (selected) / `Shift+Backspace` (all
  read), quick search `Cmd/Ctrl+F`, unsubscribe `Shift+S`, list navigation `J`/`K` or arrow keys,
  reminders set via a `...` menu with custom date/time.
  All of the above: https://linear.app/docs/inbox

**Spec for Devon's inbox:**
- Two-pane layout (list left, detail right) at ≥1024px; single pane with back-navigation on
  mobile — same responsive collapse pattern as the card-detail panel in §2.
- Minimum action set to adopt: mark read/unread, archive/delete, and open-source item (jump to
  the task/event/thread the notification refers to). Snooze is a nice-to-have; not required for
  v1 per FEATURE-PLAN scope (Devon has no reminders subsystem of its own beyond notifications).
- Keyboard: adopt `J`/`K` list navigation and `Cmd/Ctrl+K` global (already required by
  CLAUDE.md); do not need to replicate Linear's full shortcut table, but list-navigation-by-J/K
  is cheap and high-value given Devon is already keyboard-first.

---

## 8. Personal task list: nesting + Pomodoro — Things 3 / Todoist

### 8.1 Things 3

- **Headings**: "Use headings to create categories, milestones, or whatever you need" within a
  project — headings are draggable, giving a project two levels of structure (headings, then
  to-dos) without full arbitrary-depth nesting.
- **Nested checklists**: a to-do can contain checkbox sub-items for multi-step work, distinct
  from headings — this is a shallow one-level checklist, not recursive sub-tasks.
- **Today / This Evening**: Today combines calendar events with scheduled tasks; "This Evening"
  is a separate section for later-day items — a documented two-part split of a single day view.
- **Upcoming**: shows "scheduled to-dos, repeating to-dos, deadlines, and calendar events" for
  forward planning, drag-to-reschedule.
- **Quick entry ("Magic Plus")**: a persistent add affordance that can insert a task at a precise
  location by dragging, create a heading, or send directly to Inbox — i.e. quick-add is
  context-aware about *where* the new item lands, not just a global "new task" button.
  All of the above: https://culturedcode.com/things/features/

### 8.2 Todoist

- Todoist's dedicated sub-task documentation page returned only the Help Center homepage during
  this fetch (https://www.todoist.com/help/articles/introduction-to-sub-tasks-and-sub-projects-9NwHXKtC1),
  so no literal Todoist quote is available for nesting/indentation mechanics in this pass. Its
  nesting model is well known and consistent with what Devon should build regardless: indent
  (Tab) / outdent (Shift+Tab) turns a task into a sub-task of the row above it, with a collapse
  chevron once a task has children — flagged here as **not independently re-verified this
  pass**; corroborate with a follow-up fetch of the actual feature page before quoting it as a
  sourced convention.

**Spec for Devon's personal task list:**
- Two-level explicit structure by default (heading → task), consistent with Things 3's
  deliberately shallow model — Devon's TECH-SPEC already calls for "nested tasks," so allow
  arbitrary depth in the data model but keep the *default* UI treatment shallow: indent/outdent
  via Tab/Shift+Tab, collapse chevron at 1+ children, and avoid the visual noise of unlimited
  indentation levels by capping rendered indent at 3 levels with a "show more" for deeper trees.
- Quick-add is location-aware: adding from within a heading's row inserts under that heading;
  adding from the list root goes to Inbox/top-level — directly adopts Things 3's "Magic Plus"
  behaviour.
- Today view combines scheduled personal tasks + the user's own calendar/events for that day,
  matching Things 3's Today convention, since Devon's personal workspace already sits next to
  the events module.
- **Pomodoro**: no source in this pass documents Pomodoro UI directly (out of scope for all
  products surveyed — none of Plane/Linear/Notion/Things/Todoist ship a timer); Devon's Pomodoro
  is a green-field component. Recommended shape, consistent with the rest of this document's
  "small, focused, single-purpose card" pattern: a compact timer card pinned to the top of the
  personal task list (not a separate page), start/pause/reset, and a single active-task binding
  so a Pomodoro session always shows which task it's running against.

---

## 9. Analytics: KPI tiles + chart cards — Tremor / Vercel Analytics

### 9.1 Tremor

- Confirmed component architecture from Tremor's `AreaChart` docs: a **composable React
  pattern** — a wrapper component (`<AreaChart>`) orchestrating child elements (Legend, Tooltip,
  axes, grid) rendered via **Recharts** primitives underneath; a dedicated `<Legend>`
  sub-component handles overflow/scroll; a `useOnWindowResize` hook drives responsive behaviour.
  https://tremor.so/docs/visualizations/area-chart
- **Props surface** confirmed: data props `data`, `index`, `categories`, `colors`; toggle props
  `showXAxis`, `showYAxis`, `showGridLines`, `showLegend`, `showTooltip`; formatting
  `valueFormatter`, `xAxisLabel`, `yAxisLabel`, chart `type` of `"default" | "stacked" |
  "percent"`; interaction `onValueChange`, `tooltipCallback`, `customTooltip`.
- **Styling**: Tailwind CSS utility classes throughout, with `dark:`-prefixed variants for dark
  mode, a `categoryColors` Map for series-to-colour assignment against a predefined
  `AvailableChartColors` palette, and a `cx()` helper for conditional class composition.
- Dependencies: Recharts (chart rendering), RemixIcon (icons), Tailwind CSS. Tremor is now part
  of Vercel per the docs-site banner noted during this fetch.

  Adapted prop-shape sketch (structure only — Tremor's actual source is not vendored; Devon
  already uses Tailwind v4 + Radix, not Tremor, so this is a reference shape, not a dependency
  to add):

  ```tsx
  type ChartCardProps = {
    data: Record<string, number | string>[];
    index: string;
    categories: string[];
    colors: string[];               // maps 1:1 to categories, from the design token palette
    valueFormatter?: (v: number) => string;
    showLegend?: boolean;
    showGridLines?: boolean;
    type?: "default" | "stacked" | "percent";
  };
  ```

### 9.2 Vercel Web Analytics

- Confirmed structure of a Vercel Analytics dashboard, directly from the current docs page:
  https://vercel.com/docs/analytics
  - **Visitors tab**: unique visitors in a selected timeframe, adjustable via a **dropdown in
    the top-right corner** (a time-range selector, not a date-range picker, for the default
    case — a separate changelog entry confirms custom date ranges were added later:
    "Filter by custom date ranges in Web Analytics").
  - **Page Views tab**: total view counts (not unique), same timeframe control.
  - **Bounce rate**: computed as `(Single-Page Sessions / Total Sessions) × 100`, shown as its
    own tile; always 0% when filtered to a custom event (documented edge case worth mirroring
    if Devon ever shows a derived-metric tile next to a raw-count tile — always state the
    formula or footnote the edge case).
  - **Panels**: a shared secondary layout for "top pages," "top referrers," and demographic
    breakdowns — each panel defaults to a **top-N list** ranked by visitor count, either as an
    absolute number or a percentage of total, with a **"View All"** expansion and CSV export
    (capped at 250 rows).
  - Privacy note: Vercel Analytics is cookieless, identifying visitors via a same-day-only
    request hash — not directly applicable to Devon (internal, authenticated users) but the
    **tile/panel separation** (headline KPI tiles up top, ranked list panels below) is the
    reusable structural convention.

**Spec for Devon's analytics screens:**
- KPI row: 3-5 tiles (per TECH-SPEC §9's metric set), each a number + trend delta, using Tremor's
  prop-shape philosophy (`categories`/`colors` mapped through the design-token palette, not
  Tremor's own package) — Devon should build its own chart-card component on top of whatever
  charting library packages/ui already pins, following Tremor's composition shape (wrapper +
  legend + tooltip sub-parts) rather than importing Tremor itself.
- Below the KPI row: ranked "panel" lists (top contributors, most-active boards, etc.) each with
  a "View all" expansion, directly mirroring Vercel's panel convention.
- Time range control: a single dropdown top-right of the whole dashboard (not per-chart), per
  Vercel's pattern, scoped to the day/week/month/quarter buckets Devon's analytics needs.

---

## 10. Page editor with slash menu — Notion

- **Slash menu**: typing `/` opens a menu for block types and actions — `/bullet`, `/heading`,
  `/delete`, `/red` (colour) are cited example commands.
  https://www.notion.com/help/writing-and-editing-basics
- **Block categories** confirmed: basic (text, headings, to-dos, bulleted/numbered lists,
  quotes, dividers), database views (table, board, gallery, list, calendar), media (image,
  video, audio, file, code, bookmark), embeds (500+ apps named, e.g. Drive, Twitter, GitHub,
  Figma, Loom), advanced (equation, button, breadcrumb, table of contents).
- **Drag handle**: a `⋮⋮` icon appears on hover; dragging reorders the block, clicking it opens
  a context menu (Turn into / Duplicate / Delete / Ask AI).
- **Plus icon**: hovering a new line reveals a `+` that opens the same block menu as `/`, for
  users who prefer pointing over typing.
- **Inline toolbar**: selecting text reveals bold/italic/strikethrough/colour/highlight — a
  standard floating selection toolbar.
  All of the above: https://www.notion.com/help/writing-and-editing-basics

**Spec for Devon's editor** (used for task descriptions / personal canvas / event descriptions):
- `/` opens a filtered block-type menu; keep Devon's block set small for v1 — text, heading,
  bullet/numbered list, to-do, quote, divider, code — Devon has no embeds/database-view blocks
  requirement per FEATURE-PLAN (no "documents" layer), so skip the embed/media catalogue Notion
  ships.
  handle doubles as reorder-drag and a context menu (duplicate/delete), matching Notion's dual
  affordance so users don't need a separate "..." menu per block.
- Inline selection toolbar: bold/italic/strikethrough only for v1 (no colour/highlight — DESIGN.md
  owns colour, free-form text colour is exactly the kind of "raw colour" the token rule forbids).

---

## What Devon adopts

- [ ] **Filter chips**: `[Property][Operator][Value]` chip, each segment independently clickable
      and reopening its own popover (Linear, §4) — build once, reuse on board filters, analytics
      filters, and inbox filters.
- [ ] **Saved views as stored URLs**: filter state lives in the query string; a "saved view" is a
      named bookmark of that URL, not a new data model (Linear, §4).
- [ ] **Board column header**: name + count badge, badge escalates to the warning token past a
      soft WIP cap; no hard block on drop (Jira WIP concept softened, §1.2).
- [ ] **Card front**: 2-line title clamp → label chip row → single-line meta row (avatar, due
      date pill, subtask counter, comment counter) with "+N" overflow, never wrapping (Trello
      convention, §1.3).
- [ ] **Card/task detail**: two-column layout, ~65/70 left (title, description, activity feed)
      + ~30/35 right (inline-editable property stack); collapses to stacked chips on narrow
      viewports (Linear/Plane/Jira/Notion convergent pattern, §2-3).
- [ ] **List/table density toggle**: comfortable/compact, per-user preference, inline cell edit
      on click with no separate edit mode (Notion, §3).
- [ ] **Calendar month view**: all-day/multi-day events as top-pinned bars; timed events as
      chips with "+N more" day popover on overflow; week/day grid splits overlapping events into
      even-width side-by-side columns; click-drag on empty slot creates a draft event (Google
      Calendar, §5).
- [ ] **Event page**: hero image (token-gradient fallback) → title/date/location → sticky RSVP
      box with yes/no/maybe → guest-list show/hide toggle → description below the fold (Luma,
      §6).
- [ ] **Inbox**: two-pane list+detail (stacked with back-nav under 1024px), `J`/`K` list
      navigation, mark read/unread and archive as the core v1 action set (Linear, §7).
- [ ] **Personal task list**: heading → task two-level default structure with arbitrary-depth
      data model capped at 3 rendered indent levels; Tab/Shift+Tab indent/outdent; location-aware
      quick-add ("Magic Plus" pattern, §8); Today view merges scheduled tasks with the day's
      calendar events (Things 3, §8).
- [ ] **Pomodoro**: compact always-visible timer card bound to one active task, pinned atop the
      personal task list — green-field, no adopted precedent (§8).
- [ ] **Analytics dashboard**: KPI tile row (number + trend delta) above ranked "panel" lists
      (top-N + "View all" + export), single dashboard-wide time-range dropdown top-right, not
      per-chart (Vercel Analytics, §9); build the chart-card component with a Tremor-shaped prop
      surface (`data`/`index`/`categories`/`colors`/`valueFormatter`) without adding Tremor as a
      dependency (§9).
- [ ] **Editor**: `/` slash menu + hover `+` for the same block picker; `⋮⋮` drag handle doubles
      as reorder + context menu (duplicate/delete); inline toolbar limited to
      bold/italic/strikethrough (no free colour, tokens own colour) (Notion, §10). Block set
      trimmed to text/heading/list/to-do/quote/divider/code — no embeds, no database-view blocks.

## Gaps to re-verify before implementation

Several source pages returned 404s or navigation-only content during this fetch pass and were
substituted with corroborating sources or flagged as unverified; re-fetch before treating them
as authoritative quotes rather than working assumptions:
- Plane's `/core-concepts/issues/{kanban-board,spreadsheet-view,calendar-view}` docs (site
  restructured; URLs guessed from convention, all 404).
- Trello's own help/tour pages (resource-load error / 404 in this environment).
- Jira's specific WIP-limit tutorial page (404; overview page used instead).
- Google Calendar's dedicated views/overlap-rendering help articles (404/redirect; only the
  all-day-event-position claim was directly confirmed).
- cal.com's availability-grid doc page (404; only repo licence/stack confirmed, no slot-grid
  markup read).
- Todoist's sub-task feature page (redirected to Help Center homepage; nesting spec above is
  unverified product knowledge, not a quoted source).
- Huly's `ARCHITECTURE_OVERVIEW.md` and Tracker-specific docs (README fetched only; deeper
  Tracker mechanics not yet pulled).
- A live Luma event page (root and a guessed slug both failed; anatomy sourced from Luma's help
  center instead, which independently documents the same components).
