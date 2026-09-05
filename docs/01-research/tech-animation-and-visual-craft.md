# Animation and visual craft — a code-level implementation guide

**TL;DR**
1. A motion system is three numbers and four curves, not a library: **120–160ms** micro-feedback (press, focus, checkbox), **200–240ms** standard change (dropdown, tab, toast), **300ms** page-level change (route, drawer, modal) — above 300ms reads as slow on a work tool [emilkowal.ski/ui/7-practical-animation-tips]. Pair expo-out for entrances, expo-in for exits, and a critically-damped (zero-bounce) spring for anything that drags or reorders — bounce reads as playful, and a ministry tool should read as competent.
2. **Motion (motion.dev)** fits our stack (React 19 + Tailwind v4): it runs on the Web Animations API/`ScrollTimeline`, falling back to JS only for spring physics or gesture tracking; `spring()` takes physics params (`stiffness`/`damping`/`mass`) or duration params (`duration`/`bounce`), and `MotionConfig` sets the app default once [motion.dev/docs/spring]. Native CSS (`@starting-style`, `allow-discrete`, `animation-timeline`) should carry anything with no JS state — cheaper, crash-safe, no bundle cost [developer.chrome.com/blog/entry-exit-animations].
3. **View Transitions is the right primitive for route changes in a React SPA today** — same-document transitions reached Baseline in 2026 — but the router update must happen *inside* `document.startViewTransition()`'s callback, with a feature-detect fallback for unsupported browsers [MDN, View Transition API: Using].
4. The catalogue below covers **28 concrete interactions** across the board, tables, calendar, org chart, dashboard, and Telegram Mini App — each with duration/easing, code, and a reduced-motion fallback, since "respect `prefers-reduced-motion`" is a policy line everywhere but rarely verified per-component [MDN, `@media (prefers-reduced-motion)`].
5. "Feels fast" at Linear/Vercel/Raycast is **rarely about animation speed** — it's optimistic local-first updates, prefetch, and instant keyboard navigation with *zero* animation on repeated actions; Raycast (per Emil Kowalski, who ships production UI at Linear) deliberately has no open animation because he uses it "hundreds of times a day" [emilkowal.ski/ui/you-dont-need-animations]. Motion is the last 10% of "feels fast," not the first.
6. What we refuse: bouncy/overshoot springs outside one checkbox celebration, parallax scrolling, confetti bigger than a coin-sized burst, and any looping/ambient background animation — all trust-eroding in a government tool [rauno.me/craft].

---

## 1. The motion system

This section is the contract: every animated line of code should be explainable by a row in the token table below. It extends the token stack already recommended in `design-systems-craft-and-motion.md` (Tailwind v4 `@theme` variables, OKLCH palette) — durations and easings are just more CSS custom properties in the same block, read by Motion's `MotionConfig` too, so JS and CSS animation never drift apart.

### 1.1 Token table

| Token | Value | Used for |
|---|---|---|
| `--dur-micro` | **140ms** | button press, checkbox toggle, focus ring, hover-reveal actions, tooltip re-open |
| `--dur-standard` | **220ms** | dropdown/select open, tab switch, status pill change, toast enter, inline-edit commit flash |
| `--dur-page` | **300ms** | route change, drawer/sheet open, modal open, sidebar collapse |
| `--dur-celebration` | **480ms**, one-shot only | checkbox-complete micro-burst, RSVP confirm morph — never repeatable in a tight loop |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) | anything entering — arrives with momentum, settles without overshoot |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` (expo-in) | exits toward invisible/off-screen only — its sudden stop is jarring elsewhere [joshwcomeau.com/animation/css-transitions] |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | in-place state changes, neither entering nor exiting (color morph, width, progress fill) |
| `--ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | page-level and View-Transition motion, where a longer deceleration reads as "considered" |
| `spring.settle` (Motion) | `{ type: "spring", visualDuration: 0.3, bounce: 0 }` | drag-and-drop release, shared-layout transitions, reorder — **critically damped, zero overshoot** |
| `spring.sheet` (Motion) | `{ type: "spring", visualDuration: 0.35, bounce: 0.05 }` | drawer/sheet/dialog open — a hair of softness, not bounce |
| `spring.drag` (Motion, physics) | `{ type: "spring", stiffness: 500, damping: 40, mass: 1 }` | pointer-following drag, before release |

Motion's own defaults are *not* these values — `spring()` defaults to `duration: 800ms`/`bounce: 0.25`, `animate()` to `duration: 0.3s` (0.8s across keyframes) [motion.dev/docs/spring] — so `MotionConfig` at the app root must override them explicitly:

```tsx
import { MotionConfig } from "motion/react";

export function MotionProvider({ children }) {
  return <MotionConfig transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}>{children}</MotionConfig>;
}
```

Component-level `transition` props override this per-interaction (e.g. `spring.settle` for the kanban board), but nothing should ship with Motion's un-overridden defaults — an 800ms default spring bounce is exactly the "performing" feeling this report argues against.

### 1.2 What animates, and what never does

**Animates:** state changes the user caused (press, toggle, drag, edit, navigate), status/progress the system reports back (autosave, upload, notification arrival), and spatial continuity when identity persists across a layout change (a card moving columns, a tab underline, a shared-element route transition).

