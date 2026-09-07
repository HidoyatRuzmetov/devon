# Devon design system

Version 2.0, 2026-09-07 (v1.0 2026-09-05). Binding for `wp-designer` (specs) and `wp-ui`
(implementation); checked by `wp-qa-visual` and `wp-a11y-i18n`. Evidence:
`docs/01-research/design-systems-craft-and-motion.md`, `tech-animation-and-visual-craft.md`,
`uzbekistan-gov-visual-identity-research.md`, `tech-frontend-stack-deep-dive.md`,
`zero-training-ux-and-onboarding.md`, and for v2 `docs/03-plan/UI-OVERHAUL.md` plus
`docs/03-plan/ui-references/*.md`.

**What changed in v2.** The UI overhaul pass (UI-OVERHAUL.md) turned the motion rules into a shipped
catalogue in `packages/ui/src/motion`, added the surface/elevation, focus-ring, ambient and
illustration tokens the catalogue needed, and wrote down two things v1 left to each agent's
judgement: the Jakob's Law map (§8) and the screen recipes (§9). One v1 rule is deliberately relaxed:
"no animated backgrounds" becomes **ambient gradients only on auth and the hub, always
reduced-motion safe** (§2.6). Everything else in v1 stands.

## 1. Identity in one paragraph

Devon looks like a well-run institution's own instrument, not like the ministry's public portal and
not like a startup. Warm paper surfaces, Devon's own navy primary (in the government blue family but
deliberately not the ministry's exact token), one amber accent for wayfinding and "needs attention",
green kept strictly as the meaning of success, a serif display face for headings and a humanist sans
for everything else, small-caps eyebrows for section labels, 8-pt rhythm, restrained shadows, and the
ministry's official navy reserved verbatim for a single official touchpoint (the header hairline and
the "Raqamli texnologiyalar vazirligi tizimi" credit line). Flag colours never appear together as
chrome. Dark mode is a real theme, not an inversion.

## 2. Tokens (DTCG → CSS variables; Tailwind v4 `@theme`)

Palette B ("Navy-led, product-owned blue") from the identity research, chosen by the CTO on
2026-09-05. OKLCH is the source of truth; hex values marked ≈ are close conversions to be regenerated
by Style Dictionary at build time. Per-tenant overrides are limited to `--color-primary*`,
`--color-sidebar*`, the logo and the display name, applied via `data-tenant` on `<html>`.

Everything below lives in `packages/ui/src/styles/tokens.css`. **A component never reaches past a
token for a raw hex, an ad-hoc pixel size or a bespoke shadow.**

### 2.1 Colour, light theme

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `--color-background` | oklch(97% 0.007 88) | `#f7f5f0` | page (warm paper) |
| `--color-foreground` | oklch(24% 0.015 240) | `#192026` | body text |
| `--color-card` | oklch(99% 0 0) | `#fcfcfc` | surfaces |
| `--color-muted` | oklch(94% 0.006 90) | ≈`#ecebe6` | subtle fills, table stripes |
| `--color-muted-foreground` | oklch(50% 0.015 245) | ≈`#5f6873` | secondary text (≥ 4.5:1 on card) |
| `--color-border` | oklch(90% 0.006 90) | `#dfdeda` | hairlines |
| `--color-primary` | oklch(40% 0.090 250) | `#1b4a76` | brand, primary buttons, links |
| `--color-primary-foreground` | oklch(99% 0 0) | `#fcfcfc` | text on primary |
| `--color-accent` | oklch(93% 0.020 250) | ≈`#e2e9f3` | selected rows, hover fills |
| `--color-ring` | oklch(62% 0.090 250) | ≈`#5f88b8` | focus ring |
| `--color-attention` | oklch(74% 0.110 72) | `#d69f58` | amber: escalations, "needs your decision", active nav |
| `--color-success` | oklch(55% 0.130 152) | `#22864a` | done, approved, on track (semantic only) |
| `--color-warning` | oklch(70% 0.120 70) | `#ce9042` | at risk, due soon |
| `--color-destructive` | oklch(52% 0.150 27) | `#af3d36` | blocked, rejected, errors |
| `--color-info` | oklch(55% 0.080 205) | ≈`#3a7d88` | planning, informational (teal, so it never competes with primary) |
| `--color-sidebar` | oklch(22% 0.050 252) | `#071b31` | near-black navy sidebar |
| `--color-sidebar-foreground` | oklch(93% 0.010 240) | ≈`#e7ebf0` | sidebar text |
| `--color-sidebar-accent` | oklch(30% 0.050 252) | ≈`#173252` | sidebar hover/active fill |
| `--color-sidebar-border` | oklch(30% 0.050 252) | — | sidebar hairlines (v2) |
| `--color-sidebar-muted` | oklch(70% 0.020 250) | — | sidebar secondary text, group eyebrows (v2) |
| `--color-official` | oklch(38% 0.143 258.6) | `#013d8c` | ministry navy, verbatim, header hairline + credit only |

