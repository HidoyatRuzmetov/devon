# EPIC-000 — Visual and interaction specification

Author: `wp-designer` · Run: 2026-09-05T23:56:19+05:00 · Binding sources: `DESIGN.md` (v1.0),
`agentic/ledger/cycles/EPIC-000/ac.md` (frozen), `docs/00-reference/reference-site-audit.md`,
`docs/03-plan/TECH-SPEC.md` §5, `docs/01-research/{design-systems-craft-and-motion, zero-training-ux-and-onboarding, data-dense-ui-components, uzbekistan-context}.md`.

This document is a specification, not an implementation and not an approval. `wp-ui`/`wp-frontend`
build from it; `wp-qa-visual` and `wp-a11y-i18n` decide whether it was met. The designer neither
writes code nor signs off on its own spec.

---

## 0. What this spec covers, and what it cannot

| AC | Design surface in this spec |
|---|---|
| AC-1 | §4.4 demo chip in the top bar (visible, focusable, explains itself) |
| AC-2 | §4.4 chip absence rule on a non-demo boot |
| AC-3 | §9 copy tables are the source list for the four message catalogues; §9.0 no-literal rule |
| AC-4 | §4.3 locale menu (2 clicks from every shell screen, incl. 390 px and pre-auth screens) |
| AC-5 | §9.0 terminology rules and the "buyruq" refusal; §9 tables are the shell's noun/button inventory |
| AC-6 | §3 width budgets and the no-truncation rule; §12 glyph and formatting Storybook pages |
| AC-7 | §8 six-state system; §6 per-route state definitions; §8.6 the offline/one-action conflict rule |
| AC-8 | §4.2 visible search field with a Kbd hint; §4.3 globe + locale code; §11 zero-training sentences |
| AC-11 | §6.4 `/admin` no-permission state |
| AC-12 | §6.3 `/setup` first-run screen and its consumed (410) state |
| AC-13 | §6.2 sign-out path and the signed-out notice on `/login` |
| AC-9, AC-10, AC-14, AC-15 | **No design surface.** Database grants, RLS, gate profiles and the host sentinel have no user-visible screen in this epic. `wp-pm` should not expect qa-visual evidence for them. |

---

## 1. The surface this epic actually ships

Eight things, no more:

1. **AppFrame** — sidebar / drawer, top bar, main region, toast layer, offline banner.
2. **LocaleMenu** — four locales from the top bar.
3. **SearchOverlay** (`Ctrl/⌘+K`) — the palette, named to the user as *search and actions*.
4. **StateBlock** family — Empty, Loading (skeleton), Error, NoPermission, Offline, plus Toast for success.
5. **`/`** — Home.
6. **`/login`** and sign-out.
7. **`/setup`** — first-run super admin bootstrap and its consumed state.
8. **`/admin`** — permission-guarded, minimal system-status content for `super_admin`.
   Plus **`/404`**.

### 1.1 Refusals (recorded so they are not "missing")

- **No KPI tiles, no dashboard.** Nothing in EPIC-000 is actionable, so no number appears. The
  reference prototype's four Overview cards are the destination, not this epic. A number that nobody
  can act on is decoration.
- **No inbox bell, no notification badge, no department switcher, no profile page.** Their routes and
  data do not exist. **Rule: a nav item or a chrome control exists only when its destination renders
  real content.** Later epics register their own entries into the nav registry.
- **No product tour, no welcome modal, no "coming soon" cards.** The empty states are the onboarding
  (`zero-training-ux-and-onboarding.md` §2, [ADOPT] 2).
- **No confirm dialog anywhere in this epic**, including sign-out.

---

## 2. Foundations applied (token names only, per `DESIGN.md` §2 — no raw hex appears in this spec)

| Use | Token |
|---|---|
| Page ground | `--color-background`; dark theme swaps values, never inverts |
| Cards, top bar fill | `--color-card`, hairline `--color-border` |
| Sidebar | `--color-sidebar`, `--color-sidebar-foreground`, active fill `--color-sidebar-accent` |
| Official touchpoint | `--color-official`, used exactly twice: the 1 px top-bar bottom hairline and the sidebar credit line. Nowhere else. |
| Primary action | `--color-primary` / `--color-primary-foreground` |
| Demo chip, active nav marker | `--color-attention` (tinted fill, foreground text) |
| Offline banner | `--color-warning` tint |
| Error state accent, destructive | `--color-destructive` |
| Health "running" chip | `--color-success` (semantic only, never chrome) |
| Focus | `--color-ring`, 2 px, offset 2 px, `:focus-visible` only |
| Type | `--font-display` for h1/h2 only; `--font-sans` for everything else; `--font-mono` for the request id and the setup token |
| Scale | hero 40/44 (Home greeting only), h1 30/36, h2 24/32, h3 20/28, lead 16/24, body 14/20, small 13/18, caption 12/16, eyebrow 11/16 uppercase +0.08em |
| Space | `--space-1…10` (4…64); 8-pt rhythm; no ad-hoc values |
| Radius | `--radius-sm` chips/inputs, `--radius-md` cards/menus, `--radius-lg` sheets/overlay, full for avatars |
| Elevation | `--shadow-1` top bar on scroll, `--shadow-2` menus/popovers, `--shadow-3` overlay/drawer. Dark theme: tint first, shadow at 40 %. |
| Motion | `--dur-micro|standard|page|celebration`, `--ease-out|in|standard|emphasized`, `spring.sheet` |

Density: `comfortable` only in this epic (no table, no board yet). Touch targets ≥ 44 px at 390,
≥ 24 px everywhere.

---

## 3. AppFrame

**Purpose.** Give every screen the same three answers before it says anything else: where am I, in
what language, and how do I find anything.
**Persona question:** "I have just been shown this app — what is this thing and how do I get around?"

### 3.1 Regions and order (DOM order = reading order = Tab order)

1. Skip link (visually hidden until focus): "Asosiy qismga oʻtish".
2. `<header>` **TopBar**, sticky, height 56, `--color-card` fill, bottom hairline 1 px `--color-official`.
3. **OfflineBanner** (conditional), directly under the header, sticky with it.
4. `<nav>` **Sidebar** (or drawer trigger at 390).
5. `<main id="main">`, `scroll-margin-top: 72px` on every focusable descendant (WCAG 2.4.11 — the
   sticky header must never cover a focused element).