**Never animates:** primary content on load (skeletons crossfade once, then get out of the way — §2.9), a list being actively scanned line-by-line (reordering rows mid-scan fights the eye), anything reached via keyboard shortcut or command palette (Raycast's "no animation, I use it hundreds of times a day" rule [emilkowal.ski/ui/you-dont-need-animations]), and — as policy — decorative background motion, parallax, or looping ambient animation anywhere (§8).

### 1.3 Reduced-motion policy

`prefers-reduced-motion` has shipped in every major browser since January 2020; the rule from every source here is the same: **replace, don't delete**. A drawer that slides up under normal motion should crossfade under reduced motion, not appear with zero transition — *feedback* must survive even when *motion* is removed [MDN, `prefers-reduced-motion`].

```css
:root {
  --dur-micro: 140ms;
  --dur-standard: 220ms;
  --dur-page: 300ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-micro: 1ms;
    --dur-standard: 1ms;
    --dur-page: 1ms;
  }
  /* transforms (movement, scale) are stripped; opacity crossfades survive */
  .motion-safe-transform {
    transform: none !important;
  }
}
```

In Motion for React, the same policy is one hook, applied once so components never have to remember it:

```tsx
import { useReducedMotion } from "motion/react";

const shouldReduceMotion = useReducedMotion();
const transition = shouldReduceMotion
  ? { duration: 0.001 }
  : { type: "spring", visualDuration: 0.3, bounce: 0 };
```

For View Transitions specifically — MDN's own docs don't describe reduced-motion handling out of the box — the guard must be added explicitly or the browser's default cross-fade still runs for users who asked it not to:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```

Libraries that already bake this in: **NumberFlow** (`respectMotionPreference` defaults `true`) and **Recharts** (`isAnimationActive="auto"` reads the OS setting; only an explicit `true` overrides it) [number-flow.barvian.me; recharts.github.io/en-US/guide/animations]. Everything hand-rolled — Motion components, raw CSS, canvas-confetti — needs the guard written per-component.

---

## 2. Micro-interaction catalogue

Twenty-eight interactions, by where they live in the product. Every entry: trigger, duration/easing (from §1.1), a working code sketch, and the reduced-motion fallback.

### Board and lists

**1. Kanban card pick-up / drop.** *Trigger:* pointer-down + drag on a card. *Duration/easing:* `spring.drag` while held, `spring.settle` on release. `@dnd-kit/core` handles pointer/keyboard sensing and hit-testing; Motion's `layout` prop handles the visual reflow of sibling cards — dnd-kit owns *where*, Motion owns *how*.

```tsx
import { motion } from "motion/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function KanbanCard({ task }) {
  const { setNodeRef, transform, isDragging, attributes, listeners } = useSortable({ id: task.id });
  return (
    <motion.div
      ref={setNodeRef} layout layoutId={`card-${task.id}`}
      style={{ transform: CSS.Transform.toString(transform) }}
      animate={{ scale: isDragging ? 1.03 : 1, boxShadow: isDragging ? "0 8px 24px rgb(0 0 0 / .18)" : "0 1px 2px rgb(0 0 0 / .06)" }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0 }}
      {...attributes} {...listeners}
    >
      {task.title}
    </motion.div>
  );
}
```

*Reduced motion:* keep the small lift (a scale under 1.05 doesn't read as movement) but drop the shadow transition and set the settle to ~0ms.

**2. List reorder (table row / checklist item drag).** *Trigger:* drag handle on a row. *Duration/easing:* `spring.settle`. Motion's `Reorder.Group`/`Reorder.Item` is the simpler primitive for a single list (no cross-container drop, unlike the kanban board):

```tsx
import { Reorder } from "motion/react";

<Reorder.Group axis="y" values={items} onReorder={setItems}>
  {items.map((item) => (
    <Reorder.Item key={item.id} value={item} transition={{ type: "spring", visualDuration: 0.3, bounce: 0 }}>
      {item.label}
    </Reorder.Item>
  ))}
</Reorder.Group>
```

*Reduced motion:* rows jump to their new index with a brief opacity flash instead of sliding — confirms the reorder without simulating movement.

**3. Inline edit commit.** *Trigger:* blur or Enter on an editable field (task title, comment). *Duration/easing:* `--dur-standard`, `--ease-standard`. A one-time background flash confirms the save without a toast per keystroke:

```css
@keyframes commit-flash {
  0% { background-color: color-mix(in oklch, var(--color-success) 25%, transparent); }
  100% { background-color: transparent; }
}
.field-committed { animation: commit-flash var(--dur-standard) var(--ease-standard); }
```

*Reduced motion:* skip the color keyframe; the "Saqlandi" indicator (§2.22) is the sole save confirmation.

**4. Status pill change.** *Trigger:* selecting a new status ("Bajarilmoqda" → "Bajarildi"). *Duration/easing:* `--dur-standard`, `--ease-standard`, crossfading `background-color` — never sliding the whole pill:

```tsx
<motion.span
  key={status}
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
  style={{ backgroundColor: statusColor[status] }}
  className="status-pill"
>
  {statusLabel[status]}
</motion.span>
```

*Reduced motion:* instant swap, no crossfade — color alone already satisfies non-motion state indication.

**5. Checkbox complete with subtle celebration.** *Trigger:* checking a task complete. *Duration/easing:* checkmark path draws over `--dur-standard`; a coin-sized `canvas-confetti` burst fires once (`--dur-celebration`), sourced from the checkbox's own bounding box — never full-screen:

```tsx
import confetti from "canvas-confetti";

function fireMicroConfetti(el) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = el.getBoundingClientRect();
  confetti({
    particleCount: 12, spread: 40, startVelocity: 18, scalar: 0.6,
    origin: { x: (rect.x + rect.width / 2) / innerWidth, y: rect.y / innerHeight },
  });
}
```

canvas-confetti reuses one canvas across calls and supports an off-main-thread `useWorker` mode for this kind of fire-and-forget burst [github.com/catdad/canvas-confetti]. *Reduced motion:* skip the burst entirely (guarded above); the checkmark still draws, at ~1ms, via §1.3's override.

**6. Toast with undo progress.** *Trigger:* a destructive or reversible action (archive, delete, status revert). *Duration/easing:* toast enters with `--dur-standard`/`--ease-out`; the undo window (5s) shows as a shrinking bar, `linear` not eased — a countdown should feel mechanical, not soft:

```tsx
import { toast } from "sonner";

function archiveWithUndo(taskId: string) {
  toast.custom((t) => (
    <div className="toast-undo">
      <span>Vazifa arxivlandi</span>
      <button onClick={() => toast.dismiss(t)}>Bekor qilish</button>
      <div className="undo-bar" style={{ animationDuration: "5000ms" }} />
    </div>
  ), { duration: 5000 });
}
```

```css
@keyframes shrink { from { width: 100%; } to { width: 0%; } }
.undo-bar { height: 2px; animation: shrink linear forwards; }
```

Sonner's own `action` option (`{ label: 'Undo', onClick }`) covers the button; the shrinking bar is a small addition on `toast.custom` [github.com/emilkowalski/sonner]. *Reduced motion:* keep the bar but switch to a discrete countdown ("5…4…3") instead of a shrinking width — communicates urgency without relying on motion.

**7. Drawer / sheet open.** *Trigger:* opening a task detail panel from the board or table. *Duration/easing:* `spring.sheet`. **Vaul** (already recommended in `design-systems-craft-and-motion.md`) exposes `shouldScaleBackground` to push page content back slightly, reinforcing that the sheet sits *above* the page:

```tsx
import { Drawer } from "vaul";

<Drawer.Root shouldScaleBackground>
  <Drawer.Trigger>Vazifani ochish</Drawer.Trigger>
  <Drawer.Portal>
    <Drawer.Overlay className="drawer-overlay" />
    <Drawer.Content className="drawer-content">{/* … */}</Drawer.Content>
  </Drawer.Portal>
</Drawer.Root>
```

*Reduced motion:* the overlay still fades; the panel appears at rest without the slide, per §1.3's transform override.

**8. Command palette open (Ctrl/⌘+K).** *Trigger:* global shortcut or search icon. *Duration/easing:* `--dur-standard`, scale-from-0.96 + backdrop blur, using **cmdk** (already the recommended engine) wrapped in a small Motion shell:

```tsx
<AnimatePresence>
  {open && (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      <Command.Dialog open={open} onOpenChange={setOpen}>{/* … */}</Command.Dialog>
    </motion.div>
  )}
</AnimatePresence>
```

Duration here is `--dur-micro` (140–160ms), not `--dur-standard` — per Raycast's philosophy, a tool opened dozens of times a day should feel closer to instant than "considered" [emilkowal.ski/ui/you-dont-need-animations]. *Reduced motion:* opacity only, no scale.

### Loading, numbers, and progress

**9. Skeleton → content crossfade.** *Trigger:* data resolving after a route or panel load. *Duration/easing:* `--dur-standard`, opacity crossfade only — never a layout shift, which means the skeleton's shape must match the real content's shape exactly (a header/footer-only "frame" skeleton, flagged in `design-systems-craft-and-motion.md §6`, is an anti-pattern here too).

```tsx
<AnimatePresence mode="wait">
  {isLoading ? (
    <motion.div key="skeleton" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <TaskCardSkeleton />
    </motion.div>
  ) : (
    <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}>
      <TaskCard task={task} />
    </motion.div>
  )}
</AnimatePresence>
```

*Reduced motion:* instant swap; the skeleton's shimmer loop is also disabled, since a loop is exactly the ongoing-motion case the media query exists for.

**10. Number tickers on home KPIs.** *Trigger:* dashboard mount or a KPI value changing after a mutation. *Duration/easing:* NumberFlow's own defaults — per-digit spring-based, not a linear count-up, avoiding the "slot machine that never stops" feel of naive `setInterval` counters:

```tsx
import NumberFlow from "@number-flow/react";

<NumberFlow value={openTasksCount} locales="uz-UZ" />
```

NumberFlow is built on `Intl.NumberFormat` and the Web Animations API, transitions automatically on `value` changes, and respects `prefers-reduced-motion` by default via `respectMotionPreference` [number-flow.barvian.me] — one of the few items here needing **no** manual reduced-motion code.

**11. Progress bar fill.** *Trigger:* a multi-step process (report submission, bulk import) reporting percent complete. *Duration/easing:* `--ease-standard`, duration proportional to the *delta*, not fixed — 20%→80% should take longer than 20%→22%, or the bar visually lies about rate:

```tsx
<motion.div
  className="progress-fill"
  animate={{ width: `${percent}%` }}
  transition={{ duration: Math.min(0.6, Math.abs(percent - prevPercent) / 100 * 0.8), ease: [0.4, 0, 0.2, 1] }}
/>
```

*Reduced motion:* width still updates (it's the information), duration collapses to near-zero.

**12. Avatar stack expand.** *Trigger:* hovering/focusing a collapsed "+4" avatar stack on a task card. *Duration/easing:* `--dur-micro`, staggered 20ms per avatar — short enough to read as "immediate" while still giving the eye a sense of order [rauno.me/craft]:

```tsx
{avatars.map((a, i) => (
  <motion.img
    key={a.id}
    animate={{ x: expanded ? i * 24 : i * 8, zIndex: avatars.length - i }}
    transition={{ duration: 0.14, delay: i * 0.02, ease: [0.4, 0, 0.2, 1] }}
  />
))}
```

*Reduced motion:* stagger delay set to 0 (single simultaneous move, no cascade).

**13. Hover-reveal row actions.** *Trigger:* pointer hover or keyboard focus on a table row (assign, archive, open icons). *Duration/easing:* `--dur-micro`, opacity + 4px slide-in — kept small because larger movement in a dense table competes with the data for attention.

```css
.row-actions { opacity: 0; transform: translateX(4px); transition: opacity var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out); }
tr:hover .row-actions, tr:focus-within .row-actions { opacity: 1; transform: translateX(0); }
```

*Reduced motion:* drop the transform, keep the opacity fade — and actions must also appear on `:focus-within` (keyboard tab), not only `:hover`, or the interaction is invisible to keyboard-only users regardless of motion settings.

**14. Focus rings.** *Trigger:* any focusable element receiving keyboard focus. *Duration/easing:* `--dur-micro`, `outline-offset` animating 0→2px — animating the ring in, rather than snapping it, makes focus movement traceable when tabbing quickly through a form [rauno.me/craft].

```css
:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 0px;
  transition: outline-offset var(--dur-micro) var(--ease-out);
}
:focus-visible:not(:active) { outline-offset: 2px; }
```

*Reduced motion:* unaffected — a 2px offset transition is not a vestibular trigger; reduced motion is about vestibular safety, not zero-animation absolutism.

### Navigation and structure

**15. Page transitions with the View Transitions API (same-document).** *Trigger:* client-side route change. *Duration/easing:* `--dur-page`, `--ease-emphasized`. The router's state update must happen *inside* the `startViewTransition` callback, with a capability check for unsupported browsers [MDN, View Transition API: Using]:

```tsx
function navigateWithTransition(to: string, navigate: NavigateFunction) {
  if (!document.startViewTransition) {
    navigate(to);
    return;
  }
  document.startViewTransition(() => {
    flushSync(() => navigate(to));
  });
}
```

`flushSync` matters: React 18+ batches state updates, but the callback needs the DOM already mutated synchronously when it returns, or the "before" snapshot goes stale. Name shared elements explicitly so identity carries across the route:

```css
.project-title[data-project-id] { view-transition-name: var(--vt-name); }
```

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*) { animation-duration: 1ms !important; }
}
```

*Reduced motion:* per §1.3's guard — MDN doesn't build this in, so it must be written explicitly or the default cross-fade silently ignores the user's OS setting.

**16. Sidebar collapse.** *Trigger:* collapse toggle or `Ctrl+B`. *Duration/easing:* `--dur-page` (a layout-level change, not a micro one), width transition plus a **staggered** label crossfade so text doesn't visibly compress into icons:

```tsx
<motion.aside animate={{ width: collapsed ? 64 : 240 }} transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}>
  <AnimatePresence>
    {!collapsed && (
      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
        {label}
      </motion.span>
    )}
  </AnimatePresence>