Status is never conveyed by colour alone: every status chip carries a label and, on boards, a
leading glyph. Unit identity colours (four sub-departments) are a fixed 8-hue categorical set
generated from OKLCH at L 60 % C 0.09, used only for avatars and unit chips.

### 2.2 Colour, dark theme

Elevation is expressed by lightness tint, not shadow. `--color-background` oklch(18% 0.015 250),
`--color-card` oklch(22% 0.015 250), `--color-muted` oklch(26% 0.015 250), `--color-border`
oklch(32% 0.015 250), `--color-foreground` oklch(93% 0.010 240), `--color-primary` oklch(72% 0.090 250)
(≈`#8db2e0`), `--color-accent` oklch(30% 0.040 250), sidebar oklch(13% 0.030 252). Semantic colours are
re-tuned for contrast (success oklch(72% 0.130 152), warning oklch(80% 0.120 75), destructive
oklch(70% 0.150 27), attention oklch(80% 0.110 72)). Contrast ≥ 4.5:1 body, ≥ 3:1 large/UI, both
themes, verified by Storybook a11y addon.

### 2.3 Typography

| Token | Value |
|---|---|
| `--font-display` | "IBM Plex Serif", "Source Serif 4", Georgia, serif (Cyrillic + Latin Extended; Uzbek modifier letters verified in the Storybook glyph page) |
| `--font-sans` | "Inter", "Golos Text", system-ui, sans-serif |
| `--font-mono` | "IBM Plex Mono", ui-monospace |
| Scale (px/line) | 12/16 caption · 13/18 small · 14/20 body · 16/24 lead · 20/28 h3 · 24/32 h2 · 30/36 h1 (display) · 40/44 hero (Home greeting only) |
| Eyebrow | 11/16, uppercase, letter-spacing 0.08em, muted-foreground |
| Numerals | `font-variant-numeric: tabular-nums` in tables, KPIs, timers |
| Uzbek | `Oʻ` `Gʻ` use U+02BB, `ʼ` U+02BC; input normalises ASCII apostrophes on save; fonts must not be subset below the Spacing Modifier Letters block |

Search and filtering normalise both ways: `normalizeForSearch()` in `packages/ui` strips the whole
apostrophe family and combining marks and lowercases with the `ru` locale, so `o'zbek` finds
`Oʻzbek` and `КАРИМОВА` finds `Каримова`. Every combobox and the command palette use it.

### 2.4 Space, radius, elevation, surfaces, focus, density

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px (`--space-1…10`); 8-pt vertical rhythm.
- Radius: `--radius-sm` 6 px (chips, inputs), `--radius-md` 10 px (cards, menus), `--radius-lg` 14 px
  (sheets, dialogs), full for avatars/pills.
- Elevation: `--shadow-1` 0 1px 2px oklch(0 0 0 / .06); `--shadow-2` 0 4px 12px oklch(0 0 0 / .08);
  `--shadow-3` 0 12px 32px oklch(0 0 0 / .12) (sheets, palette). Dark theme uses tint, shadows at 40 %.
- **Surface scale (v2)** — `--color-surface-1|2|3`. Light mode carries elevation with the shadow
  tokens above and the three surfaces sit near `--color-card`; **dark mode carries it as a lightness
  tint**, because a shadow on a dark ground is invisible. Use `surface-1` for a page-level card,
  `surface-2` for a raised block inside one (popover, KPI tile, board column head, sticky list
  header), `surface-3` for an overlay (dialog, sheet, toast, command palette).
