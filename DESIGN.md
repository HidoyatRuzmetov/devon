# Devon design system

Version 1.0, 2026-09-05. Binding for `wp-designer` (specs) and `wp-ui` (implementation); checked by
`wp-qa-visual` and `wp-a11y-i18n`. Evidence: `docs/01-research/design-systems-craft-and-motion.md`,
`tech-animation-and-visual-craft.md`, `uzbekistan-gov-visual-identity-research.md`,
`tech-frontend-stack-deep-dive.md`, `zero-training-ux-and-onboarding.md`.

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
| `--color-ring` | oklch(62% 0.090 250) | ≈`#5f88b8` | focus ring (2 px, offset 2 px) |
| `--color-attention` | oklch(74% 0.110 72) | `#d69f58` | amber: escalations, "needs your decision", active nav |
| `--color-success` | oklch(55% 0.130 152) | `#22864a` | done, approved, on track (semantic only) |
| `--color-warning` | oklch(70% 0.120 70) | `#ce9042` | at risk, due soon |
| `--color-destructive` | oklch(52% 0.150 27) | `#af3d36` | blocked, rejected, errors |
| `--color-info` | oklch(55% 0.080 205) | ≈`#3a7d88` | planning, informational (teal, so it never competes with primary) |
| `--color-sidebar` | oklch(22% 0.050 252) | `#071b31` | near-black navy sidebar |
| `--color-sidebar-foreground` | oklch(93% 0.010 240) | ≈`#e7ebf0` | sidebar text |
| `--color-sidebar-accent` | oklch(30% 0.050 252) | ≈`#173252` | sidebar hover/active fill |
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
| `--font-display` | "IBM Plex Serif", "Source Serif 4", Georgia, serif (Cyrillic + Latin Extended; Uzbek modifier letters verified in the Storybook glyph page before phase 1 ships) |
| `--font-sans` | "Inter", "Golos Text", system-ui, sans-serif (Golos Text evaluated for Russian body copy; decision recorded in ADR-010) |
| `--font-mono` | "IBM Plex Mono", ui-monospace |
| Scale (px/line) | 12/16 caption · 13/18 small · 14/20 body · 16/24 lead · 20/28 h3 · 24/32 h2 · 30/36 h1 (display) · 40/44 hero (Home greeting only) |
| Eyebrow | 11/16, uppercase, letter-spacing 0.08em, muted-foreground |
| Numerals | `font-variant-numeric: tabular-nums` in tables, KPIs, timers |
| Uzbek | `Oʻ` `Gʻ` use U+02BB, `ʼ` U+02BC; input normalises ASCII apostrophes on save; fonts must not be subset below the Spacing Modifier Letters block |

