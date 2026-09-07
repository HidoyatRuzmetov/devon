# Shell & navigation — open-source references

Research for the UI overhaul pass (`docs/03-plan/UI-OVERHAUL.md`), scoped to the `shell-auth-home`
area: `apps/web/src/shell`, `apps/web/src/routes`, `apps/web/src/lib`, `features/accounts`,
`features/home`. Every claim below is sourced; code blocks are adaptations we can build from, with
licence and exact pinned version. A final checklist maps each finding to what Devon adopts.

Devon's current shell (`apps/web/src/shell/app-shell.tsx`, `nav.ts`, `command-palette-controller.tsx`,
`use-shell-shortcuts.ts`) already implements a left sidebar, top bar, `cmdk`-based palette and a
shortcuts overlay — the gap this research closes is *polish and completeness against Jakob's Law*,
not architecture from scratch.

---

## 1. Sidebar structure, collapse, active state, counts, department switcher

### Convention (Jakob's Law)

Every product a civil servant would recognise as "serious software" — Linear, Notion, Huly, Vercel,
Twenty — uses a **persistent left sidebar**, grouped into sections, collapsible to an icon rail, with
the active item shown as a filled/pill background rather than an underline (underlines are reserved
for horizontal tab bars). Counts appear as small numeric badges right-aligned in the row, not as
colour alone (accessibility: colour never carries the whole signal — matches Devon's own status-chip
rule in DESIGN.md §2.1).

### Sources

- **shadcn/ui `Sidebar` component** — `https://ui.shadcn.com/docs/components/sidebar` (fetched
  2026-09-07). This is the reference implementation most of the "Linear-style" open-source dashboards
  now copy. Confirmed API surface:
  - `SIDEBAR_KEYBOARD_SHORTCUT = "b"` — toggled with `Cmd/Ctrl+B`.
  - Width constants: `SIDEBAR_WIDTH = "16rem"` (desktop, ≈256px — Devon's spec is 264px, close enough
    to keep Devon's own number rather than copy this one), `SIDEBAR_WIDTH_MOBILE = "18rem"`, exposed
    as CSS custom properties `--sidebar-width` / `--sidebar-width-mobile` so a host app can override
    per-instance (this is exactly the mechanism Devon's `data-tenant` per-tenant override in
    DESIGN.md §2 should reuse for `--color-sidebar*`, not a new mechanism).
  - Components: `SidebarProvider` (context + persisted open state), `Sidebar`, `SidebarHeader`,
    `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`,
    `SidebarMenuButton` (takes `isActive`), `SidebarMenuBadge` (the count/badge slot, rendered as a
    child of `SidebarMenuItem` next to `SidebarMenuButton`), `SidebarMenuSub` (nested items, e.g. a
    project's sub-pages), `SidebarRail` (the thin draggable/clickable strip at the sidebar's edge that
    toggles collapse without a dedicated button), `SidebarTrigger` (the header button, usually paired
    with a breadcrumb).
  - Collapse behaviour: `collapsible="icon"` mode keeps icons visible, hides labels, and shows the
    label as a `Tooltip` on hover — this is precisely the "collapsible to icons with tooltips" line in
    UI-OVERHAUL.md's Jakob map and precisely what Devon's `collapsed` prop on `Sidebar` (in
    `packages/ui`) already targets; the reference confirms tooltip-on-hover-when-collapsed as the
    correct mechanism rather than, e.g., a flyout submenu.
  - Persistence: state survives reload via the `SidebarProvider`'s controlled `open`/`onOpenChange`
    (shadcn's own implementation backs this with a cookie in their template). Devon persists the same
    decision through `localStorage` (`SIDEBAR_COLLAPSED_STORAGE_KEY` in `apps/web/src/shell/app-shell.tsx`)
    — equivalent intent, better fit for a self-hosted SPA with no server-rendered shell to read a
    cookie before first paint.

  Adaptable structural pattern (MIT-licensed shadcn/ui registry code, not copied verbatim since Devon
  already owns its own `Sidebar` in `packages/ui`, but the composition shape is worth confirming
  against):

  ```tsx
  // shadcn/ui sidebar-07 block shape (MIT) — https://ui.shadcn.com/blocks/sidebar
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb>{/* page header title lives here in this pattern */}</Breadcrumb>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4">{/* page content */}</div>
    </SidebarInset>
  </SidebarProvider>
  ```

  Devon's own `TopBar` already plays the role of that `<header>` (leading = sidebar toggle, title =
  wordmark, not a breadcrumb — Devon has no nested-page breadcrumb requirement at shell level, page
  headers carry their own title per UI-OVERHAUL.md §2 "page header = title + description + primary
  action + tabs"). No structural change needed; this only confirms the pairing is conventional.

- **Huly (`hcengineering/platform`)** — `https://github.com/hcengineering/platform` (fetched
  2026-09-07). EPL-2.0 licence. 27.6k stars, Rush monorepo (not directly portable — different build
  tooling), but the *product* is the strongest open-source reference for "many workspaces (Chat,
  Projects, CRM, HRM, ATS) behind one left rail" — the same shape as Devon's own "one sidebar, many
  modules registered by feature" design (`apps/web/src/shell/nav.ts`'s
  `getFeatureSidebarEntries()` pattern already mirrors Huly's plugin-registered navigation, so no
  change is needed there beyond visual polish).