6. Toast region (`aria-live="polite"`), bottom-right at ≥ 1024, bottom-centre at 390, above the safe area.
7. Sidebar footer credit line, `--color-official`, caption size: "Raqamli texnologiyalar vazirligi tizimi".

### 3.2 1440 px

- Sidebar 264 px fixed, full height, `--color-sidebar`. Content column max 1280 px, centred, gutters
  `--space-8` (32).
- Top bar: left = sidebar collapse `IconButton` + page eyebrow/title; centre = search trigger (420 px);
  right = demo chip, language button, avatar menu.
- Detail-panel slot (480 px, `DESIGN.md` §2.4) is reserved in the grid but renders nothing this epic.

### 3.3 1024 px

- Sidebar **stays expanded at 264 px**. It does not auto-collapse to an icon rail: an icon-only primary
  nav fails "recognition over recall" and the ≥ 24 px labelled-target rule for our audience
  (`zero-training-ux-and-onboarding.md` §6, [AVOID] 14). The 64 px rail exists only as a user toggle,
  remembered per user.
- Content gutters `--space-6` (24). Search trigger shrinks to 320 px.

### 3.4 390 px

- Sidebar becomes a left drawer (`Sheet`, Vaul), width 300 px, `--shadow-3`, opened by a 44×44 ☰ button.
  Closes on Esc, on backdrop tap, and on navigation.
- Top bar, five targets at 44×44 with `--space-2` gaps: ☰ · wordmark (mark only, no wordtext below
  420 px) · search icon · language button (globe + locale code) · avatar. Total 5×44 + 4×8 = 252 px
  inside a 358 px content width — fits every locale.
- **The language button never moves into the drawer**: AC-4's 2-click rule must hold at 390 from any
  shell screen.
- Demo chip moves below the top bar, right-aligned in the content gutter, using the short label
  ("Demo"), never a truncated long label.
- Content gutters `--space-4` (16). No horizontal scroll at any locale (AC-6).

### 3.5 Width budgets (the anti-truncation contract, AC-6)

Russian and Uzbek run 20–35 % longer than English. Therefore:

- **Nothing in the shell ellipsizes.** No `text-overflow: ellipsis` on nav labels, chips, buttons or
  menu items. If a string does not fit, the fix is a shorter *key* (`nav.admin.short`), never a clip.
- Nav label budget: ≤ 22 characters rendered in ru at 14/20 inside 264 − 2×16 − 24(icon) = 200 px.
- Chip budget at 390: ≤ 10 characters; every chip has a `.short` key.
- Buttons wrap to two lines before they shrink; min button height 40 (44 at 390).
- Long words break with `hyphens: auto` + `overflow-wrap: anywhere` on body copy only.

### 3.6 Sidebar content in this epic

```
[wordmark]                       ← tenant-overridable display name, default per §14 NIT-2
  Bosh sahifa                    ← always
  Boshqaruv                      ← only when the session is super_admin
────────────────────────────────
[avatar] Yusupov A.B.            ← name in "Familiya I.O." form, opens the same menu as the top-bar avatar
Raqamli texnologiyalar vazirligi tizimi   ← credit, --color-official, caption
```

Active item: `--color-sidebar-accent` fill + a 3 px `--color-attention` left marker + `aria-current="page"`.
Colour is never the only signal.

---

## 4. TopBar parts

### 4.1 Page title area

Eyebrow (11/16, uppercase, `--color-muted-foreground`) + page name (16/24 sans, not serif — the serif
display is reserved for the h1 inside `<main>`). At 390 this area is replaced by the wordmark.

### 4.2 Search trigger — the single most important control in this epic

A **field-shaped button**, not an icon: `--color-muted` fill, `--radius-sm`, height 36 (44 at 390),
left search glyph, placeholder-styled label "Qidirish yoki amal", right-aligned `Kbd` showing
**Ctrl K** on Windows/Linux and **⌘ K** on macOS (platform-detected, never both).

Why it looks like a field: AC-8 gives a first-time user 30 seconds and two guesses to find the command
palette. A visible field with the shortcut printed inside it is discovered by *reading*, not guessing.
An icon-only magnifier or a hidden shortcut would fail on the second guess.

At 390 it collapses to a 44×44 icon button; the Kbd hint moves inside the overlay footer.

### 4.3 LocaleMenu

- Trigger: globe glyph **plus the current locale code as text** — `OʻZ` · `ЎЗ` · `RU` · `EN`.
  Never a flag (a flag is a country, not a language, and Russian is not a foreign country here).
  Accessible name: "Interfeys tili".
  The `Oʻ` in `OʻZ` at 12/16 is a deliberate canary: if the font falls back, it is visible in the
  chrome of every screenshot (AC-6).
- Click 1 opens a `DropdownMenu` (`--shadow-2`, `--radius-md`, min-width 232 px, 4 items ≥ 40 px each).
  Click 2 selects. **Two clicks, from every shell screen including `/login`, `/setup` and 390 px.**
- Items are **autonyms, always in their own language, never translated**:
  `Oʻzbekcha (lotin)` · `Ўзбекча (кирилл)` · `Русский` · `English`. Current item carries a check glyph
  and `aria-checked`; the menu is `role="menu"` with `menuitemradio` items.
- The menu contains nothing else. One purpose, two clicks.
- On select: the document `lang` and `dir` update, `<main>` crossfades at `--dur-standard`
  (reduced motion: instant), no page reload, no toast. The change is its own feedback.
- Persistence: signed in → written to the user record; signed out → `wp_locale` cookie, 1 year,
  `SameSite=Lax`. Both are read on boot before first paint to avoid a flash of the wrong language.
  (See §14 SEV3-3: the endpoint this needs is not named in the plan.)

### 4.4 DemoChip (AC-1, AC-2)

- Rendered **only** from the server bootstrap payload flag, never from a client-readable env var, so a
  non-demo boot cannot render it.
- Appearance: `--color-attention` tint fill, `--color-foreground` text, `--radius-sm`, height 24,
  padding `--space-2`, caption size, label "Demo maʼlumotlar" (short "Demo" below 640 px). No icon.