### 2.4 Space, radius, elevation, density

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px (`--space-1…10`); 8-pt vertical rhythm.
- Radius: `--radius-sm` 6 px (chips, inputs), `--radius-md` 10 px (cards, menus), `--radius-lg` 14 px
  (sheets, dialogs), full for avatars/pills. (The prototype's 13.6 px is softened to 10 for density.)
- Elevation: `--shadow-1` 0 1px 2px oklch(0 0 0 / .06); `--shadow-2` 0 4px 12px oklch(0 0 0 / .08);
  `--shadow-3` 0 12px 32px oklch(0 0 0 / .12) (sheets, palette). Dark theme uses tint, shadows at 40 %.
- Density: `comfortable` (row 44 px) default, `compact` (row 36 px) toggle on tables and boards;
  touch targets ≥ 44 px on mobile, ≥ 24 px everywhere (WCAG 2.2).
- Layout: sidebar 264 px (collapsible to 64), content max 1280 px, detail panel 480 px; breakpoints
  1440 / 1024 / 768 / 390.

### 2.5 Motion tokens (from the animation research; the contract for every animated line)

| Token | Value | Used for |
|---|---|---|
| `--dur-micro` | 140 ms | press, checkbox, focus ring, hover-reveal, tooltip |
| `--dur-standard` | 220 ms | menus, tabs, status pill, toast enter, inline-edit commit flash |
| `--dur-page` | 300 ms | route change, drawer/sheet, modal, sidebar collapse |
| `--dur-celebration` | 480 ms one-shot | checkbox-complete micro-burst, RSVP confirm |
| `--ease-out` | cubic-bezier(0.16, 1, 0.3, 1) | anything entering |
| `--ease-in` | cubic-bezier(0.7, 0, 0.84, 0) | exits only |
| `--ease-standard` | cubic-bezier(0.4, 0, 0.2, 1) | in-place changes (colour, width, progress) |
| `--ease-emphasized` | cubic-bezier(0.2, 0, 0, 1) | page-level and View Transitions |
| `spring.settle` | `{type:"spring", visualDuration:0.3, bounce:0}` | drag release, shared layout, reorder |
| `spring.sheet` | `{type:"spring", visualDuration:0.35, bounce:0.05}` | drawers, dialogs |
| `spring.drag` | `{type:"spring", stiffness:500, damping:40, mass:1}` | pointer-following drag |

Rules: Motion (motion.dev) for JS-state animation, CSS `@starting-style`/`allow-discrete` for
stateless enter/exit, View Transitions (feature-detected, router update inside the callback) for
routes. `prefers-reduced-motion` is honoured per component by *replacing* motion (crossfade or
instant) rather than deleting feedback. No bounce above 0.1 outside the two celebration moments; no
parallax, no animated backgrounds, no confetti beyond a coin-sized 12-particle burst from the
checkbox itself. Repeated actions (palette open, row select) animate at `--dur-micro` or not at all.

## 3. Components (packages/ui), in build order

1. Primitives: Button (primary / secondary / ghost / destructive; sizes sm/md/lg; loading state),
   IconButton, Input, Textarea (autosize), Select/Combobox (async, keyboard, Uzbek/Cyrillic search),
   DatePicker (uz/ru/en, holidays greyed, week starts Monday), Checkbox (with celebration), Switch,
   RadioGroup, Chip/Tag, Badge (status with glyph), Avatar (initials from three-name rule, unit hue),
   AvatarStack, Tooltip, Popover, DropdownMenu, ContextMenu, Dialog, Sheet (Vaul on mobile), Toast
   (Sonner, undo with progress bar), Skeleton (matched shapes), EmptyState (illustration + one action),
   ErrorState, NoPermissionState, Kbd, Progress, Tabs (sliding underline), Breadcrumb, Separator.
2. Shell: Sidebar (5 areas, counts, tenant switcher, collapse), TopBar (quick-add, `⌘K`, inbox bell
   with reason-grouped drawer, profile), DetailPanel (routed, kept mounted), CommandPalette (cmdk,
   registry-driven, async sources, recent items), ShortcutOverlay (`?`).
3. Data: DataTable (TanStack v9 + Virtual; inline edit, column filters, group, density, bulk bar with
   undo, saved views), FilterBar (grammar-backed tokens with autocomplete), Board (columns, swimlanes,
   WIP limit, keyboard DnD + live region, card covers, checklist fraction), Timeline (SVG roadmap),
   Calendar (FullCalendar 7 wrapper), OrgChart (vendored d3-org-chart, vacancies dashed, keyboard),
   KpiTile (NumberFlow ticker, owner-required), Chart (Recharts presets: bar, line, donut; draw-in).
4. Domain: TaskCard/TaskRow, ProjectCard with PulseInline, EscalationQueueItem, PersonCard with tier
   indicator, PositionNode, RequestForm (leave/trip/other), ApprovalRow (one-tap), EventCard with
   RSVP/capacity meter, PollWidget, OnboardingPlanBoard (30/60/90 columns), PageEditor (Tiptap),
   RetroCanvas (Excalidraw wrapper with sticky/vote/timer), KudosCard, NotificationRow (reason chip),
   AuditRow, TenantThemeEditor.
5. Every component ships with: Storybook stories for all states × light/dark × uz/ru, axe check, a
   size-limit entry when it pulls a dependency, and a "what it refuses to do" note in its docs.

## 4. States, every screen

Empty (teaches the next action, one button, no illustration larger than 160 px), Loading (skeleton
matching final layout; nothing under 1 s, skeleton 1–10 s, progress bar beyond), Error (what happened,
what to do, retry), No permission (what this is, who to ask), Success (toast with undo where
reversible), Offline (banner + pending badge on queued writes). `wp-qa-visual` forces all six.

## 5. Copy rules (uz-Latn default; uz-Cyrl, ru and en complete)

- Four locales, each 100 % complete; Cyrillic Uzbek generated by transliteration then reviewed by a
  native reader; every term chosen from a terminology pass over *actually used* wording in Uzbek
  ministries (job postings, ministry sites, HR forms), not statute language (EPIC-000 deliverable,
  recorded in `packages/i18n/TERMS.md`).
- Plain, formal-neutral register; imperative buttons in the polite form ("Yuborish", "Tasdiqlash",
  "Saqlash"); no jargon (never "sprint", "epic", "ticket"); numbers with locale separators; dates
  `DD.MM.YYYY`, times 24 h, `Asia/Tashkent`.
- Names: "Familiya Ism Otasining ismi" in formal contexts (approvals, org chart), "Ism Familiya" in
  casual lists; initials from given + family names.
- Plurals: Uzbek single form with numeral ("5 ta topshiriq"); Russian four categories, enforced by CI.
- Terminology from `uzbekistan-context.md` glossary (84 terms): task = vazifa, instruction = topshiriq,
  deadline = muddat, approval = tasdiqlash, concurrence = kelishish, leave = ta'til, business trip =
  xizmat safari, unit = bo'lim, employee = xodim, event = tadbir, onboarding = moslashuv dasturi,
  escalation queue = Ijro nazorati, saved = Saqlandi, undo = Bekor qilish.
- Notifications name the reason first: "Sizga topshirildi:", "Muddati o'tdi:", "Qaror kutilmoqda:".
- Errors say what to do, never blame the user; no exclamation marks; no emoji in system text.

## 6. Accessibility floor

WCAG 2.2 AA; visible focus everywhere (ring token); target size ≥ 24 px; keyboard path for every
primary flow with a documented sequence; ARIA live regions for toasts, DnD, and autosave; dialogs with
focus trap and Escape; reduced motion honoured; 200 % zoom without horizontal scroll at 1024; screen
reader labels in the active locale; colour never the only signal; axe 0 serious/critical as a gate.

## 7. Screenshot manifest defaults (for wp-qa-visual)

Widths 1440 / 1024 / 390; themes light / dark; locales uz / ru; states as §4. Routes in
`e2e/routes.json`. File naming `<route>__<width>__<theme>__<locale>.png` under the cycle folder.
