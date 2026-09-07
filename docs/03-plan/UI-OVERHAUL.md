# UI/UX overhaul brief (2026-09-07)

The product is functionally complete after the blitz (two waves, eight side sessions, two
integration passes). It looks like software built module by module. This pass makes it look and feel
like one product that a civil servant recognises in ten seconds and enjoys using all day.

The CTO's instruction, verbatim in spirit: follow Jakob's Law; use the many open-source products and
libraries that already solved each screen; make it stunning; use animation and transition generously.

## 1. Principles (binding for every agent in the pass)

1. **Jakob's Law.** Users spend most of their time on other products. Every screen follows the
   conventions of the product people already know for that job (table in §2). We do not invent
   navigation, we do not move buttons where nobody expects them, we do not rename known concepts.
2. **Stunning, then calm.** First impression must be "wow" (auth, Home, empty states, celebrations,
   page transitions). Repeated actions (opening a card, switching a tab, selecting a row) stay at
   `--dur-micro` so the wow never becomes friction. Motion is everywhere, but never in the way.
3. **Motion is feedback, not decoration.** Every animation answers "what just happened" or "where did
   this come from". Enter/exit, reorder, state change, progress, success, error: all animated.
   Reduced motion replaces motion with crossfade, never with silence.
4. **One system.** Every screen uses the same page header, list rhythm, card, detail panel, empty /
   loading / error / no-permission states, and the same motion catalogue (§3). No screen invents.
5. **Four locales, two themes, two widths.** Every change is checked in uz-Latn and ru, light and dark,
   1440 and 390. Uzbek strings are longer than English: layouts must survive +40 %.
6. **Real content.** Empty states teach the next action with one button. Illustrations are open-licence
   SVG recoloured to tokens (unDraw, Open Peeps, Humaaans), never stock photos, never clip-art.
7. **Tokens only.** No raw colours, no ad-hoc shadows, no per-screen font sizes. New tokens go into
   `packages/ui/src/styles/tokens.css` and DESIGN.md, then get used.

## 2. Jakob's Law map: what each screen must feel like

| Screen | People know it from | Conventions we adopt |
|---|---|---|
| Shell (sidebar, top bar) | Linear, Notion, Huly (open source), Vercel | Left sidebar with grouped items and counts, collapsible to icons with tooltips, active item is a morphing pill; top bar with quick-add, search/`⌘K`, inbox bell with badge, avatar menu top-right; page header = title + description + primary action + tabs |
| Command palette | Raycast, Linear | Sections (Recent, Navigate, Actions, People, Cards), icons, keyboard hints, fuzzy match, arrows + Enter, Esc closes, opens on `⌘K` and `/` |
| Auth (login, register, setup, join) | Linear, Vercel, Notion | Centered card on an ambient gradient; single column; inline validation; password strength meter; the one ministry-navy touchpoint |
| Home | Linear "My issues", Notion home, Google Workspace | Greeting by time of day, "due from me / needs my decision / around me" tiles, pinned charts, everything staggers in |
| People board | Trello, Jira board, Plane (open source) | Columns with sticky headers and counts, cards with label bar + avatar + due chip + checklist fraction, drag with ghost and drop settle, inline "+ Add card" at the column foot, column collapse, WIP hints |
| Card detail | Linear, Jira | Two-column: title + description + checklist + comments on the left; properties (assignee, giver, dates, priority, labels, watchers, project) on the right; opens as a routed panel over the board, full page on 390; every property inline-editable; activity timeline collapsible |
| Table view | Linear list, Notion table, Airtable | Dense rows, sticky header, column sort, inline edit, group by, saved views, bulk bar with undo |
| Calendar | Google Calendar | Month/week/day, Today button, arrows, event chips with colour by category, click to peek, drag to reschedule |
| Timeline | Jira Timeline, Plane Gantt | Rows per card/project, bars with start/due, today line, zoom, drag ends |
| Filters | Linear filters | Chips with type-ahead, "+ Filter" popover, saved views as tabs, URL is the state |
| Projects | Linear projects, Asana | Project cards with progress ring and pulse, project page with objective/subjective task tabs, members strip, milestones |
| Events | Luma, Meetup, Google Calendar invite | Cover illustration, big date block, RSVP segmented control, attendees avatar stack with count, capacity meter, comments, carpool and poll widgets as cards |
| Inbox | Linear inbox, Gmail | Left list with unread dot and reason chip, right detail; mark read, archive, keyboard j/k; grouped by reason |
| Personal workspace | Things 3, Todoist, Pomofocus, Excalidraw | Today view first; nested checkbox tasks with indent, drag; sprint header with goal and progress ring; Pomodoro ring with big time and one button; canvas is Excalidraw |
| Structure / org chart | Miro org charts, Lucidchart | Tree with unit colours, vacancies dashed, zoom/pan, click to open unit, drag to move |
| People directory | Slack members, Google Contacts | Search first, cards with avatar/title/unit, hover card with contact actions |
| Departments hub / join | Slack workspaces, Discord invite | Create or join choice as two big cards; invite link with copy + QR; pending request state with a friendly illustration |
| Analytics | Vercel Analytics, Tremor dashboards, Plane analytics | KPI tiles with delta arrows, chart cards with owner question, filter bar, date range presets, export menu |
| Pages | Notion | Block editor with slash menu, page tree, cover, version history in a side panel |
| AI helpers | Notion AI, Linear AI, GitHub Copilot previews | Sparkle button near the input; preview in a panel with Accept / Edit / Discard; never auto-applies |
| Settings (account, department, inbox prefs) | Vercel, Linear settings | Left sub-nav, sections as cards, save per section with toast, danger zone at the bottom |
| Super admin console | Vercel dashboard, Supabase, Grafana | Overview with health tiles, tables with filters and status pills, row drawer for detail, destructive ceremonies as full dialogs |
| Onboarding | Notion, Slack | Checklist card on Home with progress, each item one click away |
| Toasts / undo | Linear, Gmail | Bottom-centre or bottom-right, undo with a shrinking progress bar |
| Shortcuts overlay | Linear `?` | Grouped two-column list of shortcuts |