- It is a **button** (focusable, 44 px hit area via padding at 390) that opens a popover:
  "Namoyish rejimi. Bu tizimdagi barcha maʼlumotlar sinov uchun yaratilgan." Esc closes; no action inside.
  A silent unfocusable badge would be invisible to a screen reader on the very screen whose whole job
  is to say "this data is not real".
- Position: top bar, immediately left of the language button, so a header screenshot at any width
  proves AC-1 in one frame.

### 4.5 Avatar menu

Initials from given + family name (`A.Y.`), unit hue from the categorical set. Menu: theme group
(`Yorugʻ` / `Qorongʻi` / `Tizim boʻyicha`, radio), `Klaviatura yorliqlari`, separator, `Chiqish`.
No profile link — the profile page does not exist yet (§1.1).

---

## 5. SearchOverlay (`Ctrl/⌘+K`)

**Purpose.** One place to reach everything, so navigation never has to be guessed.
**Persona question:** "Where is the thing I want?"

- **Never the only path.** Every entry it exposes has a visible control elsewhere
  (`zero-training-ux-and-onboarding.md` [ADOPT] 4). It accelerates; it does not gate.
- ≥ 1024: centred dialog, width 640, top offset 15vh, `--color-card`, `--radius-lg`, `--shadow-3`,
  backdrop 40 % scrim. 390: bottom sheet (Vaul), max-height 60vh so results sit above the on-screen
  keyboard — cmdk publishes no mobile guidance for this, so we specify it and QA tests it
  (`data-dense-ui-components.md` §H).
- Structure: input (48 px, no border, bottom hairline) → grouped list (rows 40 px, group headers at
  eyebrow size) → footer hint bar (caption): `↑↓ tanlash · ↵ ochish · Esc yopish`.
- Groups and items in this epic:
  - **Oʻtish** — Bosh sahifa; Boshqaruv (only if permitted — a hidden item never hints at what exists).
  - **Sozlamalar** — Interfeys tili (opens a nested page listing the four autonyms); Mavzu.
  - **Hisob** — Tizimdan chiqish.
- Filtering is client-side over ≤ 10 items; `shouldFilter` stays on. Async sources arrive with EPIC-004.
- Empty result: "Hech narsa topilmadi" + one action "Qidiruvni tozalash".
- Loading (nested async pages, later epics): three 40 px skeleton rows, never a spinner.

---

## 6. Routes

### 6.1 `/` — Home

**Purpose in one line.** Say who is here, what day it is, and what the one thing they can do is.
**Persona question:** "What is mine this week?" — in EPIC-000 the honest answer is "nothing yet, and
here is how you will find it when there is."

**Layout 1440.** Inside the 1280 content column: eyebrow `BUGUN` → hero greeting (40/44,
`--font-display`) → date line (16/24, `--color-muted-foreground`) → `--space-10` → the state block,
centred in a `--color-card` panel, max-width 560, illustration ≤ 160 px. 1024: greeting drops to h1
30/36. 390: greeting 24/32, panel full-width, illustration 120 px, action button full-width 44 px.

**Copy.** Greeting = time-based + given name and patronymic ("Xayrli kun, Aziz Baxtiyorovich") —
patronymic address is how colleagues speak to each other here; the full formal
"Familiya Ism Otasining ismi" is reserved for approvals and org charts, and "Hurmatli …" is
correspondence register, not a screen greeting. Windows: 05–11 tong, 11–18 kun, 18–23 kech, 23–05
"Assalomu alaykum". Date line: "6-sentabr, shanba" (uz long form puts the year first when the year is
shown: "2026-yil 6-sentabr"), "6 сентября, суббота", "Saturday, 6 September".

**Empty state, three role variants, each with exactly one working action:**

| Session | Title | Action |
|---|---|---|
| member, no department | "Bu yerda sizning ishlaringiz koʻrinadi" | "Qidirishni ochish" (+ Kbd) |
| super_admin | "Tizim ishga tushdi" | "Boshqaruvga oʻtish" |
| demo tenant | "Namoyish boʻlimi tayyor" | "Qidirishni ochish" (+ Kbd) |

The demo variant deliberately shows **no numbers** (§1.1).

**Loading skeleton.** Greeting bar 280×36 `--radius-sm`, date bar 180×16, gap 40, panel block
560×220. Appears only after 400 ms; nothing under 1 s; a real progress bar past 10 s
(`design-systems-craft-and-motion.md` §6).

**Other states.** Error / NoPermission / Offline per §8.

### 6.2 `/login`

**Purpose.** Let a known person in, and say nothing about who exists.
**Persona question:** "How do I get in?"

Centred card, max 400 px, on `--color-background`; minimal top bar (wordmark + language button only).
Order: eyebrow → h1 "Tizimga kirish" (24/32 display) → field "Login yoki e-pochta" → field "Parol"
(reveal toggle, 44 px) → primary button "Kirish", full width → credit line.

- Pristine form **is** the empty state (nothing to teach beyond the two fields).
- Error: one uniform message under the form, `--color-destructive` text + `role="alert"`:
  "Login yoki parol notoʻgʻri". Never "user not found". The single action remains "Kirish".
- Locked: "Hisob vaqtincha bloklandi. 15 daqiqadan soʻng qayta urinib koʻring." (no-permission family).
- Offline: banner + submit disabled with helper text "Aloqa tiklangach, qayta urinib koʻring".
- After sign-out (AC-13): an inline notice above the card, `--color-muted` fill, no toast:
  "Siz tizimdan chiqdingiz". Sign-out itself has **no confirmation dialog**.
- Autofocus the first field; Enter submits; the button shows the loading state in place (never a
  layout jump) and is disabled while pending.

### 6.3 `/setup` — first-run bootstrap (AC-12)

**Purpose.** Turn a one-time URL into the first administrator, once.
**Persona question:** "I just started this thing — who am I?"

Card max 480 px. Eyebrow `BIRINCHI ISHGA TUSHIRISH` → h1 "Tizim administratorini yarating" → body
"Bu havola faqat bir marta ishlaydi." → fields Familiya, Ism, Otasining ismi (ixtiyoriy), Login yoki
e-pochta, Parol (strength meter, 4 segments, labels not colour alone) → primary
"Administratorni yaratish".