</motion.aside>
```

*Reduced motion:* width still changes; label crossfade collapses to 1ms (icons and labels swap instantly rather than fading independently).

**17. Tab underline slide.** *Trigger:* switching a tab (task Detail / Comments / History). *Duration/easing:* `--dur-standard`, `--ease-standard`, using `layoutId` so one DOM "underline" glides between positions instead of two elements crossfading:

```tsx
{tabs.map((tab) => (
  <button key={tab.id} onClick={() => setActive(tab.id)} className="tab">
    {tab.label}
    {active === tab.id && (
      <motion.div layoutId="tab-underline" className="tab-underline" transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }} />
    )}
  </button>
))}
```

*Reduced motion:* `layoutId` transitions collapse via §1.3's `useReducedMotion` hook at the `MotionConfig` level, so the underline jumps instead of sliding.

**18. Chart draw-in (Recharts).** *Trigger:* a dashboard chart mounting. *Duration/easing:* Recharts' built-in `animationDuration`/`animationEasing`, using its native "pen drawing" `stroke-dasharray` technique for lines and clip-path reveal for areas [recharts.github.io/en-US/guide/animations]:

```tsx
<Line dataKey="completed" isAnimationActive="auto" animationDuration={420} animationEasing="ease-out" />
```

`isAnimationActive="auto"` is the one prop in this whole catalogue that reads the OS reduced-motion preference natively, so an explicit `true` must never be hardcoded over it. *Reduced motion:* handled by the library; no extra code needed, unlike almost everything else here.

**19. Calendar month slide.** *Trigger:* next/previous month navigation. *Duration/easing:* `--dur-page`, directional (left for "next," right for "previous") for a spatial model of time rather than an arbitrary crossfade:

```tsx
<AnimatePresence mode="wait" custom={direction}>
  <motion.div
    key={monthKey} custom={direction}
    initial={{ x: direction > 0 ? 24 : -24, opacity: 0 }}
    animate={{ x: 0, opacity: 1 }}
    exit={{ x: direction > 0 ? -24 : 24, opacity: 0 }}
    transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
  >
    <MonthGrid month={month} />
  </motion.div>