## 3. Motion catalogue (foundation ships it; every area uses it)

| Surface | Motion | Token |
|---|---|---|
| Route change | View Transitions crossfade + 8 px slide (feature-detected), AnimatePresence fallback | `--dur-page`, `--ease-emphasized` |
| Lists, grids, tiles | Stagger 24 ms, fade + rise 8 px on first render and on filter change | `--dur-enter`, `--ease-out` |
| Cards | Hover lift −2 px + shadow step; press scale 0.98 | `--dur-micro` |
| Board drag | Pointer-following spring; drop settle; column highlight; ghost at 0.9 | `spring.drag`, `spring.settle` |
| Sidebar active item, tabs | Morphing pill / underline via shared layout | `spring.settle` |
| Dialog | Scale 0.96 → 1 + backdrop blur fade; Sheet spring from edge | `spring.sheet` |
| Checkbox / task done | Check draws in; 12-particle burst from the box; text strikes through | `--dur-celebration` |
| RSVP yes, card done, sprint complete | Celebration moment (burst + toast) | `--dur-celebration` |
| Counters, KPI tiles | NumberFlow ticker | default |
| Charts | Draw-in on mount, hover crosshair | 600 ms once |
| Skeleton → content | Shimmer then crossfade, layout matched | `--dur-enter` |
| Toast | Slide up, undo progress bar shrinking | `--dur-enter` |
| Inbox badge | Pop on increment | `--dur-micro` |
| Pomodoro | Animated ring stroke, phase colour crossfade | 1 s per tick |
| Theme toggle | Icon morph; circular reveal from the button when View Transitions exist | `--dur-page` |
| Collapsibles, accordions | Height auto animation | `--dur-enter` |
| Buttons | Loading spinner morph, success check morph | `--dur-micro` |
| Empty states | Illustration idle float 4 s loop, stops under reduced motion | ambient |
| Auth, hub | Ambient slow gradient drift (only here), stops under reduced motion | ambient |
| Hover cards (people, cards) | Fade + 4 px rise, 150 ms open delay | `--dur-micro` |
| Command palette | Scale-in, items highlight, results re-stagger on query change | `--dur-micro` |

Rules kept from DESIGN.md: no parallax, no bounce above 0.1 outside celebrations, nothing repeated
animates slower than `--dur-micro`, `prefers-reduced-motion` replaces, never removes, feedback.

## 4. Open-source references to use (adapt code under their licences; pin exact versions)

Libraries: `motion` (motion.dev, React), `@number-flow/react`, `cmdk`, `sonner`, `vaul`,
`react-day-picker`, Radix primitives, `@tanstack/react-virtual`, Recharts, Tiptap, Excalidraw,
`lucide-react`. Component recipes: shadcn/ui, Magic UI, Aceternity UI, Origin UI, Tremor, Untitled
UI (free set). Products to study for conventions and craft: Huly, Plane, Twenty, cal.com,
Formbricks, Documenso, Dub, AppFlowy, Linear (patterns only), Vercel (patterns only). Motion craft:
animations.dev (Emil Kowalski), Josh Comeau on springs, Rauno Freiberg's interaction notes.
Illustrations: unDraw, Open Peeps, Humaaans (recolour to tokens).

## 5. Areas for the parallel wave (one agent, one worktree each)

| Area | Owns | Must not touch |
|---|---|---|
| `shell-auth-home` | `apps/web/src/shell`, `apps/web/src/routes`, `apps/web/src/lib`, `features/accounts`, `features/home`, shared catalogue keys `shell.*`, `auth.*`, `home.*` | other feature folders, `packages/ui` |
| `work-projects` | `features/work`, `features/projects` and their message files | shell, `packages/ui`, other features |
| `events-inbox` | `features/events`, `features/inbox` | shell, `packages/ui`, other features |
| `personal` | `features/personal` | shell, `packages/ui`, other features |
| `structure-departments` | `features/structure`, `features/departments` | shell, `packages/ui`, other features |
| `analytics-pages-ai-admin` | `features/analytics`, `features/pages`, `features/ai`, `features/admin` | shell, `packages/ui`, other features |

A wave agent that needs a new shared primitive builds it inside its own feature's `components/`
folder and says so in its result; the merge agent promotes duplicates into `packages/ui`.

## 6. Definition of done for the pass

- Every route renders with the new shell, page header and states; no screen keeps the old look.
- Every item in §3 exists in `packages/ui` and is used by at least one screen.
- Screenshots of every route at 1440/390 × light/dark × uz-Latn/ru exist under
  `agentic/ledger/ui-blitz/<ts>/` (captured by a Playwright script committed to `e2e/`).
- A designer critique found no SEV1 (broken layout, unreadable text, missing state) after the fix round.
- Fast gates green, bundle within budget (`agentic/gates.json`), axe zero serious/critical on
  the primary flows, reduced motion verified once per motion type.
- DESIGN.md v2 records the tokens, the motion catalogue, the Jakob map and the screen recipes.