- **Plane (`makeplane/plane`)** — `https://github.com/makeplane/plane` (fetched 2026-09-07). AGPL-3.0.
  React + Vite frontend, Django backend. Positions itself as an open Jira/Linear/Monday alternative;
  its workspace sidebar (grouped: Your work, workspace-level pages, then per-project sections with a
  collapse chevron and issue-count badge next to each project) is the direct model for Devon's
  "People board" and "Projects" Jakob-map rows. Exact package versions were not retrievable from the
  public tree at fetch time (package.json not rendered through the fetch); do not cite specific Plane
  dependency versions — cite the pattern only.

- **Twenty (`twentyhq/twenty`)** — `https://github.com/twentyhq/twenty` (fetched 2026-09-07). Its own
  licence: AGPL-3.0 (core) with an Enterprise addendum for some paths — treat as reference-only, not
  adaptable code, unless the specific file is confirmed AGPL/MIT. Stack confirmed from
  `packages/twenty-front/package.json` (fetched 2026-09-07):
  - `react` / `react-dom`: `^19.2.0`
  - `react-router-dom`: `^6.30.6`
  - `jotai`: `^2.17.1` (state)
  - `@lingui/core` / `@lingui/react`: `^5.9.5` (i18n — Devon uses its own per-module message files
    instead; not adopted)
  - UI: `@mantine/core` / `@mantine/hooks` `^8.3.11`, `@floating-ui/react` `^0.24.3`,
    `@linaria/core` / `@linaria/react` for zero-runtime CSS-in-JS.
  - **Not** using Radix, cmdk, or Emotion — Devon's own choice (Radix + cmdk, already pinned in
    `packages/ui/package.json`) diverges from Twenty here and that's fine: Twenty's command menu is
    built on its own `useCommandMenu` hook, not cmdk, so it is not a source for palette code, only for
    the *department-switcher* idea (see §2) which is stack-agnostic.

### Concrete spec for Devon (confirms/refines existing `packages/ui` `Sidebar`)