</AnimatePresence>
```

*Reduced motion:* opacity-only crossfade, `x` offset removed entirely (a directional slide implying real spatial movement is the part most likely to disorient a vestibular-sensitive user).

**20. Org chart node expand.** *Trigger:* clicking a manager node to reveal direct reports. *Duration/easing:* `--dur-standard`, height + opacity, using the CSS grid-template-rows trick (`0fr → 1fr`) so no JS height measurement is needed:

```css
.org-children { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-standard) var(--ease-standard); }
.org-children.expanded { grid-template-rows: 1fr; }
.org-children > div { overflow: hidden; }
```

*Reduced motion:* the same grid-rows transition at 1ms — this technique already avoids layout thrash (no `height: auto` measurement), needing no separate code path beyond the global duration override.

### Confirmation and status

**21. RSVP confirm.** *Trigger:* confirming attendance at a department event. *Duration/easing:* `--dur-celebration` (one-shot); the button label morphs to a checkmark + "Ro'yxatdan o'tdingiz" rather than being replaced by a separate success screen — the morph keeps the eye anchored to the same spot:

```tsx
<motion.button layout onClick={confirmRsvp} transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}>
  <AnimatePresence mode="popLayout">
    {confirmed
      ? <motion.span key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>✓ Ro'yxatdan o'tdingiz</motion.span>
      : <motion.span key="idle" exit={{ opacity: 0, scale: 0.9 }}>Qatnashaman</motion.span>}
  </AnimatePresence>