- Patronymic is optional free text and accepts both `-ovich/-ovna` and `-oʻgʻli/-qizi` forms.
- Success: the card is replaced in place (no route change) with "Administrator hisobi yaratildi",
  the login shown in `--font-mono` with a copy `IconButton` → toast "Nusxa olindi", and one action
  "Tizimga kirish".
- **Consumed / invalid / already-bootstrapped (410): one identical screen**, identical wording and
  identical render timing for all three, so nothing about existence leaks:
  title "Bu havola allaqachon ishlatilgan", body "Tizim administratori allaqachon yaratilgan.",
  action "Kirish sahifasiga oʻtish".
- Loading, error, offline per §8. No-permission for this route **is** the consumed screen.

### 6.4 `/admin` (AC-11)

**Purpose.** Prove the permission wall exists and is polite about it.
**Persona question:** "Am I allowed in here, and if not, who do I ask?"

- **Not `super_admin`:** the NoPermission state, full stop — server-rendered from a 403, never a
  client-side hide over a payload that arrived anyway. Title "Bu sahifa sizga ochiq emas", body
  "Bu sahifa faqat tizim administratori uchun. Kirish kerak boʻlsa, boʻlim boshligʻiga murojaat qiling.",
  one action "Bosh sahifaga qaytish". No 404, no redirect, no different wording or timing than the
  authorised path's shell paint.
- **`super_admin`:** eyebrow `TIZIM` → h1 "Boshqaruv" → one card "Tizim holati" with three rows
  (API · Maʼlumotlar bazasi · Navbat), each a status chip with a leading glyph and a label
  ("Ishlamoqda" / "Ishlamayapti"), fed by `/readyz`. One action: "Yangilash".
  *Scope note:* this is the smallest honest content for a route that must exist; the admin console is
  EPIC-013. If `wp-lead` rules it out of scope, degrade to the Empty state with title
  "Boshqaruv boʻlimlari keyingi bosqichda qoʻshiladi" and action "Bosh sahifaga qaytish" — but a
  "coming soon" poster is the worse of the two.

### 6.5 `/404`

Title "Sahifa topilmadi", body "Havola eskirgan yoki notoʻgʻri boʻlishi mumkin.", one action
"Bosh sahifaga qaytish". Full shell around it (the user is not lost, only the URL is).

---

## 7. Nav registry (contract for later epics)

The sidebar renders from a registry: `{ id, labelKey, icon, route, visibleWhen }`. An epic adds its
entry in the same change that makes its route render real content. No entry may ship disabled,
greyed, or badged "soon". `wp-qa-visual` can assert: every sidebar item navigates to a route whose
primary state is not Empty-with-no-action.

---

## 8. The six states (AC-7, `DESIGN.md` §4)

Every state block: illustration ≤ 160 px (≤ 120 at 390) or none, h3 20/28 title, body 14/20 max
56 characters per line, **exactly one primary Button**. No secondary button, no "Learn more" link.
Anything else is body text.

### 8.1 Empty — teaches the next action
Names what belongs here and why, then offers the one action. Never "No data".

### 8.2 Loading — skeleton matching the final layout
Blocks in `--color-muted`, `--radius-sm`, at the real dimensions of what is coming. Shimmer 1.4 s
linear, opacity 0.6→1; **static under `prefers-reduced-motion`**. Header-and-footer-only frames are
forbidden (they measurably fail to reduce perceived wait). Delay 400 ms; progress bar past 10 s.

### 8.3 Error — what happened, what to do
Title in plain language, body with the recovery step, action "Qayta urinish". Below the action, caption
size, `--font-mono`: "Soʻrov raqami: 8f3a‑c210". **No stack trace, no SQL, no HTTP code, no
"Error 500".** The request id is selectable text, not a control.

### 8.4 NoPermission — what it is and who to ask
Names the thing generically, names the person to ask ("boʻlim boshligʻi" / super admin), one action
back to a place the user can reach.

### 8.5 Success — toast with undo where reversible
Sonner, `--dur-standard` enter, 5 s dwell with a progress bar, `aria-live="polite"`, hover/focus pauses
the timer, Esc dismisses. Undo where an action is reversible; in this epic only "Nusxa olindi" occurs
(nothing reversible exists yet). The toast never blocks the primary action area at 390.

### 8.6 Offline — and the one-action rule this epic must not fail

The banner and the page state would otherwise put two actions on screen at once, which reads as an
AC-7 disproof. **Rule:**

- If the route can still show cached content: banner **with** its single action "Qayta urinish",
  content below unchanged. The banner is the state.
- If the route has no cached content: banner renders as **status text only, with no button**, and the
  page renders the Offline state block carrying the single action. Exactly one primary action, always.

Banner: full width, 40 px (48 at 390), `--color-warning` tint, `role="status"`, slide-in 220 ms
`--ease-out`, out 140 ms `--ease-in`, none under reduced motion.

---

## 9. Copy (uz-Latn default · uz-Cyrl · ru · en)

### 9.0 Rules that bind every string here

1. **Uzbek is written first and must read as Uzbek**, not as translated English. English is written last.
2. **`buyruq` is banned from the UI.** In a ministry, *buyruq* is a signed order. The command palette is
   therefore never "buyruqlar oynasi"; it is **"Qidirish va amallar"** — search and actions. This is
   the single most important terminology decision in the shell and `TERMS.md` must record it with the
   ministry-source evidence for the word `buyruq`'s official meaning.
3. Buttons use the verbal-noun form ("Kirish", "Chiqish", "Saqlash", "Yuborish"), matching the Russian
   infinitive convention. See §14 SEV3-1 — this conflicts with one research recommendation and needs a
   sourced ruling in `TERMS.md`.
4. Modifier letters are literal: `Oʻ` `Gʻ` use U+02BB, `ʼ` uses U+02BC. Straight quotes in a catalogue
   are a gate failure, not a typo.
5. Uzbek counts: `{count} {singular}` ("5 vazifa"), never `-lar` after a numeral; bare headings take
   `-lar`. Two keys, never one pluralised key.
6. Russian: four plural categories, CI-enforced. Numbers: space thousands, comma decimal in uz/ru.
   Dates DD.MM.YYYY, 24 h, Asia/Tashkent.