- Width 264px expanded / 64px collapsed (already in DESIGN.md §2.4 — kept, not changed by this
  research). Icon rail keeps a `Tooltip` (Radix, already a Devon primitive) showing the label on
  hover/focus, `220ms` delay to avoid flicker on fast pointer travel across the rail (matches
  DESIGN.md's `--dur-standard` for menus; do not use `--dur-micro`, tooltips are not press feedback).
  This is the shadcn `SidebarMenuButton` tooltip behaviour translated to Devon tokens.
- Active item: filled pill (`bg-sidebar-accent`, `radius-md`), not a border-left stripe (border-left
  stripes are a heavier, older pattern — Slack/old Jira; Linear/Huly/Plane all use a filled rounded
  background for the active row, and UI-OVERHAUL.md §2 already specifies "active item is a morphing
  pill", so implement the position of a `layoutId`-shared background rectangle animated with
  `spring.settle` behind whichever `SidebarMenuButton` is active, per the motion catalogue table).
- Counts: a `SidebarMenuBadge`-equivalent, small pill or plain numeral right-aligned in the row,
  muted-foreground colour when the item is inactive, primary-foreground-on-accent when the row is
  active. Never a coloured dot alone for a count — dots without a number are reserved for the inbox
  "unread" indicator (see §7), not sidebar item counts.
- No department switcher exists in Devon's product model — TECH-SPEC's account model is "one account,
  one department, join with a key" (CLAUDE.md: "a fresh account creates a department ... or joins one
  with a key"), so a Twenty/Slack-style workspace switcher dropdown at the sidebar top is **out of
  scope**; do not add one. What Devon's sidebar header shows instead is the wordmark plus (per
  DESIGN.md's `data-tenant` override) the department's own name/logo where themed — a static header,
  not a switcher control. This is a deliberate refusal, not a gap: confirmed against
  `docs/03-plan/FEATURE-PLAN.md`'s "one department per account" model.

---

## 2. Top bar: quick-add, search/⌘K, inbox bell, avatar menu

### Convention

Linear, Vercel and Notion all place, left to right: a menu/collapse control, a page or product title
(sometimes a breadcrumb), then right-aligned a search trigger styled as a fake input
(`⌘K` hint chip inside it), a bell/inbox icon with an unread-count badge, and an avatar that opens a
dropdown (profile, theme, settings, sign out). A "quick add" (new task/new issue) is usually a `+`
icon button immediately left of search, or folded into the command palette's default action list
(Linear folds it into `Cmd+N`, only cal.com and Notion keep a standalone `+`).

### Sources

- **Linear changelog** — `https://linear.app/changelog` (fetched 2026-09-07). Confirmed patterns
  still in active refinement as of the fetch:
  - "Sidebar nav item hover state changes are now instant" — i.e. hover feedback on nav rows should
    have **no transition delay** (0ms or a barely-perceptible one), unlike the active-item pill which
    does animate. Devon's motion catalogue should treat hover fill as instant CSS, and reserve
    `spring.settle` for the *active* indicator only — confirms the distinction already implicit in
    DESIGN.md's "repeated actions... stay at `--dur-micro`."
  - "`Cmd/Ctrl+N` now opens a creation menu contextual to your current view" — this is Linear's answer
    to "quick add": not a separate button, a keyboard shortcut plus the command palette's top action.
    Devon should keep `⌘K` as the single discovery surface for creation (per UI-OVERHAUL.md's
    palette sections: Recent, Navigate, Actions, People, Cards) and skip a redundant standalone
    "+" button in the top bar to avoid two competing entry points for the same action — this is a
    **refusal**: no dedicated quick-add button, `⌘K` → Actions section is quick-add.
  - "Improved command menu to now use fuzzy search" — confirms fuzzy match (not plain substring) is
    now the baseline UX users expect from a `Cmd+K` — `cmdk`'s built-in `command-score` filtering
    already does this by default (see §3), so no extra work, just don't disable/override it.
  - A dedicated **Priority tab in the inbox** separates urgent from routine notifications. This maps
    directly onto Devon's inbox "reason chip" grouping (UI-OVERHAUL.md: "grouped by reason") — the
    Jakob-law refinement is that reason-grouping alone is not enough at scale; a single "needs a
    decision" priority affordance at the top of the list, ahead of the reason groups, matches what
    Linear shipped after user feedback. Worth a follow-up epic note, not an immediate scope add per
    CLAUDE.md's "do not add scope mid-epic."

- **shadcn/ui dashboard block conventions** — `https://ui.shadcn.com/docs/components/sidebar`
  (fetched 2026-09-07) — the paired `<header>` bar sits at `h-16` (64px) with `px-4`, a vertical
  `Separator` between the sidebar trigger and the rest of the bar. Devon's `TopBar` height is not
  respecified here (DESIGN.md doesn't currently pin an explicit top-bar height token) — recommend
  60px to sit on the 8-pt rhythm's near-neighbour while leaving room for 44px touch targets with
  8px padding top/bottom; file as a DESIGN.md token addition if not already present, not a rebuild.

### Concrete spec for Devon (matches what `app-shell.tsx` already does; call out any drift)

- Order confirmed correct in the current implementation: leading (collapse/menu) → title/wordmark →
  search trigger → trailing (demo chip, locale menu, avatar menu). This matches the Linear/Vercel
  convention exactly.
- **Gap found**: there is no inbox bell in `app-shell.tsx`'s `trailing` group yet — only demo chip,
  locale menu and avatar menu render. UI-OVERHAUL.md's Jakob map calls for "top bar with quick-add,
  search/`⌘K`, **inbox bell with badge**, avatar menu top-right." The `events-inbox` area owns
  `features/inbox`, but the bell itself is shell chrome (`shell-auth-home`'s scope) — this pass should
  add a `TopBar` inbox-bell slot (icon button, `Badge`/dot for unread count, opens the reason-grouped
  drawer per UI-OVERHAUL.md's Jakob row for Inbox) between the search trigger and the locale menu,
  matching Gmail/Linear's right-to-left order: search, notifications, account.
- No standalone quick-add button (see Linear finding above) — `⌘K` remains the single creation entry
  point, consistent with what `command-palette-controller.tsx` already wires up.
- Avatar menu: Devon's `AvatarMenu` already covers theme (light/dark/system), shortcuts, sign out —
  matches the Vercel/Linear settings-adjacent pattern of folding preferences into the avatar dropdown
  rather than a separate icon.

---

## 3. Command palette: sections, keyboard model

### Convention

Raycast and Linear are the two products people mean when they say "like Cmd+K" — sectioned results
(recent items float to the top unlabelled or under "Recent"), monospace/soft keyboard-hint chips at
the right edge of each row, arrow-key navigation with wraparound, `Enter` to run, `Esc` to close,
fuzzy matching that re-ranks and re-staggers on every keystroke.

### Sources

- **`cmdk` (pacocoursey/cmdk)** — package already pinned in Devon at `1.1.1`
  (`packages/ui/package.json`, confirmed via `npm view cmdk` → latest `1.1.1`, `2026-09-07`; matches
  what's already installed, so **no version bump needed**). API surface (from the library's own
  README, which Devon's `command-palette-controller.tsx` already consumes):
  `Command`, `Command.Dialog` (wraps a Radix `Dialog` for the desktop variant — matches Devon's
  `variant={isDesktop ? 'dialog' : 'sheet'}` split, where the mobile branch swaps in Vaul's `Sheet`
  instead, a reasonable Devon-specific adaptation `cmdk` itself doesn't prescribe), `Command.Input`,
  `Command.List`, `Command.Group` (the "Recent / Navigate / Actions / People / Cards" sections in
  UI-OVERHAUL.md map 1:1 onto one `Command.Group` each, `heading` prop for the visible label),
  `Command.Item`, `Command.Empty` (the palette's own empty state — still needs the standard Devon
  empty-state copy rules even inside a 1-line palette empty message), `Command.Separator` (a hairline
  between groups, `border-border`). Filtering is fuzzy by default (a bundled `command-score` port)
  and re-sorts on every keystroke — matches Linear's changelog note above; do not pass a custom
  `filter` unless a specific field needs weighting (e.g. matching on a person's role/unit as well as
  name for the People section).
- **Raycast** (`https://www.raycast.com/`, fetched 2026-09-07) — marketing site did not expose palette
  internals in fetched content; the "keyboard-first" framing (function-row-as-hotkeys, always show the
  physical key, never just an icon) supports Devon's existing `ShortcutOverlay`'s two-column grouped
  list approach (already implemented) — no new pattern surfaced beyond what's already built.

### Concrete spec for Devon

- Keep the five sections from UI-OVERHAUL.md as five `Command.Group`s in a fixed order: Recent,
  Navigate, Actions, People, Cards — Recent only rendered when non-empty, others always rendered (with
  `Command.Empty`'s per-group absence handled by simply omitting an empty group, `cmdk` groups with no
  matching items hide themselves automatically when a query is active). Results re-stagger on query
  change per the motion catalogue's "Command palette: results re-stagger on query change" row — this
  is a `--dur-micro` list stagger, not the full list-stagger token used for page-level lists.
- Keyboard-hint chips: use Devon's own `Kbd` primitive (already listed in DESIGN.md §3.1) right-aligned
  in each `Command.Item`, not raw text — this is already implied by the primitive existing, confirming
  it's the right component to reach for here rather than inventing a bespoke span.
- `⌘K` and `/` both open the palette (already in `use-shell-shortcuts.ts` per the `ShortcutOverlay`
  entries listed in `app-shell.tsx`); `Esc` closes; this matches Raycast/Linear exactly and needs no
  change.

---

## 4. Shortcuts overlay

### Convention

Linear's `?` overlay is the reference: a modal, two-column grouped list (Navigation / Actions, etc.),
each row is a description with right-aligned `Kbd` chips, opened by `?` from anywhere, closed by `Esc`
or clicking outside.

### Source

- UI-OVERHAUL.md itself already specifies "Shortcuts overlay | Linear `?` | Grouped two-column list of
  shortcuts" — Devon's `ShortcutOverlay` component (in `packages/ui`, consumed in `app-shell.tsx`)
  already exists and is wired to `?`. This research found no reason to change its shape; the current
  shortcut list is thin (5 entries: `⌘K`/`/`, `?`, `g h`, `Esc`) and should grow as other areas ship
  their own shortcuts (e.g. `j`/`k` for inbox nav, once `events-inbox` lands theirs) — each area
  contributes its own entries to the same overlay rather than inventing a second overlay, matching
  the "One system" principle in UI-OVERHAUL.md §1.4.

---

## 5. Page header pattern

### Convention

Linear/Notion/Vercel settings and list pages all use the same header shape: an `h1`-weight title, an
optional one-line description below it in muted-foreground, a primary action button top-right of the
title row, and (when the page has views) a tab row directly beneath, sharing the header's bottom
border as the tab strip's top edge.

### Source

UI-OVERHAUL.md §2 states this directly: "page header = title + description + primary action + tabs."
No new source needed beyond confirming the shadcn/ui dashboard convention
(`https://ui.shadcn.com/docs/components/sidebar`, `SidebarInset` header pattern, fetched 2026-09-07)
uses the same title/action-right arrangement, just paired with a breadcrumb instead of a description
— Devon's variant (description instead of breadcrumb) fits a single-department, no-nested-workspace
product better and is the right refusal to keep.

### Concrete spec

- Title: `text-h2` (24/32, DESIGN.md §2.3), description `text-body text-muted-foreground` directly
  below, primary action a standard `Button` (primary variant) top-right of the title baseline, not
  vertically centred against the description — action height keys to the title's line-box.
  Tabs, when present, use Devon's `Tabs` primitive (sliding underline, already in DESIGN.md §3.1),
  positioned immediately below the header block, sharing its bottom hairline.

---

## 6. Settings layout

### Convention

Vercel's and Linear's settings screens share the same shape: a left sub-navigation (narrower than the
main app sidebar, no icons or small icons, just section labels), content on the right as a stack of
"cards" (one card per logical group of fields), each card saved independently with its own save
button and a toast confirming the save, and a "danger zone" card pinned to the bottom of the relevant
page in `destructive`-bordered styling.

### Sources

- `https://cal.com/docs` (fetched 2026-09-07) — page content available at fetch time was limited to a
  single API-keys mention ("You can view and manage your API keys in your settings page under the
  security tab") — confirms cal.com also uses a **tabbed settings model** (a "security tab" implies
  tab-per-section within settings, consistent with the left-sub-nav pattern even though the fetched
  page didn't render the nav itself), but does not give enough detail to cite further; treat as weak
  corroboration only, not a primary source for cal.com specifics.
- UI-OVERHAUL.md §2 already specifies this exact shape for Settings ("Left sub-nav, sections as cards,
  save per section with toast, danger zone at the bottom") and for the Super admin console ("Overview
  with health tiles, tables with filters and status pills, row drawer for detail, destructive
  ceremonies as full dialogs" — note the super admin's destructive actions use a full **dialog**, not
  inline danger-zone cards, because pause/wipe (TECH-SPEC §11) are instance-wide and need the heavier
  ceremony a modal provides; this is a deliberate, documented distinction between account/department
  settings (cards) and super-admin destructive actions (dialogs), not an inconsistency).

### Concrete spec

No change to the plan already written; this research corroborates it against two more real products
(cal.com's tab-per-section confirmation, Vercel's card-per-group pattern by general product knowledge
already encoded in UI-OVERHAUL.md) and finds no reason to deviate.

---

## 7. Auth screens

### Convention

Linear, Vercel and Notion's login/register screens: a centred card (roughly 400px wide) on a subtle
ambient background (gradient drift or a soft pattern, never a busy photo), single-column form fields,
inline validation (error text directly under the field, not a summary banner unless the error is
account-wide), a password-strength meter on registration only, and the product's wordmark centred
above the card.

### Source

UI-OVERHAUL.md §2 and §3 already specify this: "Centered card on an ambient gradient; single column;
inline validation; password strength meter; the one ministry-navy touchpoint" and the motion catalogue
entry "Auth, hub | Ambient slow gradient drift (only here), stops under reduced motion." Devon's
`AuthShell` (`apps/web/src/shell/auth-shell.tsx`) is the file that should carry this — confirmed as
already the dedicated component; the design brief is precise enough that no further outside research
changes it, beyond noting that the "ambient gradient drift, only here" restriction (no gradient
motion anywhere else in the product) matches how sparingly Linear and Vercel actually use any
background motion — it is exclusively an auth/landing-page device in both, never inside the
authenticated app shell. This confirms Devon's restriction is the correct scope, not overly cautious.

---

## 8. Empty states

### Convention

Notion, Linear and Slack's empty states all follow the same shape: a small (never dominating)
illustration, one sentence explaining what will appear here, and exactly one button that performs the
next action — never two competing CTAs, never a wall of onboarding copy.

### Source

DESIGN.md §4 and UI-OVERHAUL.md §1.6 already state this exactly ("Empty states teach the next action
with one button... open-licence SVG recoloured to tokens (unDraw, Open Peeps, Humaaans), never stock
photos") and cap illustration size at 160px (DESIGN.md §4: "no illustration larger than 160 px").
No source contradicted this; Twenty and Plane's own empty states (observed in general product
knowledge, not independently re-fetched this session since the GitHub README fetches did not surface
in-app screenshots) follow the same one-button convention, corroborating rather than adding anything.

### Concrete spec

- Illustration source: unDraw (MIT-style free licence, recolour via `currentColor`/token override —
  unDraw ships raw SVGs with a customizable accent colour, straightforward to recolour to
  `--color-primary`/`--color-attention` at build time), Open Peeps (CC0/MIT depending on export), or
  Humaaans (free, personal+commercial use per its own licence page) — pick per-scene the illustration
  whose subject best matches the empty state's meaning (person at a desk for "no tasks yet", a stack of
  papers for "no documents"), never reuse the same illustration for unrelated empty states across the
  product (a repeated illustration reads as filler, not as a designed system).
- Idle float animation: 4s ambient loop (already specified, UI-OVERHAUL.md motion catalogue), stops
  entirely under `prefers-reduced-motion` (not crossfaded — an idle loop has no "state change" to
  preserve as feedback, so full removal is correct here, unlike other motions in the catalogue that
  must crossfade rather than vanish).

---

## 9. Toasts

### Convention

Linear and Gmail's toast conventions: bottom-right on desktop (bottom-centre on narrow viewports where
there's no room for a corner toast to avoid overlapping content), an undo action inline in the toast
itself with a visibly shrinking progress bar showing time remaining before the action is finalized.

### Source

- `sonner` (`emilkowalski/sonner`) — already pinned in Devon at `2.0.8`
  (`packages/ui/package.json`; confirmed current latest via npm registry, `2026-09-07`, no bump
  needed). Sonner's own default positioning options include `bottom-right` and `bottom-center`, which
  is exactly what `app-shell.tsx` already wires up
  (`<Toaster position={isDesktop ? 'bottom-right' : 'bottom-center'} />`) — confirms the existing
  choice is correct and idiomatic for the library, not a deviation needing a fix.
- UI-OVERHAUL.md's motion catalogue: "Toast | Slide up, undo progress bar shrinking |
  `--dur-enter`" — sonner supports a custom toast body, so Devon's undo toasts should render their own
  progress-bar element inside the toast content (sonner does not ship a built-in shrinking-bar
  visual; this is a Devon-authored addition on top of sonner's positioning/stacking primitives) driven
  by the same duration as the toast's own dismiss timer so the two stay visually in sync.

---

## What Devon adopts

- [x] Left sidebar, grouped, collapsible to a 64px icon rail with hover tooltips (`Cmd/Ctrl+B` toggle
      idea confirmed as the shadcn convention; Devon's existing collapse button + `localStorage`
      persistence already matches the intent — no rework, just keep it).
- [x] Active sidebar item as a filled, animated (`spring.settle`) pill, not a border stripe.
- [x] Sidebar hover feedback is instant (no transition), distinct from the animated active indicator
      (Linear changelog finding).
- [ ] **Add an inbox bell to the top bar's trailing group** (currently missing from `app-shell.tsx`),
      positioned between the search trigger and the locale menu, badge for unread count, opening the
      reason-grouped drawer.
- [x] No standalone "quick add" button — `⌘K` is the single creation entry point (Linear's `Cmd+N`
      folded-into-palette pattern; explicit refusal, not a gap).
- [x] No workspace/department switcher in the sidebar header — one account, one department is the
      product model; explicit refusal.
- [x] Command palette: five fixed `Command.Group`s (Recent, Navigate, Actions, People, Cards), fuzzy
      match via `cmdk`'s default filtering (already pinned at `1.1.1`, current), `Kbd` chips
      right-aligned per item, dialog on desktop / Vaul sheet on mobile (already implemented).
- [x] Shortcuts overlay (`?`) stays a single, shared, two-column grouped list that every area appends
      to — not a per-area overlay.
- [x] Page header: title + muted description + primary action top-right + tabs sharing the header's
      bottom hairline (no breadcrumb — deliberate divergence from the shadcn dashboard pattern, fits
      Devon's flatter, single-department navigation).
- [x] Settings: left sub-nav, card-per-section, per-card save + toast, danger zone pinned bottom
      (account/department settings); super admin's destructive actions use full dialogs instead of an
      inline danger zone (pause/wipe ceremony, TECH-SPEC §11).
- [x] Auth: centred card, ambient gradient drift exclusive to auth/hub screens, inline validation,
      password-strength meter on registration.
- [x] Empty states: one illustration ≤160px (unDraw/Open Peeps/Humaaans, recoloured to tokens, no
      illustration reused across unrelated empty states), one sentence, one button; idle float
      animation removed (not crossfaded) under reduced motion.
- [x] Toasts: `sonner@2.0.8` (already pinned, current), `bottom-right` desktop / `bottom-center`
      mobile (already implemented), Devon-authored shrinking progress bar for undo actions synced to
      the toast's own dismiss timer.
- [ ] Track, as a backlog note (not this pass's scope per CLAUDE.md "do not add scope mid-epic"): a
      priority-vs-routine split at the top of the inbox drawer, once `events-inbox` ships its reason
      grouping, following Linear's post-launch refinement.

### Packages confirmed at their pinned, current versions (no bump required)

| Package | Devon's pinned version | Registry latest (checked 2026-09-07) | Licence |
|---|---|---|---|
| `cmdk` | 1.1.1 | 1.1.1 | MIT |
| `sonner` | 2.0.8 | 2.0.8 | MIT |
| `vaul` | 1.1.2 | 1.1.2 | MIT |
| `@radix-ui/react-dialog` | 1.1.23 | 1.1.23 | MIT |
| `lucide-react` | 1.41.0 | (in use) | ISC |

### Sources consulted (fetched 2026-09-07 unless noted)

1. `https://github.com/hcengineering/platform` — Huly, EPL-2.0.
2. `https://github.com/makeplane/plane` — Plane, AGPL-3.0.
3. `https://github.com/twentyhq/twenty` — Twenty, AGPL-3.0 (+ enterprise addendum on some paths).
4. `https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-front/package.json` —
   dependency versions.
5. `https://cal.com/docs` — settings/tab reference (limited content returned).
6. `https://ui.shadcn.com/blocks/sidebar` — sidebar block variants, MIT.
7. `https://ui.shadcn.com/docs/components/sidebar` — `Sidebar` component API, MIT.
8. `https://linear.app/changelog` — sidebar hover, `Cmd+N`, fuzzy search, inbox priority tab.
9. `https://www.raycast.com/` — keyboard-first framing (limited palette-internals content returned).
10. `https://registry.npmjs.org/cmdk/latest`, `.../@radix-ui/react-dialog/latest`,
    `.../vaul/latest`, `.../sonner/latest` — exact published versions.
11. `apps/web/src/shell/app-shell.tsx`, `nav.ts` — Devon's current implementation, read to ground
    every "already implemented" / "gap found" claim above in the actual code rather than the plan.
12. `docs/03-plan/UI-OVERHAUL.md`, `DESIGN.md` — binding specs this research corroborates or refines.

Not independently verified this session (cited only as general product knowledge already encoded in
UI-OVERHAUL.md, not re-fetched): Vercel dashboard docs (`vercel.com/docs/dashboard-features` returned
404 at fetch time), Magic UI, Origin UI, cmdk's own docs site (`cmdk.paco.me` redirected to a stale
GitHub path and was not re-fetched). A follow-up pass should re-fetch these before relying on any
specific claim attributed to them.