</motion.button>
```

The initial scale is `0.9`, not `0` — Emil Kowalski's tip #2 warns against animating in from `scale(0)`, since real objects don't appear from nothing; 0.9+ reads as "settling into place," not "materializing" [emilkowal.ski/ui/7-practical-animation-tips]. *Reduced motion:* scale removed, opacity crossfade only.

**22. "Saqlandi" (Saved) autosave indicator.** *Trigger:* debounced field change → save request → response. *Duration/easing:* `--dur-standard` per state, three-state icon crossfade (pencil → spinner → check → fade to idle after 2s):

```tsx
<AnimatePresence mode="wait">
  <motion.span key={saveState} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
    {saveState === "saving" ? <Spinner /> : saveState === "saved" ? "✓ Saqlandi" : null}
  </motion.span>
</AnimatePresence>
```

The spinner is the one *looping* animation this catalogue allows, since it communicates active, bounded work rather than ambient decoration — the distinction §8 draws for the whole product. *Reduced motion:* the spinner becomes a static "Saqlanmoqda…" label instead of a rotating icon.

**23. Empty-state illustration entrance.** *Trigger:* a list/board with zero items rendering for the first time. *Duration/easing:* `--dur-page`, staggered rise (illustration, then heading, then CTA), 60ms stagger:

```tsx
{[illustration, heading, cta].map((el, i) => (
  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}>
    {el}
  </motion.div>
))}
```

*Reduced motion:* all three fade in simultaneously (no stagger, no `y` offset) — see §4 for what the illustration itself should look like.

**24. Dropdown / select menu open.** *Trigger:* opening a status/priority/assignee select. *Duration/easing:* `--dur-micro`, scaling from the trigger's actual position via `transform-origin`, not the menu's geometric center — Radix and Base UI both expose this as a CSS custom property, so no manual measurement is needed [emilkowal.ski/ui/7-practical-animation-tips]:

```css
.select-content {
  transform-origin: var(--radix-select-content-transform-origin);
  animation: select-in var(--dur-micro) var(--ease-out);
}
@keyframes select-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
```

*Reduced motion:* opacity only, `transform` dropped from the keyframe.

**25. Tooltip group (instant re-open).** *Trigger:* hovering a second icon-only button shortly after dismissing a tooltip on a different one. *Duration/easing:* the first tooltip in a group gets `--dur-micro` + a 400ms hover delay; any subsequent one within ~600ms gets **zero** delay and **zero** transition, via a shared `data-instant` flag — Emil Kowalski's tip #3, aimed at exactly this toolbar-scanning pattern [emilkowal.ski/ui/7-practical-animation-tips]:

```css
[data-tooltip][data-instant="true"] { transition-duration: 0ms; }
```

*Reduced motion:* unaffected — removing delay is a responsiveness fix, not a motion-safety concern.

**26. Modal / dialog open (CSS-only, no JS state).** *Trigger:* a native `<dialog>` opened via `showModal()`. *Duration/easing:* `--dur-page`, using `@starting-style` + `allow-discrete` so the browser handles the `display: none` ↔ open transition with zero JavaScript [developer.chrome.com/blog/entry-exit-animations]:

```css
dialog {
  opacity: 0;
  transform: translateY(8px);
  transition: opacity var(--dur-page) var(--ease-out), transform var(--dur-page) var(--ease-out),
    display var(--dur-page) allow-discrete, overlay var(--dur-page) allow-discrete;
}
dialog[open] { opacity: 1; transform: translateY(0); }
@starting-style { dialog[open] { opacity: 0; transform: translateY(8px); } }
```

*Reduced motion:* the transform is dropped by the global override in §1.3; opacity still transitions.

**27. Table row selection / bulk toolbar.** *Trigger:* checking a row's selection checkbox. *Duration/easing:* row background tints over `--dur-micro`; once ≥1 row is selected, a bulk-action toolbar slides up over `--dur-standard`, `--ease-out`:

```tsx
<AnimatePresence>
  {selectedCount > 0 && (
    <motion.div initial={{ y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 48, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} className="bulk-toolbar">
      {selectedCount} ta tanlandi
    </motion.div>
  )}
</AnimatePresence>
```

*Reduced motion:* `y` offset removed, opacity-only.

### Telegram Mini App

**28. Telegram-style haptics.** *Trigger:* any interaction above, running inside the Telegram Mini App shell (referenced in `docs/01-research/notifications-telegram-mobile.md`). Telegram's `WebApp.HapticFeedback` exposes three methods: `impactOccurred(style)` with five weights (`light`/`medium`/`heavy`/`rigid`/`soft`) for collisions, `notificationOccurred(type)` with `error`/`success`/`warning` for outcomes, and `selectionChanged()` for picking among options — Telegram's own guidance says `notificationOccurred` should *not* fire on every selection, only on a genuine state change [core.telegram.org/bots/webapps]:

```tsx
function haptics() {
  const hf = window.Telegram?.WebApp?.HapticFeedback;
  return {
    cardDrop: () => hf?.impactOccurred("light"),
    checkboxComplete: () => hf?.notificationOccurred("success"),
    statusSelect: () => hf?.selectionChanged(),
    saveError: () => hf?.notificationOccurred("error"),
  };
}
```

Wire `cardDrop` to #1's `onDragEnd`, `checkboxComplete` to #5 (replacing, not adding to, the confetti burst — a phone doesn't need both a visual burst and a buzz for the same tap), and `statusSelect` to #4 and #24's `onValueChange`. *Reduced motion:* haptics sit outside the CSS media query's scope, but should still be gated by one app-level "reduce motion & haptics" toggle in Settings for users who find vibration on every tap fatiguing — Telegram already gives users a global haptics toggle; we should not fight it, only avoid adding haptics to interactions that don't warrant it, like tooltip hover.

---

## 3. Performance rules

**Animate only compositor-only properties.** `transform` and `opacity` run entirely on the compositor thread — no layout, no paint — while animating `width`, `height`, `top`/`left`, or `box-shadow` forces layout or paint every frame [web.dev/articles/optimize-inp]. Every sample above defaults to `transform`/`opacity`; the two deliberate exceptions are the sidebar width (§2.16, a real layout change with no cheaper substitute) and the org-chart grid-rows trick (§2.20, chosen *because* CSS grid's `fr` unit interpolates row size without a `height: auto` measurement hack).

**`will-change` is a debt, not a default.** Apply it only immediately before an animation starts (`pointerdown` for drag, the frame before a route transition) and remove it immediately after — leaving it permanent keeps an element on its own composited layer indefinitely, costing memory and potentially *worsening* performance on the standard-issue office hardware our sibling report flags as a risk [`design-systems-craft-and-motion.md §2`]. Motion handles this automatically for `transform`/`opacity`; add it manually only where a profiler shows CSS-only janking.

**Avoid layout thrash.** Reading a layout property (`offsetHeight`, `getBoundingClientRect()`) right after writing a style forces a synchronous layout recalculation the browser could otherwise defer — web.dev calls this "forced synchronous layout," the most common cause of dropped frames in hand-rolled animation [web.dev/articles/optimize-inp]. The confetti-origin read in §2.5 is the one place here calling `getBoundingClientRect()` — batched to a single read with no intervening write, skipped entirely under reduced motion.

**Measure with real tools, not intuition.** Chrome DevTools' Performance panel offers "Paint flashing" and "Layout Shift Regions" overlays; read INP as **≤200ms good, 200–500ms needs improvement, >500ms poor**, at the 75th percentile across real devices, not one dev machine [web.dev/articles/optimize-inp]. For interaction-heavy views (board, palette), wrap slow non-visual work in `requestAnimationFrame` + a deferred `setTimeout(0)` so the visual response paints before secondary work runs.

**Defer to the platform where it exists.** Motion runs on the Web Animations API/`ScrollTimeline` when it can, falling back to JS only where the platform doesn't yet expose spring physics or gesture tracking [motion.dev]; native `animation-timeline: scroll()` needs zero JavaScript for scroll-tied progress indicators and is worth using directly rather than a `scroll` listener recomputing every frame [MDN, CSS scroll-driven animations].

---

## 4. Illustration and empty-state strategy

**The three real options, and where each earns its place.** Static SVG is the default for nearly everything: zero-dependency, themeable with `currentColor` for dark mode, trivially small. **Lottie** (After Effects export → JSON, replayed via `lottie-web`, ~300K weekly downloads) earns the dependency only for designer-authored, playback-only sequences with no interactivity — an onboarding illustration, a success animation — where a designer iterates in After Effects and hands off a file with no code change per revision. **Rive** is architecturally different: a compact binary `.riv` file with an artboard plus a *state machine* (idle/hover/loading/success and the transitions between them), reported ~3–5× smaller than equivalent Lottie JSON at icon scale, and the right choice when an illustration must *react* to app state rather than just play once [rive.app/blog/rive-as-a-lottie-alternative; unicornicons.com/blog/lottie-vs-rive-performance]. Rive's commercial-license terms (community vs. paid-tier attribution) were not independently verified this session — confirm against rive.app before adopting beyond prototyping.

**For this product: static SVG first, Lottie second, Rive only if a genuinely stateful illustration is proposed later.** A 23-person department's empty states need no character animation or state machine — just legibility in one second.

**Institutional, not cute — three rules.** (1) No characters, mascots, or anthropomorphized objects — draw the *thing that's missing* (an empty folder, a checked box, a calendar page), not a friendly robot reacting to it; a cartoon mascot would jar against the editorial-institutional identity (warm paper, deep green, serif display) already established. (2) One accent color from the existing OKLCH palette at reduced chroma, never a rainbow illustration — keeps the empty state from competing with the deep-green identity. (3) Line weight and corner radius matched to the icon set already in use (Lucide, per the sibling report), so an illustration reads as part of the same system, not an imported asset with a different hand.

**Licensing discipline.** Any sourced illustration set must permit government redistribution with no attribution baked into the product — unDraw and Humaaans (flagged in `design-systems-craft-and-motion.md §6`) are safe defaults; anything requiring a visible "illustrations by X" credit is a hard no.

---

## 5. Typography and rhythm craft

**Pairing:** the serif display face (warm paper, editorial identity) over **Inter** for body text and **Golos Text** for Cyrillic-heavy Russian content, since Inter's Cyrillic glyph set, while present, wasn't designed Cyrillic-first — Golos Text is a free (OFL) Russian foundry grotesque with native Cyrillic balance, pairing cleanly with Inter's Latin metrics at a similar x-height. English and Uzbek (Latin) render in Inter, Russian in Golos Text, both under the same serif headings — locale switches only the body typeface, keeping identity constant while giving each script the face it was drawn for.

**Optical sizing.** Inter ships three optically distinct masters (100/400/900) rather than one mechanically interpolated master — at small sizes (12–13px labels, table cells) use its lower optical-size range or a static Regular/Medium cut rather than synthetic bolding, a common source of Cyrillic glyphs (the Uzbek `Oʻ`/`Gʻ` marks flagged in the sibling report) rendering illegibly thick.

**Tabular numerals, non-negotiable on any KPI or table.** Any vertically-scanned number column — task counts, budget figures, dashboard NumberFlow tickers (§2.10) — must use `font-variant-numeric: tabular-nums`, or digits of different widths (`1` vs. `8`) make the column visually jitter as values update:

```css
.kpi-value, td[data-numeric] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
```

This matters more once NumberFlow (§2.10) is animating those digits — a proportional-width numeral animating into a wider one causes neighboring text to visibly reflow mid-animation, reading as a bug even though it's "just" a font setting.

**Line-height rhythm on an 8pt grid.** Every line-height should resolve to a multiple of 4px (half the base unit — strict 8px is often too coarse for 13–14px body text) so stacked text blocks — a task title over its metadata line, a comment thread — align to the same vertical rhythm as surrounding layout spacing (`8/16/24/32px`). A concrete scale: body 14px/20px, meta 12px/16px, heading 20px/28px, display serif 32px/40px — each pair divisible by 4, not just close to it.

---

## 6. Dark mode craft

**Elevation is tint, not shadow.** On a dark background a drop shadow is nearly invisible (dark-on-dark) and physically implausible besides — the Material Design convention most current systems have converged on, already implicit in the token-driven dark mode approach recommended in `design-systems-craft-and-motion.md §4`, is that a "raised" dark-mode surface gets a **lighter, slightly desaturated tint** relative to the base background instead of a shadow. In OKLCH terms, each elevation step adds roughly `+0.02` to `+0.03` lightness (`L`) while holding hue (`H`) constant and *reducing* chroma (`C`) slightly, since a fully saturated color at low lightness looks muddier, not richer:

```css
:root[data-theme="dark"] {
  --surface-0: oklch(0.16 0.01 145); /* base */
  --surface-1: oklch(0.19 0.01 145);  /* card, +0.03 L */
  --surface-2: oklch(0.22 0.01 145);  /* popover, +0.03 L */
  --surface-3: oklch(0.26 0.015 145); /* modal, +chroma too */
}
```

**Never invert; hand-tune.** The rule already established for our light/dark theme pair — every themeable surface gets its own hand-tuned value, never a CSS filter or mechanical inversion — applies to motion too: a shadow-based elevation animation that works in light mode needs a *different* dark-mode implementation (tint lightening instead), not the same shadow on a dark background. Hover/press states in §2 (card lift on drag, especially) should reference a `--elevation-shadow` token in light mode and `--elevation-tint` in dark, swapped by the same theme class that swaps every other color token.

**OKLCH's perceptual uniformity pays off for elevation ramps.** Because OKLCH lightness steps are perceptually even (unlike sRGB, where equal numeric steps don't look equally spaced), a `+0.03 L` ramp looks like a consistent "one step up" at every point in the scale, where the same trick in raw RGB/HSL produces visibly uneven jumps — the concrete payoff of the OKLCH migration already recommended for the whole palette.

---

## 7. How Linear, Vercel, and Raycast achieve "feels fast"

The uncomfortable finding across every source here: **the products most praised for feeling fast rely least on animation to produce that feeling.** Three mechanisms do the actual work.

**Optimistic UI.** The interface updates instantly, before the server confirms anything — Linear's UI doesn't wait for a round-trip to show a status change, comment, or card move; it commits locally and reconciles in the background, rolling back only on failure [simonhearne.com/2021/optimistic-ui-patterns]. This is a data-layer decision (scoped in `frontend-architecture-and-sync.md`), not an animation one — but it's the single highest-leverage "feels fast" investment here, ranking above every micro-interaction in §2 combined.

**Prefetch and instant transitions.** Linear reportedly rewrote its build pipeline multiple times chasing time-to-first-paint; the lesson generalizes without needing its numbers re-verified: route data should be prefetched on hover/focus of a nav target, not on click, so by the time a page transition (§2.15) runs, the destination's data is often already resident — the transition decorates an already-ready screen rather than masking a fetch [performance.dev/how-is-linear-so-fast-a-technical-breakdown].

**Zero animation on high-frequency, keyboard-driven actions.** Emil Kowalski — who ships production UI at Linear — says Raycast has no open animation "because I use it hundreds of times a day" [emilkowal.ski/ui/you-dont-need-animations]. The command palette (§2.8) already reflects this with a short 140–160ms open, but the lesson generalizes to anything a power user does dozens of times a day: keyboard-driven status changes, rapid task creation, tab switching — all should default toward *less* animation than their occasional, mouse-driven equivalents.

**The synthesis for us:** spend effort in order — optimistic writes first, prefetch second, motion polish in §2 last. A beautifully eased drawer waiting 400ms for a server round-trip will always feel slower than an un-animated one that opens the instant local state updates.

---

## 8. What to refuse

**Bouncy, overshoot springs — anywhere except the two named celebration moments (§2.5, §2.21).** A card, drawer, or panel that overshoots and settles back reads as playful; every source consulted here — Emil Kowalski's "keep it under 300ms," Rauno Freiberg's framing of interactions that "fail under real-world stress" as a quality signal, our sibling report's "a government tool must never feel like it's performing" — converges on bounce being a tone decision, and the tone needed here is competence, not delight-for-its-own-sake [emilkowal.ski/ui/7-practical-animation-tips; rauno.me/craft]. Every spring in §1.1's token table is explicitly critically damped (`bounce: 0` or near it) for this reason.

**Parallax scrolling.** Parallax is a marketing-site technique for a page read once; a work-tracking tool is read hundreds of times a day, and any scroll-decoupled motion in a data-dense screen (table, board, org chart) fights the eye's ability to track a row or card while scrolling. None of this report's source material recommends parallax for application UI — it appears only for marketing sites, which this product is not.

**Gratuitous confetti.** The one confetti moment here (§2.5) is deliberately scoped to 12 particles, coin-sized, sourced from the checkbox's own position — never full-screen, never on every status change. Confetti on every task completion in a department closing dozens a day would cross from delight into noise within a week; reserve celebration for genuinely rare completions if used beyond the single case specified.

**Animated backgrounds.** No gradient meshes, no particle fields, no looping ambient motion behind content — not on login, not on an empty state, not on a dashboard. Ambient motion is continuous and non-purposeful by definition, failing every test this report applies elsewhere ("what's the purpose of this animation?" [emilkowal.ski/ui/you-dont-need-animations]), and it costs battery/CPU indefinitely rather than once. The only continuously-looping animation permitted anywhere is the bounded autosave spinner in §2.22 — which stops the moment its task finishes, unlike a background animation, which by design never does.

---

## What this means for us

**[ADOPT]**
1. The token table in §1.1 (durations `--dur-micro`/`--dur-standard`/`--dur-page`, easings `--ease-out`/`--ease-in`/`--ease-standard`/`--ease-emphasized`, spring presets `spring.settle`/`spring.sheet`/`spring.drag`) as literal Tailwind v4 `@theme` custom properties, wired into one `MotionConfig` provider before any component ships motion.
2. Motion as the JS engine, CSS (`@starting-style`/`allow-discrete`) for anything with no JS state, and View Transitions (`flushSync`, feature-detected) for route changes — a three-tier split matching what each tool is good at.
3. NumberFlow for numeric tickers and Recharts' `isAnimationActive="auto"` for chart entrances — dependencies that already bake in `prefers-reduced-motion` correctly.
4. Sonner + Vaul + cmdk, unchanged from the sibling report, with the undo-progress-bar (§2.6) and scale-from-trigger (§2.8, §2.24) patterns layered on top.
5. Optimistic UI and prefetch-on-hover as the *first* two "feels fast" investments, ahead of any catalogue item — per §7, this is where Linear's actual advantage lives.
6. Static SVG as the default empty-state medium, Lottie only for designer-authored playback sequences.

**[ADAPT]**
1. Rive — the right architecture for stateful illustration, but its commercial-license terms need direct verification first; treat as Phase 2+, not a launch dependency.
2. canvas-confetti — adopt, constrained hard to the single scoped use in §2.5; don't let it spread without revisiting §8.
3. Telegram haptics (§2.28) — adopt, gated behind one Settings toggle, reserved for meaningful state changes, not every hover or scroll.
4. Golos Text for Russian body copy — a strong candidate, but untested side-by-side against Inter and the serif display face; verify before locking the typography spec.

**[AVOID]**
1. Any spring `bounce` above ~0.1 outside the two named celebration moments.
2. Parallax, animated backgrounds, and confetti beyond the single scoped checkbox case — explicit refusals in §8, not open questions.
3. Hardcoding Motion's un-overridden defaults (800ms spring, 0.25 bounce) anywhere; every component reads from §1.1's tokens, never a bare literal.
4. Treating `prefers-reduced-motion` as one global kill switch at the router level — the correct pattern, per §2, is per-component replacement, not blanket removal.

---

## Open questions

1. **Golos Text vs. Inter Cyrillic, side by side.** The sibling report flags Uzbek's `Oʻ`/`Gʻ` and tutuq belgisi glyphs as an encoding trap independent of "supports Cyrillic" claims; unresolved here — does Golos Text's Russian optical balance pair legibly with Inter's Latin/Uzbek and the serif display face at real UI sizes (12–14px)? Needs a rendered side-by-side test.
2. **Rive licensing for a government procurement.** Community vs. paid-tier terms (attribution, offline/self-hosted use) were not independently confirmed this session and must be checked against rive.app's current terms before use beyond an internal prototype.
3. **Where optimistic UI's rollback UX lives.** §7 names optimistic writes as the highest-leverage "feels fast" investment but doesn't specify the rollback interaction — a `frontend-architecture-and-sync.md`-adjacent question, to be resolved there with a cross-reference to this report's toast pattern (§2.6).
4. **Haptics-off users and the Mini App.** Telegram exposes a device-level haptics toggle we shouldn't fight, but it's unconfirmed whether our in-app "reduce motion" setting should also silence haptics by default — worth asking pilot users rather than assuming.
5. **View Transitions on target hardware.** Baseline support covers current browsers, but ministry office hardware and mandated browser versions were flagged as an OKLCH-rendering risk in the sibling report; the same caveat applies here and should be checked against actual IT browser policy.

---

## Sources

- Motion (motion.dev) — https://motion.dev/ ; spring() reference https://motion.dev/docs/spring ; React transitions https://motion.dev/docs/react-transitions ; CSS spring generation https://motion.dev/docs/css
- MDN — View Transition API https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API ; Using https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using ; scroll-driven animations https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations ; `@starting-style` https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@starting-style ; `prefers-reduced-motion` https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- Chrome for Developers, entry/exit animations — https://developer.chrome.com/blog/entry-exit-animations
- web.dev, Optimize INP — https://web.dev/articles/optimize-inp
- Emil Kowalski — 7 Practical Animation Tips https://emilkowal.ski/ui/7-practical-animation-tips ; You Don't Need Animations https://emilkowal.ski/ui/you-dont-need-animations ; animations.dev https://animations.dev/
- Sonner — https://sonner.emilkowal.ski/ ; https://github.com/emilkowalski/sonner — and Vaul — https://vaul.emilkowal.ski/
- Rauno Freiberg, Craft — https://rauno.me/craft
- Josh Comeau — CSS Transitions https://www.joshwcomeau.com/animation/css-transitions/ ; Springs and Bounces in Native CSS https://www.joshwcomeau.com/animation/linear-timing-function/
- Vercel, Design Engineering at Vercel — https://vercel.com/blog/design-engineering-at-vercel
- performance.dev, How's Linear so fast? — https://performance.dev/how-is-linear-so-fast-a-technical-breakdown
- Simon Hearne, Optimistic UI Patterns — https://simonhearne.com/2021/optimistic-ui-patterns/
- Telegram Bot API, Web Apps (HapticFeedback) — https://core.telegram.org/bots/webapps
- Recharts, animations guide — https://recharts.github.io/en-US/guide/animations/
- NumberFlow for React — https://number-flow.barvian.me/ ; https://github.com/barvian/number-flow
- canvas-confetti — https://github.com/catdad/canvas-confetti
- Rive vs. Lottie — https://rive.app/blog/rive-as-a-lottie-alternative ; https://unicornicons.com/blog/lottie-vs-rive-performance
- Internal: `design-systems-craft-and-motion.md` (tokens, OKLCH, Sonner/Vaul/cmdk, Uzbek glyph trap), `notifications-telegram-mobile.md` (Mini App), `frontend-architecture-and-sync.md` (optimistic UI/sync, §7 and Open Questions)