- **Focus ring (v2)** — `--focus-ring-width: 2px`, `--focus-ring-offset: 2px`, colour `--color-ring`.
  One ring everywhere. A component that needs a tighter ring changes the *offset*, never the width,
  and never swaps in an outline of its own.
- Density: `comfortable` (row 44 px) default, `compact` (row 36 px) toggle on tables and boards;
  touch targets ≥ 44 px on mobile, ≥ 24 px everywhere (WCAG 2.2). `DataList`/`DataRow` carry this.
- Layout: sidebar `--width-sidebar` 264 px (rail `--width-sidebar-rail` 64), content
  `--width-content` 1280 / `--width-content-narrow` 960 / `--width-content-prose` 720, detail panel
  `--width-detail-panel` 480, top bar `--height-topbar` 56, mobile tab bar `--height-tabbar` 60;
  breakpoints 1440 / 1024 / 768 / 390. `PageContainer` is the only place these widths are applied.

### 2.5 Motion tokens

| Token | Value | Used for |
|---|---|---|
| `--dur-micro` | 140 ms | press, checkbox, focus ring, hover-reveal, tooltip |
| `--dur-standard` / `--dur-enter` | 220 ms | menus, tabs, status pill, toast enter, list entrance |
| `--dur-page` | 300 ms | route change, drawer/sheet, modal, sidebar collapse |
| `--dur-celebration` | 480 ms one-shot | checkbox-complete micro-burst, RSVP confirm |
| `--dur-ambient` | 24 s | the ambient gradient drift, and nothing else |
| `--ease-out` | cubic-bezier(0.16, 1, 0.3, 1) | anything entering |
| `--ease-in` | cubic-bezier(0.7, 0, 0.84, 0) | exits only |
| `--ease-standard` | cubic-bezier(0.4, 0, 0.2, 1) | in-place changes (colour, width, progress) |
| `--ease-emphasized` | cubic-bezier(0.2, 0, 0, 1) | page-level and View Transitions |
| `spring.settle` | `{type:"spring", visualDuration:0.3, bounce:0}` | drag release, shared layout, reorder |
| `spring.sheet` | `{type:"spring", visualDuration:0.35, bounce:0.05}` | drawers, dialogs |
| `spring.drag` | `{type:"spring", stiffness:500, damping:40, mass:1}` | pointer-following drag |

The same numbers exist twice, on purpose and in sync: as CSS custom properties (for the pure-CSS
transitions and Radix `data-state` keyframes) and as JS constants in `packages/ui/src/motion/
tokens.ts` (because a spring cannot be a CSS value and `motion` wants seconds). Both derive from this
table; changing one without the other is a bug.

Rules: Motion (motion.dev) for JS-state animation, CSS `@starting-style`/keyframes for stateless
enter/exit, View Transitions (feature-detected, router update inside the callback) for routes.
`prefers-reduced-motion` is honoured **per component, by replacing** motion (crossfade, instant
change, static illustration) — never by deleting the feedback. No bounce above 0.1 outside the two
celebration moments; no parallax; no confetti beyond a coin-sized 12-particle burst from the element
itself. Repeated actions (palette open, row select) animate at `--dur-micro` or not at all.

### 2.6 Ambient gradient (v2, replaces v1's "no animated backgrounds")

`--color-ambient-1` (primary family) and `--color-ambient-2` (attention family), rendered by
`<AmbientGradient>` as two very soft, very slow radial washes at 6–10 % alpha behind a 90–110 px
blur, drifting on a 24 s loop.

**Allowed on exactly two kinds of screen: auth (`/login`, `/register`, `/setup`, `/join`) and the hub
(Home, the departments hub).** Never behind a working screen — a board, a table, a form or a detail
panel gets a flat `--color-background` and nothing else. Always `aria-hidden`, always
pointer-transparent, and completely static under `prefers-reduced-motion` (the gradient stays, the
drift stops). If a wash is ever noticeable as movement in peripheral vision it is too strong: turn it
down, it is not a feature.

### 2.7 Illustration palette (v2)

`--color-illustration-ink` (line/primary shape), `--color-illustration-fill` (large soft fill),
`--color-illustration-accent` (the one accent per scene), `--color-illustration-muted` (ground line,
secondary shapes). The twelve SVGs in `packages/ui/src/illustrations` are recoloured to exactly these
four roles and use **no literal colour at all**, so a theme or palette change repaints the set.