7. No exclamation marks, no emoji in system text, no blame, no "utilize"-class words in any locale.

### 9.1 Shell

| key | uz-Latn | uz-Cyrl | ru | en |
|---|---|---|---|---|
| `nav.home` | Bosh sahifa | Бош саҳифа | Главная | Home |
| `nav.admin` | Boshqaruv | Бошқарув | Администрирование | Administration |
| `shell.skip` | Asosiy qismga oʻtish | Асосий қисмга ўтиш | Перейти к содержимому | Skip to main content |
| `shell.credit` | Raqamli texnologiyalar vazirligi tizimi | Рақамли технологиялар вазирлиги тизими | Система Министерства цифровых технологий | A Ministry of Digital Technologies system |
| `shell.menu.open` | Menyuni ochish | Менюни очиш | Открыть меню | Open menu |
| `shell.sidebar.toggle` | Yon panelni yigʻish | Ён панелни йиғиш | Свернуть боковую панель | Collapse sidebar |
| `search.trigger` | Qidirish yoki amal | Қидириш ёки амал | Поиск или действие | Search or action |
| `search.aria` | Qidirish va amallar | Қидириш ва амаллар | Поиск и действия | Search and actions |
| `locale.aria` | Interfeys tili | Интерфейс тили | Язык интерфейса | Interface language |
| `locale.code` | OʻZ | ЎЗ | RU | EN |
| `locale.uzLatn` | Oʻzbekcha (lotin) | Oʻzbekcha (lotin) | Oʻzbekcha (lotin) | Oʻzbekcha (lotin) |
| `locale.uzCyrl` | Ўзбекча (кирилл) | Ўзбекча (кирилл) | Ўзбекча (кирилл) | Ўзбекча (кирилл) |
| `locale.ru` | Русский | Русский | Русский | Русский |
| `locale.en` | English | English | English | English |
| `theme.label` | Mavzu | Мавзу | Тема | Theme |
| `theme.light` | Yorugʻ | Ёруғ | Светлая | Light |
| `theme.dark` | Qorongʻi | Қоронғи | Тёмная | Dark |
| `theme.system` | Tizim boʻyicha | Тизим бўйича | Как в системе | Match system |
| `shortcuts.title` | Klaviatura yorliqlari | Клавиатура ёрлиқлари | Сочетания клавиш | Keyboard shortcuts |
| `account.signout` | Chiqish | Чиқиш | Выйти | Sign out |
| `demo.chip` | Demo maʼlumotlar | Демо маълумотлар | Демо-данные | Demo data |
| `demo.chip.short` | Demo | Демо | Демо | Demo |
| `demo.popover` | Namoyish rejimi. Bu tizimdagi barcha maʼlumotlar sinov uchun yaratilgan. | Намойиш режими. Бу тизимдаги барча маълумотлар синов учун яратилган. | Демонстрационный режим. Все данные в системе созданы для проверки. | Demonstration mode. All data in this system was created for testing. |

### 9.2 Search overlay

| key | uz-Latn | uz-Cyrl | ru | en |
|---|---|---|---|---|
| `cmd.placeholder` | Qidiring yoki amalni tanlang | Қидиринг ёки амални танланг | Найдите или выберите действие | Search or choose an action |
| `cmd.group.goto` | Oʻtish | Ўтиш | Перейти | Go to |
| `cmd.group.settings` | Sozlamalar | Созламалар | Настройки | Settings |
| `cmd.group.account` | Hisob | Ҳисоб | Учётная запись | Account |
| `cmd.item.home` | Bosh sahifaga oʻtish | Бош саҳифага ўтиш | Перейти на главную | Go to Home |
| `cmd.item.admin` | Boshqaruvga oʻtish | Бошқарувга ўтиш | Перейти в администрирование | Go to Administration |
| `cmd.item.locale` | Interfeys tilini oʻzgartirish | Интерфейс тилини ўзгартириш | Изменить язык интерфейса | Change interface language |
| `cmd.item.theme` | Mavzuni oʻzgartirish | Мавзуни ўзгартириш | Изменить тему | Change theme |
| `cmd.item.shortcuts` | Klaviatura yorliqlari | Клавиатура ёрлиқлари | Сочетания клавиш | Keyboard shortcuts |
| `cmd.item.signout` | Tizimdan chiqish | Тизимдан чиқиш | Выйти из системы | Sign out |
| `cmd.empty` | Hech narsa topilmadi | Ҳеч нарса топилмади | Ничего не найдено | Nothing found |
| `cmd.empty.action` | Qidiruvni tozalash | Қидирувни тозалаш | Очистить поиск | Clear search |
| `cmd.hint` | ↑↓ tanlash · ↵ ochish · Esc yopish | ↑↓ танлаш · ↵ очиш · Esc ёпиш | ↑↓ выбрать · ↵ открыть · Esc закрыть | ↑↓ select · ↵ open · Esc close |

### 9.3 Home

| key | uz-Latn | uz-Cyrl | ru | en |
|---|---|---|---|---|
| `home.eyebrow` | BUGUN | БУГУН | СЕГОДНЯ | TODAY |
| `home.greeting.morning` | Xayrli tong, {name} | Хайрли тонг, {name} | Доброе утро, {name} | Good morning, {name} |
| `home.greeting.day` | Xayrli kun, {name} | Хайрли кун, {name} | Добрый день, {name} | Good afternoon, {name} |
| `home.greeting.evening` | Xayrli kech, {name} | Хайрли кеч, {name} | Добрый вечер, {name} | Good evening, {name} |
| `home.greeting.night` | Assalomu alaykum, {name} | Ассалому алайкум, {name} | Здравствуйте, {name} | Hello, {name} |
| `home.empty.member.title` | Bu yerda sizning ishlaringiz koʻrinadi | Бу ерда сизнинг ишларингиз кўринади | Здесь будут ваши задачи | Your work will appear here |
| `home.empty.member.body` | Hozircha hech narsa yoʻq. Istalgan sahifani qidiruv orqali topishingiz mumkin. | Ҳозирча ҳеч нарса йўқ. Исталган саҳифани қидирув орқали топишингиз мумкин. | Пока ничего нет. Любую страницу можно найти через поиск. | Nothing yet. You can find any page through search. |
| `home.empty.action` | Qidirishni ochish | Қидиришни очиш | Открыть поиск | Open search |
| `home.empty.admin.title` | Tizim ishga tushdi | Тизим ишга тушди | Система запущена | The system is running |
| `home.empty.admin.body` | Boʻlimlar hali yaratilmagan. Tizim holatini boshqaruv sahifasida koʻrishingiz mumkin. | Бўлимлар ҳали яратилмаган. Тизим ҳолатини бошқарув саҳифасида кўришингиз мумкин. | Отделы ещё не созданы. Состояние системы можно посмотреть на странице администрирования. | No departments yet. You can check system status on the administration page. |
| `home.empty.admin.action` | Boshqaruvga oʻtish | Бошқарувга ўтиш | Перейти в администрирование | Go to Administration |
| `home.empty.demo.title` | Namoyish boʻlimi tayyor | Намойиш бўлими тайёр | Демонстрационный отдел готов | The demo department is ready |