Style: open-licence flat vector in the unDraw idiom (unDraw, Open Peeps, Humaaans) — two-tone,
geometric, no gradients, no drop shadows, no faces, no text, one accent per scene, ~4:3 frame, and a
shared ground line so twelve separate drawings read as one set. Never stock photos, never clip-art.
Rendered at ≤ 160 px (DESIGN.md §4), `aria-hidden` (the heading beside it already says the thing),
and wrapped in `<IdleFloat>` on empty states.

## 3. Components (packages/ui)

1. **Primitives.** Button (primary / secondary / ghost / destructive; sm/md/lg; press scale, loading
   spinner morph, success check morph — the label never leaves the box, so the width never jumps),
   IconButton, Input, Textarea (autosize), Combobox (cmdk, async, Uzbek/Cyrillic-safe search),
   Calendar + DatePicker (react-day-picker, week starts Monday, `Intl` month names in all four
   locales, holidays greyed), Checkbox (with the celebration burst, off by default), Switch,
   RadioGroup + RadioOption, Chip, FilterChip, Badge (status with glyph), Avatar, AvatarStack,
   Tooltip, Popover, HoverCard, DropdownMenu, Dialog (scale 0.96 + blurred backdrop), Sheet (Vaul,
   left/right/bottom), Toast (Sonner; the undo toast carries a shrinking progress bar), Skeleton
   (shimmer sweep), EmptyState / ErrorState / NoPermissionState / OfflineState (illustration slot,
   exactly one action), OfflineBanner, Kbd, Progress, ProgressRing, Tabs (sliding underline via a
   shared `layoutId`), Breadcrumb, Separator, Card, SectionCard, KpiTile (NumberFlow ticker, delta
   arrow that knows which direction is good, owner question), DataList + DataRow, PageHeader,
   PageContainer, RouteSkeleton, SparkleButton, AiPreviewPanel.
2. **Shell.** Sidebar (grouped entries, counts, morphing active pill, icon rail with tooltips),
   DepartmentSwitcher, SidebarUserBlock, TopBar, QuickAdd, InboxBell, ThemeToggle, SearchTrigger,
   LocaleMenu, AvatarMenu, BottomTabBar (390 px), CommandPalette (cmdk, Raycast sections),
   ShortcutOverlay (`?`), DetailPanel (routed, kept mounted).
3. **Data.** DataTable (TanStack v9 + Virtual), FilterBar, Board, Timeline, Calendar wrapper,
   OrgChart, Chart (Recharts presets, draw-in).
4. **Domain.** TaskCard/TaskRow, ProjectCard, EscalationQueueItem, PersonCard, PositionNode,
   RequestForm, ApprovalRow, EventCard, PollWidget, OnboardingPlanBoard, PageEditor, RetroCanvas,
   KudosCard, NotificationRow, AuditRow, TenantThemeEditor.
5. Every component ships with: Storybook stories for all states × light/dark × uz/ru, an axe check, a
   size-limit entry when it pulls a dependency, and a "what it refuses to do" note in its docs.

## 4. States, every screen

Empty (teaches the next action, one button, illustration ≤ 160 px), Loading (skeleton matching the
final layout; nothing under 1 s, skeleton 1–10 s, progress bar beyond), Error (what happened, what to
do, retry, a copyable request id — never a status code), No permission (what this is, who to ask),
Success (toast with undo where reversible), Offline (banner + pending badge on queued writes).
`wp-qa-visual` forces all six through `?__state=`.

## 5. Copy rules (uz-Latn default; uz-Cyrl, ru and en complete)

- Four locales, each 100 % complete; Cyrillic Uzbek generated by transliteration then reviewed by a
  native reader; terminology from the pass recorded in `packages/i18n/TERMS.md`.
- Plain, formal-neutral register; imperative buttons in the polite form ("Yuborish", "Tasdiqlash",
  "Saqlash"); no jargon (never "sprint", "epic", "ticket"); numbers with locale separators; dates
  `DD.MM.YYYY`, times 24 h, `Asia/Tashkent`.
- Names: "Familiya Ism Otasining ismi" in formal contexts, "Ism Familiya" in casual lists.
- Plurals: Uzbek single form with numeral ("5 ta topshiriq"); Russian four categories, enforced by CI.
- Terminology from `uzbekistan-context.md` (84 terms): task = vazifa, instruction = topshiriq,
  deadline = muddat, approval = tasdiqlash, concurrence = kelishish, leave = ta'til, business trip =
  xizmat safari, unit = bo'lim, employee = xodim, event = tadbir, escalation queue = Ijro nazorati.
- Notifications name the reason first: "Sizga topshirildi:", "Muddati o'tdi:", "Qaror kutilmoqda:".
- Errors say what to do, never blame the user; no exclamation marks; no emoji in system text.
- **Nothing in the shell is ever ellipsized** (enforced by the `devon/no-shell-truncate` ESLint rule
  over `packages/ui/src/shell/**`). Uzbek and Russian run 20–35 % longer than English; the fix for a
  label that does not fit is a *shorter key*, never a clipped one. Where a slot is genuinely fixed
  (the 390 px tab bar), supply a short key and keep the full name as the accessible name.

## 6. Accessibility floor

WCAG 2.2 AA; visible focus everywhere (the ring token); target size ≥ 24 px; a keyboard path for
every primary flow with a documented sequence; ARIA live regions for toasts, DnD and autosave;
dialogs with focus trap and Escape; reduced motion honoured *per component*; 200 % zoom without
horizontal scroll at 1024; screen-reader labels in the active locale; colour never the only signal;
axe 0 serious/critical as a gate.

## 7. Screenshot manifest defaults (for wp-qa-visual)

Widths 1440 / 1024 / 390; themes light / dark; locales uz / ru; states as §4. Routes in
`e2e/routes.json`. File naming `<route>__<width>__<theme>__<locale>.png` under the cycle folder.

---

## 8. Jakob's Law map (v2, binding)

Users spend most of their time on other products. Every screen follows the conventions of the product
people already know for that job. We do not invent navigation, we do not move buttons where nobody
expects them, we do not rename known concepts.

| Screen | People know it from | Conventions Devon adopts |
|---|---|---|
| Shell | Linear, Notion, Huly, Vercel | Full-height left sidebar, grouped items with counts, collapsible to an icon rail with tooltips, active item a morphing pill; workspace (department) switcher at the top, signed-in user at the foot; top bar over the content column with quick-add, search/`⌘K`, inbox bell, theme, locale, avatar |
| Command palette | Raycast, Linear | Sections (Recent, Go to, Actions, Settings, Account), an icon per row, keyboard hints, fuzzy match, arrows + Enter, Esc closes, opens on `⌘K` and `/` |
| Auth | Linear, Vercel, Notion | Centred card on an ambient gradient; single column; inline validation; the one ministry-navy touchpoint |
| Home | Linear "My issues", Notion home | Greeting by time of day, "due from me / needs my decision / around me" tiles, onboarding checklist, pinned charts, everything staggers in |
| People board | Trello, Jira, Plane | Columns with sticky headers and counts, cards with label bar + avatar + due chip + checklist fraction, drag with ghost and drop settle, inline "+ Add card", column collapse, WIP hints |
| Card detail | Linear, Jira | Two columns: title/description/checklist/comments left, properties right; a routed panel over the board, full page at 390; every property inline-editable; collapsible activity |
| Table view | Linear list, Notion table, Airtable | Dense rows, sticky header, column sort, inline edit, group by, saved views, bulk bar with undo |
| Calendar | Google Calendar | Month/week/day, Today, arrows, chips coloured by category, click to peek, drag to reschedule |
| Timeline | Jira Timeline, Plane Gantt | Rows per card/project, bars with start/due, today line, zoom, drag ends |
| Filters | Linear filters | Chips with type-ahead, "+ Filter" popover, saved views as tabs, the URL is the state |
| Projects | Linear projects, Asana | Project cards with a progress ring, project page with task tabs, members strip, milestones |
| Events | Luma, Meetup | Cover illustration, big date block, RSVP segmented control, attendee stack with count, capacity meter, comments, carpool and poll widgets as cards |
| Inbox | Linear inbox, Gmail | Left list with unread dot and reason chip, right detail; mark read, archive, keyboard j/k; grouped by reason |
| Personal workspace | Things 3, Todoist, Pomofocus, Excalidraw | Today first; nested checkbox tasks with indent and drag; sprint header with goal and progress ring; Pomodoro ring with big time and one button; canvas is Excalidraw |
| Structure | Miro org charts, Lucidchart | Tree with unit colours, vacancies dashed, zoom/pan, click to open, drag to move |
| People directory | Slack members, Google Contacts | Search first, cards with avatar/title/unit, hover card with contact actions |
| Departments hub | Slack workspaces, Discord invite | Create or join as two big cards; invite link with copy + QR; pending request with an illustration |
| Analytics | Vercel Analytics, Tremor, Plane | KPI tiles with delta arrows, chart cards with the owner's question, filter bar, date presets, export |
| Pages | Notion | Block editor with slash menu, page tree, cover, version history in a side panel |
| AI helpers | Notion AI, Linear AI, Copilot | Sparkle button near the input; preview panel with Accept / Edit / Discard; never auto-applies |
| Settings | Vercel, Linear settings | Left sub-nav, sections as cards, save per section with a toast, danger zone last |
| Super admin | Vercel dashboard, Supabase, Grafana | Health tiles, tables with filters and status pills, row drawer, destructive ceremonies as full dialogs |
| Onboarding | Notion, Slack | Checklist card on Home with progress, each item one click away |
| Toasts / undo | Linear, Gmail | Bottom-right (bottom-centre at 390), undo with a shrinking progress bar |
| Shortcuts overlay | Linear `?` | Grouped two-column list |