### 9.4 States

| key | uz-Latn | uz-Cyrl | ru | en |
|---|---|---|---|---|
| `state.error.title` | Maʼlumotlarni yuklab boʻlmadi | Маълумотларни юклаб бўлмади | Не удалось загрузить данные | Could not load the data |
| `state.error.body` | Qayta urinib koʻring. Xatolik takrorlansa, soʻrov raqamini administratorga yuboring. | Қайта уриниб кўринг. Хатолик такрорланса, сўров рақамини администраторга юборинг. | Повторите попытку. Если ошибка повторится, отправьте номер запроса администратору. | Try again. If it happens again, send the request number to your administrator. |
| `state.error.action` | Qayta urinish | Қайта уриниш | Повторить | Try again |
| `state.error.requestId` | Soʻrov raqami: {id} | Сўров рақами: {id} | Номер запроса: {id} | Request number: {id} |
| `state.denied.title` | Bu sahifa sizga ochiq emas | Бу саҳифа сизга очиқ эмас | Эта страница вам недоступна | This page is not open to you |
| `state.denied.body` | Bu sahifa faqat tizim administratori uchun. Kirish kerak boʻlsa, boʻlim boshligʻiga murojaat qiling. | Бу саҳифа фақат тизим администратори учун. Кириш керак бўлса, бўлим бошлиғига мурожаат қилинг. | Эта страница только для администратора системы. Если нужен доступ, обратитесь к начальнику отдела. | This page is for the system administrator only. If you need access, ask your head of department. |
| `state.denied.action` | Bosh sahifaga qaytish | Бош саҳифага қайтиш | Вернуться на главную | Back to Home |
| `state.offline.banner` | Internet aloqasi yoʻq | Интернет алоқаси йўқ | Нет подключения к интернету | No internet connection |
| `state.offline.body` | Oxirgi yuklangan maʼlumotlar koʻrsatilmoqda. | Охирги юкланган маълумотлар кўрсатилмоқда. | Показаны последние загруженные данные. | Showing the last loaded data. |
| `state.offline.empty` | Bu sahifa aloqa tiklangach ochiladi. | Бу саҳифа алоқа тикланганч очилади. | Страница откроется после восстановления связи. | This page will open once the connection is back. |
| `state.loading` | Yuklanmoqda | Юкланмоқда | Загрузка | Loading |
| `state.notfound.title` | Sahifa topilmadi | Саҳифа топилмади | Страница не найдена | Page not found |
| `state.notfound.body` | Havola eskirgan yoki notoʻgʻri boʻlishi mumkin. | Ҳавола эскирган ёки нотўғри бўлиши мумкин. | Ссылка могла устареть или быть неверной. | The link may be out of date or incorrect. |
| `toast.copied` | Nusxa olindi | Нусха олинди | Скопировано | Copied |
| `action.undo` | Bekor qilish | Бекор қилиш | Отменить | Undo |

### 9.5 Sign-in and setup

| key | uz-Latn | uz-Cyrl | ru | en |
|---|---|---|---|---|
| `login.title` | Tizimga kirish | Тизимга кириш | Вход в систему | Sign in |
| `login.identifier` | Login yoki e-pochta | Логин ёки э-почта | Логин или эл. почта | Login or email |
| `login.password` | Parol | Парол | Пароль | Password |
| `login.submit` | Kirish | Кириш | Войти | Sign in |
| `login.error` | Login yoki parol notoʻgʻri | Логин ёки парол нотўғри | Неверный логин или пароль | Incorrect login or password |
| `login.locked` | Hisob vaqtincha bloklandi. 15 daqiqadan soʻng qayta urinib koʻring. | Ҳисоб вақтинча блокланди. 15 дақиқадан сўнг қайта уриниб кўринг. | Учётная запись временно заблокирована. Повторите через 15 минут. | The account is temporarily locked. Try again in 15 minutes. |
| `login.signedOut` | Siz tizimdan chiqdingiz | Сиз тизимдан чиқдингиз | Вы вышли из системы | You have signed out |
| `login.offline` | Aloqa tiklangach, qayta urinib koʻring. | Алоқа тикланганч, қайта уриниб кўринг. | Повторите попытку, когда связь восстановится. | Try again when the connection is back. |
| `setup.eyebrow` | BIRINCHI ISHGA TUSHIRISH | БИРИНЧИ ИШГА ТУШИРИШ | ПЕРВЫЙ ЗАПУСК | FIRST RUN |
| `setup.title` | Tizim administratorini yarating | Тизим администраторини яратинг | Создайте администратора системы | Create the system administrator |
| `setup.body` | Bu havola faqat bir marta ishlaydi. | Бу ҳавола фақат бир марта ишлайди. | Эта ссылка работает только один раз. | This link works only once. |
| `setup.family` | Familiya | Фамилия | Фамилия | Family name |
| `setup.given` | Ism | Исм | Имя | Given name |
| `setup.patronymic` | Otasining ismi (ixtiyoriy) | Отасининг исми (ихтиёрий) | Отчество (необязательно) | Patronymic (optional) |
| `setup.submit` | Administratorni yaratish | Администраторни яратиш | Создать администратора | Create administrator |
| `setup.done.title` | Administrator hisobi yaratildi | Администратор ҳисоби яратилди | Учётная запись администратора создана | The administrator account was created |
| `setup.done.action` | Tizimga kirish | Тизимга кириш | Войти в систему | Sign in |
| `setup.used.title` | Bu havola allaqachon ishlatilgan | Бу ҳавола аллақачон ишлатилган | Эта ссылка уже использована | This link has already been used |
| `setup.used.body` | Tizim administratori allaqachon yaratilgan. | Тизим администратори аллақачон яратилган. | Администратор системы уже создан. | The system administrator has already been created. |
| `setup.used.action` | Kirish sahifasiga oʻtish | Кириш саҳифасига ўтиш | Перейти на страницу входа | Go to the sign-in page |