## 9. Screen recipes (v2, binding)

Six shapes. Every screen in the product is one of them. A screen that thinks it is a seventh is
almost always a first that has not been simplified yet — say so in the result rather than inventing.

### 9.1 Page header
`<PageContainer>` → `<PageHeader eyebrow title description actions tabs>`. Eyebrow = the area,
title = the page (`--font-display`, `text-h1`), description = one line saying what it is for, actions
= one primary plus at most two secondary, tabs = a `<TabsList>` sitting on the header's bottom
hairline. Breadcrumb, when the screen is nested, goes in `above`. Nothing else lives above the
content.

### 9.2 List
`PageHeader` → filter row (`FilterChip`s and a "+ Filter" chip, the URL is the state) → `<DataList>`
of `<DataRow>`s. Rows are 44 px (`comfortable`) or 36 px (`compact`); `leading` carries a checkbox or
avatar, `trailing` a status `Badge` and a due `Chip`; `railClassName` is the unread/overdue signal and
is *always* paired with a text label. The list header is sticky under the top bar. First render and
every filter change re-enter through `<Stagger>`. Bulk selection shows a bar with undo; empty →
`<EmptyState>`; loading → skeleton rows matching the row height, never a spinner.

### 9.3 Board
`PageHeader` with view tabs → horizontal scroll region of columns. Column = sticky head (name, count,
WIP hint, collapse) + cards + an inline "+ Add card" at the foot. Cards lift on hover and scale on
press; drag follows the pointer on `spring.drag`, settles on `spring.settle`, the target column
highlights and the ghost sits at 0.9 opacity; keyboard DnD announces through a live region. Opening a
card routes to the detail panel — it never replaces the board at ≥ 768.

### 9.4 Detail panel
A routed panel (`Sheet side="right"`, `--width-detail-panel`) over the list or board at ≥ 768, a full
page at 390. Left: title, description, checklist, comments. Right: properties, each inline-editable.
Activity is a collapsible timeline (`<Collapsible>`) at the bottom, closed by default. Esc closes;
the underlying list keeps its scroll position.

### 9.5 Settings
`PageHeader` → two columns at ≥ 1024: a left sub-nav (or `TabsList` below that) and a stack of
`<SectionCard>`s. One card per concern, each with its own save button and its own toast. Danger zone
is the last card, `destructive` variant, and every destructive action is a full dialog with a typed
confirmation — never an inline button.

### 9.6 Empty / error / no-permission
`<EmptyState>` / `<ErrorState>` / `<NoPermissionState>` centred in the content area: an illustration
from the set (idle-floating, ≤ 160 px), a display-face title, one line of body, **exactly one**
action. No secondary button, no "learn more" link — anything else is body text. Error adds a
copyable request id; no-permission says what the page is and who to ask.