### 9.6 Administration

| key | uz-Latn | uz-Cyrl | ru | en |
|---|---|---|---|---|
| `admin.eyebrow` | TIZIM | ТИЗИМ | СИСТЕМА | SYSTEM |
| `admin.title` | Boshqaruv | Бошқарув | Администрирование | Administration |
| `admin.health.title` | Tizim holati | Тизим ҳолати | Состояние системы | System status |
| `admin.health.api` | API | API | API | API |
| `admin.health.db` | Maʼlumotlar bazasi | Маълумотлар базаси | База данных | Database |
| `admin.health.queue` | Navbat | Навбат | Очередь | Queue |
| `admin.health.up` | Ishlamoqda | Ишламоқда | Работает | Running |
| `admin.health.down` | Ishlamayapti | Ишламаяпти | Не работает | Not running |
| `admin.health.refresh` | Yangilash | Янгилаш | Обновить | Refresh |

---

## 10. Interaction

### 10.1 Keyboard

Tab order at 1440 on `/`: skip link → sidebar collapse → nav items → search trigger → demo chip →
language → avatar → main h1 region → the single primary action. The drawer at 390 traps focus and
returns it to ☰ on close.

| Shortcut | Does | Discoverable from |
|---|---|---|
| `Ctrl/⌘ + K` | Opens search and actions | Printed in the search field |
| `/` | Focuses the search field | Shortcut overlay |
| `?` | Shortcut overlay | Avatar menu + search overlay |
| `g` then `h` | Home | Shortcut overlay |
| `Esc` | Closes overlay, drawer, menu, popover | Overlay footer hint |

Five shortcuts, no more. Every one has a mouse equivalent. Overlay list: `role="listbox"` with
`aria-activedescendant`; menus are `role="menu"`; dialogs trap focus and restore it to the trigger.

### 10.2 Pointer and touch

Hover fill `--color-accent` at `--dur-micro`. Press: scale 0.98 on buttons at `--dur-micro`. All 390
targets ≥ 44 px with ≥ 8 px separation; the language button and ☰ sit at opposite ends of the top bar
so a thumb cannot hit both.

### 10.3 Motion (each line justified by what it explains)

| Element | Motion | Reduced motion |
|---|---|---|
| Search overlay in | opacity + translateY 8→0 + scale .98→1, `--dur-standard`, `--ease-out`; backdrop 140 ms | opacity only, `--dur-micro` |
| Overlay out | opacity + 4 px down, `--dur-micro`, `--ease-in` | opacity only |
| Menus/popovers | scale .96→1 from the trigger corner, `--dur-micro`, `--ease-out` | opacity only |
| Mobile drawer | `spring.sheet` | opacity + 100 ms |
| Sidebar collapse | width 264→64, `--dur-page`, `--ease-emphasized`; labels crossfade 140 ms | instant width, no crossfade |
| Route change | View Transitions, crossfade `--dur-page`, `--ease-emphasized`, feature-detected | crossfade 100 ms |
| Locale switch | `<main>` crossfade `--dur-standard` — it explains "everything you are reading just changed" | instant |
| Theme switch | no transition; transitions suppressed for one frame to avoid a colour smear | same |
| Offline banner | slide 220 ms in / 140 ms out | instant |
| Skeleton | shimmer 1.4 s linear | static muted blocks |

No bounce, no parallax, no animated backgrounds, no confetti in this epic (nothing here is worth
celebrating yet).

---

## 11. Zero-training test (AC-8)

**What a first-time user says after 30 seconds on `/` in uz-Latn:**
> "Bu mening ish sahifam. Yuqorida qidiruv bor — Ctrl+K bosaman. Oʻng tomonda «OʻZ» yozuvi bor, demak tilni shu yerdan almashtiraman."

What makes it true:
1. The greeting names them, so the screen is obviously *theirs*, not a portal home page.
2. The search control is a **field with the shortcut printed inside it** — read, not guessed. First
   guess succeeds.
3. The language control shows a **language code as text** next to a globe, at the top-right corner
   where every website they use puts it. Second guess is not needed.
4. The empty state's one button repeats the search shortcut, so anyone who missed the top bar meets it
   in the middle of the screen.
5. Nothing else on the screen competes: one primary action, no numbers, no tour, no modal.

---

## 12. Screenshot manifest for `wp-qa-visual`

Output: `agentic/ledger/cycles/EPIC-000/qa-visual/`.
Naming: `<route-slug>__<width>__<theme>__<locale>__<state>.png` (`root` for `/`).

**Routes (`e2e/routes.json`):** `/`, `/login`, `/setup`, `/admin`, `/404`.

### A. Baseline grid — 60 shots
5 routes × {1440, 1024, 390} × {light, dark} × {uz-Latn, ru}, state `default`.
Session: `/` and `/admin` as `super_admin` in demo mode (so the demo chip is in frame).

### B. Forced states — 50 shots (AC-7)
5 routes × {empty, loading, error, denied, offline} at 1440/light/uz-Latn **and** 390/light/ru
(ru at 390 is the worst case for AC-6 truncation).

| State | Forcing method to record in the filename note |
|---|---|
| empty | empty fixture / member session with no department |
| loading | loader delayed 3 s, screenshot at 1.5 s |
| error | API returns 500 |
| denied | member session on `/admin`; consumed token on `/setup` |
| offline | browser context offline, cache cleared |

### C. Locale sweep — 8 shots (AC-4)
`/` at {1440, 390} × light × {uz-Latn, uz-Cyrl, ru, en}, plus one `root__1440__light__ru__after-reload.png`
taken after a full reload and a re-login on the same account.