## 10. Motion catalogue (v2, binding) — what animates, with what, where it lives

Every row exists as a component in `packages/ui/src/motion` (or the primitive named), is used by at
least one screen, and replaces its motion under `prefers-reduced-motion`.

| Surface | Motion | Token | Ships as |
|---|---|---|---|
| Route change | View Transitions crossfade + 8 px slide (feature-detected), AnimatePresence fallback | `--dur-page`, `--ease-emphasized` | `PageTransition`, `startViewTransition` |
| Lists, grids, tiles | Stagger 24 ms, fade + rise 8 px, on first render and on filter change | `--dur-enter`, `--ease-out` | `Stagger` / `StaggerItem` |
| Sections, cards on scroll | Fade + rise, once | `--dur-enter` | `Reveal` |
| First-impression blocks (auth card, Home greeting) | Blur 6 px → 0 + fade + rise | `--dur-enter` | `BlurFade` |
| Cards | Hover lift −2 px + shadow step; press scale 0.98 | `--dur-micro` | `HoverLift`, `PressScale`, `Card interactive` |
| Board drag | Pointer-following spring; drop settle; column highlight; ghost 0.9 | `spring.drag`, `spring.settle` | feature (`work`) |
| Sidebar active item, tabs | Morphing pill / underline via a shared `layoutId` | `spring.settle` | `Sidebar`, `Tabs` |
| Dialog | Scale 0.96 → 1 + backdrop blur fade | `--dur-standard` | `Dialog` |
| Sheet | Spring from the edge, grab handle at the bottom | `spring.sheet` | `Sheet` (Vaul) |
| Checkbox / task done | Check draws in; 12-particle burst from the box; text strikes through | `--dur-celebration` | `AnimatedCheck`, `Celebrate`, `Checkbox celebrate` |
| RSVP yes, card done, sprint complete | Celebration moment (burst + toast) | `--dur-celebration` | `Celebrate` + `toastWithUndo` |
| Counters, KPI tiles | NumberFlow ticker (off under reduced motion) | default | `KpiTile` |
| Charts | Draw-in on mount, hover crosshair | 600 ms once | feature (`analytics`) |
| Skeleton → content | Shimmer sweep then crossfade, layout matched | `--dur-enter` | `Shimmer`, `Skeleton`, `RouteSkeleton` |
| Toast | Slide up; undo with a shrinking progress bar | `--dur-enter` | `Toaster`, `toastWithUndo` |
| Inbox badge | Pop on increment only | `--dur-micro` | `InboxBell` |
| Progress, rings | Arc/bar animates its own value change | `--ease-standard` | `Progress`, `ProgressRing` |
| Pomodoro | Animated ring stroke, phase colour crossfade | 1 s per tick | `ProgressRing` + feature |
| Theme toggle | Icon morph; circular reveal from the button where View Transitions exist | `--dur-page` | `ThemeToggle`, `useViewTransitionTheme` |
| Collapsibles, accordions | Height auto animation | `--dur-enter` | `Collapsible` |
| Buttons | Loading spinner morph, success check morph, press scale | `--dur-micro` | `Button` |
| Empty states | Illustration idle float, 4 s loop | ambient | `IdleFloat` |
| Auth, hub | Ambient slow gradient drift (only here) | `--dur-ambient` | `AmbientGradient` |
| Hover cards | Fade + 4 px rise, 150 ms open delay | `--dur-micro` | `HoverCard` |
| Command palette | Scale-in, row highlight, results re-stagger on query | `--dur-micro` | `CommandPalette` |
| AI preview | Shimmer "streaming feel" while pending, then the result reveals | `--dur-enter` | `AiPreviewPanel` |

**Reduced-motion contract.** `MotionProvider` sets `reducedMotion="user"` at the root, which drops
transforms library-wide. On top of that each piece substitutes a *designed* replacement: a crossfade
(page, stagger, reveal), an opacity dip instead of a press scale, a single ring instead of the
12-particle burst, an instant height change instead of an animated one, a steady tint instead of a
shimmer sweep, a static gradient instead of a drift, a still illustration instead of a float. Nothing
becomes silent. Verify once per motion type per pass.