### D. Shell components — 8 shots
`shell-search-overlay`, `shell-locale-menu`, `shell-avatar-menu`, `shell-shortcut-overlay` at
{1440 light uz-Latn, 390 light ru}.

### E. Header proof — 2 shots (AC-1, AC-2)
`header__1440__light__uz__demo-on.png` (chip present) and `header__1440__light__uz__demo-off.png`
(chip absent on a non-demo boot).

### F. Storybook — 4 shots (AC-6, AC-5)
`storybook-glyphs__{light,dark}.png` — display/sans/mono × 12/14/16/20/30/40 px rendering
`Oʻzbekiston Gʻalaba maʼno sanʼat` and `Ўзбекистон Ғалаба қишлоқ ҳақида`, with a deliberate
fallback-font control row for comparison and a `data-font-loaded` attribute for a `document.fonts.check`
assertion.
`storybook-formatting__{uz,ru}.png` — dates (short and long form), numbers, names in
"Familiya Ism Otasining ismi" and "Familiya I.O." forms, per locale.

**Total: 132 screenshots.**

---

## 13. Handover notes for `wp-ui` / `wp-frontend`

- Components used by name from `DESIGN.md` §3: Button, IconButton, Input, DropdownMenu, Popover,
  Tooltip, Dialog, Sheet, Toast, Skeleton, EmptyState, ErrorState, NoPermissionState, Kbd, Badge,
  Avatar, Separator, Sidebar, TopBar, CommandPalette, ShortcutOverlay.
- **One new component**, `OfflineBanner`, because nothing in §3 covers a sticky, route-independent
  connectivity strip with the conditional-action behaviour in §8.6. It is 40 px of markup and belongs
  in `packages/ui` next to the state blocks.
- **One new pattern**, `NavRegistry` (§7), because the "no dead chrome" rule needs a mechanism, not
  goodwill.

---

## 14. Observations nobody asked for

**SEV3-1 — Button register conflict, unresolved in two binding documents.**
`DESIGN.md` §5 mandates "Yuborish / Tasdiqlash / Saqlash" (verbal noun). `docs/01-research/uzbekistan-context.md` §6
states as a UI-copy *lint rule* that Uzbek imperatives on buttons must take the polite `-ing` form
("Saqlang / Yuboring / Tasdiqlang") and that the bare form reads as blunt. These cannot both hold.
This spec follows `DESIGN.md` (verbal noun) because it parallels the Russian infinitive convention the
same research endorses and matches how Uzbek software UIs actually read. `TERMS.md` must record the
ruling **with a source URL for the button form itself**, or AC-5 will be argued over at adjudication.

**SEV3-2 — Product name conflict.** `CLAUDE.md` and the repo say **WorkPortal**; `DESIGN.md` and the
demo env var (`DEVON_DEMO=1`) say **Devon**. The wordmark in the sidebar cannot be specified until this
is settled. Default assumed here: the wordmark slot is tenant-overridable and ships with the name that
`packages/ui` tokens carry. Someone must pick one, in writing.

**SEV3-3 — AC-4 requires an endpoint nobody listed.** "The choice survives … a new session on the same
account" needs a per-user locale write. `TECH-SPEC` §12 lists no route for it and EPIC-000 ships no
settings page. Safe default assumed: `PATCH /api/v1/me` accepting `{locale}`, audited like any write.
`wp-architect` should confirm before build, or AC-4 fails on the reload evidence.

**SEV3-4 — `TERMS.md` has no tier for derived terms.** AC-5 demands a ministry/job-posting/form source
for every recorded term, but product-only nouns (theme, skeleton, command palette) have no ministry
source and never will. Proposed shape: two tiers — `sourced` (ministry URL required, enforced) and
`derived` (records the analogy plus the ru/en reference used, exempt from the URL check). Without this,
either the file gets fake citations or the shell gets un-recorded words. Both disprove AC-5.

**SEV3-5 — The maintenance stub can already return an undesigned page.** EPIC-000 ships a
`maintenance` plugin stub; the designed 503 page is EPIC-013. If the stub can be switched on in this
epic, a raw 503 is reachable. Mitigation specified: the stub reuses `ErrorState` with a fixed
four-locale message and one action "Qayta urinish". If that is not built, file it as a backlog item
before release, not after.

**SEV3-6 — `/admin` content is the thinnest part of this spec.** §6.4's system-status card sits on the
boundary between "the route must show something real" and EPIC-013's scope. I chose real content over a
"coming soon" poster. If `wp-lead` disagrees, take the documented degrade; do not invent a third option
mid-build.

**NIT-7 — The reference mood was green; the shipping palette is navy.** `DESIGN.md` §1 (Palette B,
CTO decision 2026-09-05) supersedes the prototype's deep green. Watch for the green creeping back
through unit hues or a "warmer" sidebar during implementation: `--color-success` is a meaning, not a
brand colour, and the ministry navy appears exactly twice (§2).

**NIT-8 — The sidebar will look sparse with one or two items at 1440.** That is correct and honest for
a foundation epic. Do not pad it with disabled items, section headers for empty sections, or a
"Coming soon" group. It fills up in EPIC-002 onward.

**NIT-9 — Uzbek Cyrillic is machine-transliterated and unreviewed.** The tables in §9 are my
transliteration; `ac.md` explicitly puts native review out of scope. Two strings I am least confident
in: `state.offline.empty` ("алоқа тикланганч" — likely should be "тикланганда") and
`admin.health.down` ("Ишламаяпти"). Flag for the native-reader pass; do not let the transliteration
script's output ship unread past EPIC-001.

**NIT-10 — The `?` overlay is the only shortcut discovery path for `g h` and `/`.** That is acceptable
at five shortcuts, but the moment the count passes eight, shortcut hints must appear inside menu items
themselves, or AC-8's spirit fails even while its letter passes.

**NIT-11 — Nothing in this epic is undoable, so the undo pattern ships untested against a real user
action.** The Toast component's undo variant should carry a Storybook story and a unit test now, so the
first real reversible action in EPIC-004 does not become the place where the pattern is designed for
the first time.

---

*This spec is not an approval to ship. Verification of its implementation belongs to `wp-qa-visual`,
`wp-a11y-i18n` and `wp-reviewer`; adjudication against the frozen criteria belongs to `wp-pm`.*
