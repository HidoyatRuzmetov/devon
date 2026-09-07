# Motion & visual craft recipe book

For `docs/03-plan/UI-OVERHAUL.md` §3 (motion catalogue) and `DESIGN.md` §2.5 (motion tokens).
React 19 + Tailwind v4, tokens only. Every recipe states its reduced-motion variant per the rule:
**replace with a crossfade or instant state change, never delete the feedback.** Adapt code from the
cited sources under their licences; don't paste from paid templates.

Pin `motion@13.2.0` (confirmed current, 2026-09-07, https://registry.npmjs.org/motion/latest).
Import from `motion/react`, not the old `framer-motion` package name.

---

## 0. Foundations

**Primitives** (https://motion.dev/docs/react-quick-start): `motion.*` components animate via
`initial`/`animate`/`exit`/`transition`. `AnimatePresence` keeps an exiting element mounted long
enough to run `exit` before removal — required for every list item, toast, dialog, sheet.
`layout`/`layoutId` measure the DOM before/after a render and animate the delta as a transform
(FLIP); `layoutId` links two *different* elements (e.g. a pill jumping between `<li>`s) into one
shared animation.

**App-wide reduced-motion contract** (https://motion.dev/docs/react-motion-config): wrap the root
once. `reducedMotion="user"` reads `prefers-reduced-motion` live and strips transform/layout
animation while leaving opacity/colour changes — exactly `DESIGN.md`'s "replace, don't delete."

```tsx
// apps/web/src/app.tsx
import { MotionConfig } from "motion/react";
export function App() {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.22 }}><RouterRoot /></MotionConfig>;
}
```

Recipes below call out an *explicit* reduced-motion branch only where `MotionConfig` alone isn't
enough (celebrations, drag flourish, ambient loops — pure decoration Motion won't touch on its own).

**Spring vs. duration** (https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/,
https://emilkowal.ski/ui/great-animations): use a duration + easing curve when start and end are
both known and short — Kowalski's guideline is "usually shorter than 300 ms" for a response to feel
instant. Use a spring for anything interruptible or physical (drag, sheets, shared layout, anything
re-triggerable mid-flight) — a spring computes current velocity and retargets, so a second drag or a
fast re-open never stutters; a tween always looks broken when interrupted. Comeau's three knobs, in
Motion's naming: `stiffness` (tension, higher = snappier), `damping` (friction, higher = less
oscillation), `mass` (inertia, higher = slower to start/stop). Devon's three named springs
(`DESIGN.md` §2.5) cover the whole catalogue and every recipe below imports them, never inlines one:

```ts
// packages/ui/src/motion/springs.ts
export const springSettle = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;    // drag release, shared layout, reorder
export const springSheet  = { type: "spring", visualDuration: 0.35, bounce: 0.05 } as const; // drawers, dialogs
export const springDrag   = { type: "spring", stiffness: 500, damping: 40, mass: 1 } as const; // pointer-following drag
```

`visualDuration`/`bounce` (Motion's newer spring API, same docs) is preferred over raw
`stiffness/damping/mass` for anything not literally following a pointer — it lets you reason in
"how long, how much overshoot" instead of tuning three coupled constants by trial and error.

**Performance, applies everywhere**: animate only `transform`/`opacity` (compositor-only, no
layout/paint — Motion's `layout` prop already restricts itself to this; never animate
width/height/top/left directly). Don't hand-add `will-change` to every card — Motion manages it
internally per element; scope any manual `will-change` (hand-rolled CSS shimmer/gradient) to the few
elements actually animating. **Lists over ~100 items**: never mount `layout`-animated rows in a
virtualized list — a recycled DOM node's `layout` animation fires from the *previous* row's
position, which is visibly wrong; stagger-fade only newly-inserted/visible rows and keep `layout`
off virtualized wrappers (Devon uses `@tanstack/react-virtual` for `DataTable`/`Board`). Stagger via
`transition={{ delay: i * 0.024 }}` on render, not N `setTimeout`s. Reduced motion is a perf win too:
`MotionConfig reducedMotion="user"` skips the FLIP measurement pass entirely for opted-out users.

---

## 1. Route change — View Transitions + AnimatePresence fallback

`--dur-page`, `--ease-emphasized`. Sources: MDN View Transition API
(https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using), Motion `AnimatePresence`.
Devon's router has no React Router dependency (custom route table, TECH-SPEC §5); the transition
wraps the router's commit, `AnimatePresence` covers browsers without the API with the same visuals.

```tsx
// apps/web/src/shell/route-transition.tsx
import { AnimatePresence, motion } from "motion/react";
import { useLocation } from "../lib/router";

const pageVariants = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };
const pageTransition = { duration: 0.3, ease: [0.2, 0, 0, 1] }; // --dur-page, --ease-emphasized

export function navigateWithTransition(commit: () => void) {
  if (!document.startViewTransition) return commit();
  document.startViewTransition(() => commit()); // commit must run synchronously inside the callback
}

export function RouteSurface({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={pathname} variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={pageTransition}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

```css
::view-transition-old(root), ::view-transition-new(root) {
  animation-duration: 300ms; animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
  ::view-transition-old(root) { animation: fade-out 150ms linear both; }
  ::view-transition-new(root) { animation: fade-in 150ms linear both; }
}
@keyframes fade-out { to { opacity: 0; } } @keyframes fade-in { to { opacity: 1; } }
```

**Reduced motion**: `AnimatePresence`'s transform is stripped by `MotionConfig`, leaving an opacity
crossfade; the native View Transitions path gets its own media query to the same effect (above).
**Perf**: View Transitions snapshot to a compositor texture — no React cost beyond the route swap;
`mode="wait"` keeps only one page tree mounted mid-transition, avoiding duplicate data fetches.

---

## 2. Lists, grids, tiles — stagger 24 ms, fade + rise 8 px

`--dur-enter`, `--ease-out`. Source: https://emilkowal.ski/ui/great-animations (stagger must be
purposeful, not decorative).

```tsx
// packages/ui/src/motion/stagger-list.tsx
import { motion } from "motion/react";
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } } };

export function StaggerList<T>({ items, renderItem, keyOf }: { items: T[]; renderItem: (i: T) => React.ReactNode; keyOf: (i: T) => string }) {
  return <>{items.map((it, i) => (
    <motion.div key={keyOf(it)} variants={item} initial="hidden" animate="show" transition={{ delay: Math.min(i, 12) * 0.024 }}>
      {renderItem(it)}
    </motion.div>
  ))}</>;
}
```

Re-run on filter change via the parent list's `key` (forces remount), not by re-staggering on every
keystroke — debounce the trigger. **Reduced motion**: `y` transform stripped, opacity-only fade
remains so nothing pops in instantly. **Perf (>100 items)**: stagger index capped at 12 so a
500-row table doesn't crawl in; never wrap virtualized rows in `motion.div` with `layout`; use
`initial={false}` on already-visible items so re-renders don't replay the entrance.

---

## 3. Cards — hover lift & press

Hover lift −2 px + shadow step; press scale 0.98; `--dur-micro`.

```tsx
<motion.div className="card" whileHover={{ y: -2, boxShadow: "var(--shadow-2)" }} whileTap={{ scale: 0.98 }} transition={{ duration: 0.14 }} />
```

`whileHover`/`whileTap` run entirely on the compositor and revert automatically on pointer
leave/release — no manual state machine. **Reduced motion**: the tap scale (transform) is stripped;
the shadow-step swap (not a transform) still runs, so press still reads as "something happened."
**Perf**: each card owns its own gesture listener — hovering one never re-renders siblings; never
wire hover via a JS class toggle across a whole list.

---

## 4. Board drag — pointer-following spring, drop settle, ghost

`spring.drag`, `spring.settle`. Springs survive interruption (§0) — critical since drag is
interrupted by pointer movement constantly.

```tsx
// features/work/components/draggable-card.tsx
import { motion, useMotionValue, useSpring } from "motion/react";
import { springDrag, springSettle } from "@devon/ui/motion/springs";

export function DraggableCard({ children, onDrop }: DraggableCardProps) {
  const x = useMotionValue(0), y = useMotionValue(0);
  const springX = useSpring(x, springDrag), springY = useSpring(y, springDrag);
  return (
    <motion.div
      drag dragMomentum={false} style={{ x: springX, y: springY }}
      whileDrag={{ scale: 0.98, opacity: 0.9, boxShadow: "var(--shadow-3)", zIndex: 50 }} // ghost at 0.9
      onDragEnd={(_, info) => { onDrop(info); x.set(0); y.set(0); }} // settle spring, not a hard reset
      transition={springSettle}
    >{children}</motion.div>
  );
}
```

Column drag-over highlight is a separate cheap background-colour tween (`--ease-standard`, ~150 ms)
driven by drop-target state — never re-render the whole board on pointer move; read motion values
via listeners, not `useState`. **Reduced motion**: keep drag functional (primary input on the
board); drop the `whileDrag` flourish and settle overshoot (`bounce: 0`). Keyboard drag-and-drop with
an ARIA live region must exist regardless of motion preference — an accessibility requirement, not a
visual one. **Perf**: `useMotionValue`/`useSpring` never touch React state — dragging among 200 cards
causes zero React re-renders.

---

## 5. Sidebar active item, tabs — morphing pill via shared layout

`spring.settle`. Source: Motion `layoutId`.

```tsx
// packages/ui/src/components/tabs.tsx
{tab.id === active && <motion.div layoutId="tab-underline" className="tab-underline" transition={springSettle} />}
```

Both the outgoing and incoming active tab's underline share `layoutId="tab-underline"`, so Motion
treats disappearance-then-appearance as one continuous element sliding between measured positions —
no manual `left`/`width` math. Sidebar's active pill is the same pattern with
`layoutId="sidebar-active-pill"`. **Reduced motion**: the shared-layout transform is exactly what
`reducedMotion="user"` strips — the pill jumps instantly, which is fine (in-place state change, new
state shown immediately). **Perf**: one shared element animating beats two cross-animating their own
position — the pattern Linear/Vercel/Raycast use for this exact effect.

---

## 6. Dialog — scale + backdrop blur; Sheet — spring from edge

Dialog scale 0.96→1 + backdrop blur fade; sheet spring from edge; `spring.sheet`. Source: Vaul
(https://vaul.emilkowal.ski/) for the mobile sheet's own drag physics; Radix Dialog (existing dep)
for the desktop dialog shell.

```tsx
<RadixDialog.Overlay asChild>
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, backdropFilter: "blur(4px)" }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} />
</RadixDialog.Overlay>
<RadixDialog.Content asChild>
  <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
    {children}
  </motion.div>
</RadixDialog.Content>
```

Sheet: `npm install vaul` on mobile (spring drag-to-dismiss built in); desktop entry matches it via
Motion: `initial={{x:"100%"}} animate={{x:0}} exit={{x:"100%"}} transition={springSheet}`.
**Reduced motion**: scale/slide transforms stripped, leaving overlay/content opacity; `backdropFilter`
isn't a transform so Motion leaves it running — that's fine, blur alone isn't "motion." **Perf**:
`backdrop-filter: blur()` is GPU-composited but not free — scope to the overlay only, never stack two
blurred layers (see Glass limits below).

---

## 7. Checkbox / task done — check draws in + particle burst

Check draws in, 12-particle burst, text strikes through; `--dur-celebration` (480 ms one-shot).
`DESIGN.md` §2.5 caps confetti at "a coin-sized 12-particle burst from the checkbox itself." SVG
`pathLength` draw technique is the standard "checkmark draw" pattern (Magic UI/Aceternity use the
same idea, https://magicui.design).

```tsx
<motion.path d="M3 8l3.5 3.5L13 4" fill="none" stroke="var(--color-primary-foreground)" strokeWidth={2}
  initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.18 }} />
{checked && <ParticleBurst />}
```

```tsx
function ParticleBurst() {
  return <span className="particle-burst" aria-hidden>
    {Array.from({ length: 12 }).map((_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return <motion.span key={i} className="particle"
        initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
        animate={{ x: Math.cos(a) * 18, y: Math.sin(a) * 18, opacity: 0, scale: 0 }}
        transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }} />;
    })}
  </span>;
}
```

`pathLength` is Motion's special SVG prop animating `stroke-dashoffset`/`-dasharray` together — cheap
paint on a 16×16 icon, no layout. **Reduced motion**: instant `opacity` cut instead of the draw, skip
mounting `ParticleBurst` entirely (decoration only — checked state + strikethrough already
communicate completion). **Perf**: gate particles behind `!reduced`; a bulk "mark 40 done" action
should skip the burst (single toast instead) rather than spawn 480 particle nodes at once.

---

## 8. RSVP yes, card done, sprint complete — celebration moment

Burst + toast; `--dur-celebration`. Scale §7's burst to 24–32 particles from the button, plus a
Sonner toast (https://sonner.emilkowal.ski/, `npm install sonner`):

```tsx
import { toast } from "sonner";
function onRsvpYes() { triggerBurst(buttonRef.current); toast.success(t("events.rsvp.confirmed")); }
```

**Reduced motion**: burst skipped, toast alone is sufficient feedback — same split as §7.

---

## 9. Counters, KPI tiles — NumberFlow ticker

Default transition. Source: https://number-flow.barvian.me/ (`pnpm add @number-flow/react`).

```tsx
import NumberFlow from "@number-flow/react";
<NumberFlow value={value} format={{ notation: value > 9999 ? "compact" : "standard" }} />
```

Animates digit-by-digit on `value` change, no manual tween — measures each glyph, transitions via
transform. **Reduced motion**: NumberFlow has its own `prefers-reduced-motion` awareness and falls
back to an instant digit swap; verify once in Storybook with the OS flag flipped. **Perf**: fine for
a dashboard's dozen KPI tiles; not for a virtualized table cell renderer updating every second (each
mount does a DOM measurement pass) — reserve it for the tiles/legends the catalogue names.

---

## 10. Charts — draw-in on mount, hover crosshair

Draw-in once, 600 ms; hover crosshair. Recharts (existing dep) handles the draw-in natively; layer a
Motion crosshair for hover since Recharts' cursor is instant/CSS-only.

```tsx
<Line dataKey="value" stroke="var(--color-primary)" dot={false} isAnimationActive animationDuration={600} animationEasing="ease-out" />
<Tooltip cursor={<AnimatedCrosshair />} />
```

```tsx
function AnimatedCrosshair({ points }: { points?: { x: number }[] }) {
  const x = points?.[0]?.x ?? 0;
  return <motion.line x1={x} x2={x} y1={0} y2="100%" stroke="var(--color-border)" animate={{ x1: x, x2: x }} transition={{ duration: 0.1, ease: "linear" }} />;
}
```

**Reduced motion**: `isAnimationActive={!reduced}` renders the chart fully drawn on mount; the
crosshair is positional feedback (like a cursor), not decorative, so it stays enabled either way.
**Perf**: `animationDuration` fires once on mount only; for auto-refreshing tiles, set
`isAnimationActive={false}` after first mount to avoid a redraw flash on every poll.

---

## 11. Skeleton → content — shimmer then crossfade, layout matched

`--dur-enter`. Shimmer technique adapted from Magic UI's background-position keyframe pattern
(https://magicui.design, MIT) and shadcn/ui's shape-matched `Skeleton` convention.

```css
.skeleton {
  background: linear-gradient(100deg, var(--color-muted) 40%, color-mix(in oklch, var(--color-muted), white 12%) 50%, var(--color-muted) 60%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.6s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@keyframes skeleton-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; opacity: 0.7; } }
```

Crossfade to real content with matched shapes:

```tsx
<AnimatePresence mode="wait">
  {loading
    ? <motion.div key="skeleton" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}><CardSkeleton /></motion.div>
    : <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}><CardContent {...data} /></motion.div>}
</AnimatePresence>
```

**Perf**: `background-position` is paint-layer, compositor-friendly, but it's an infinite loop — cap
shimmering rows to the first screenful in a long list, and use `content-visibility: auto` on
off-screen skeleton rows.

---

## 12. Toast — slide up, undo progress bar shrinking

`--dur-enter`. Source: https://sonner.emilkowal.ski/ (`npm install sonner`, MIT, Emil Kowalski).

```tsx
import { Toaster, toast } from "sonner";
<Toaster position="bottom-right" />;

function deleteCard(card: Card) {
  removeOptimistically(card.id);
  toast(t("common.deleted"), { action: { label: t("common.undo"), onClick: () => restore(card) }, duration: 6000 });
}
```

Sonner has no built-in shrinking countdown bar — render one as a child whose width tracks the
toast's `duration` via a linear tween:

```tsx
function UndoProgressBar({ durationMs }: { durationMs: number }) {
  return <motion.div className="undo-progress" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} style={{ transformOrigin: "left" }} transition={{ duration: durationMs / 1000, ease: "linear" }} />;
}
```

**Reduced motion**: keep the progress bar (informational — how long you have to undo — not
decorative); Sonner's own enter/exit already respects `prefers-reduced-motion`. **Perf**: `scaleX`
not `width` — must never trigger layout across a 6-second countdown.

---

## 13. Inbox badge — pop on increment

`--dur-micro`.

```tsx
<motion.span key={count} className="badge" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", visualDuration: 0.14, bounce: 0.4 }}>{count}</motion.span>
```

**Reduced motion**: scale stripped, badge updates instantly — the number itself still communicates
the change.

---

## 14. Pomodoro ring — animated stroke, phase colour crossfade

1 s per tick. Same `stroke-dashoffset` family as §7, driven by elapsed time rather than a boolean.

```tsx
const c = 2 * Math.PI * radius;
<motion.circle r={radius} strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - progress) }} transition={{ duration: 1, ease: "linear" }} />
<motion.circle className="ring-track" animate={{ stroke: phase === "focus" ? "var(--color-primary)" : "var(--color-success)" }} transition={{ duration: 0.22 }} />
```

**Reduced motion**: this ring *is* the information (a live timer) — keep it running regardless;
only ever use a duration tween for the phase-colour change, never a spring (no functional purpose
here). **Perf**: one paint-layer stroke update per second via `animate`, not manual rAF; isolate the
ring in its own component so the whole Pomodoro card doesn't re-render every tick.

---

## 15. Theme toggle — icon morph; circular reveal via View Transitions

`--dur-page`. The circular-reveal theme toggle is the canonical View Transitions demo pattern
(MDN, above) — adapt the technique, don't copy a specific author's exact snippet.

```tsx
function toggleTheme(buttonEl: HTMLElement, next: "light" | "dark") {
  const setTheme = () => document.documentElement.setAttribute("data-theme", next);
  if (!document.startViewTransition) return setTheme();
  const { top, left, width, height } = buttonEl.getBoundingClientRect();
  const x = left + width / 2, y = top + height / 2;
  const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(setTheme).ready.then(() =>
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
      { duration: 300, easing: "cubic-bezier(0.2,0,0,1)", pseudoElement: "::view-transition-new(root)" }
    )
  );
}
```

Icon morph is a small `AnimatePresence` swap on the button: `initial={{rotate:-90,opacity:0}}
animate={{rotate:0,opacity:1}} exit={{rotate:90,opacity:0}}`. **Reduced motion**: skip the
`animate()` circular-reveal call entirely (call `setTheme()` directly); icon morph falls back to
opacity-only via `MotionConfig`. **Perf**: the reveal animates a full-page compositor texture — O(1)
regardless of DOM size, safe even on the densest table view.

---

## 16. Collapsibles, accordions — height auto animation

`--dur-enter`. Prefer the CSS grid-rows trick (0fr↔1fr) over JS height measurement — it's the
"stateless enter/exit" approach `DESIGN.md` §2.5 names, no `scrollHeight` reads, no layout thrash:

```css
.collapsible-content { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 220ms var(--ease-standard); }
.collapsible-content[data-state="open"] { grid-template-rows: 1fr; }
.collapsible-content > * { overflow: hidden; min-height: 0; }
```

Reserve Motion's `layout` prop (`<motion.div layout>` wrapping the panel) for cases where opening one
item must also reflow *siblings* smoothly (e.g. an accordion list) — the CSS trick alone doesn't
coordinate that. **Reduced motion**: `transition-duration: 0.01ms` under the media query; content
still opens/closes, just without the glide.

---

## 17. Buttons — loading spinner morph, success check morph

`--dur-micro`.

```tsx
<AnimatePresence mode="wait" initial={false}>
  {state === "loading" && <motion.span key="spinner" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.14 }}><Spinner size={14} /></motion.span>}
  {state === "success" && <motion.span key="check" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.14 }}><Check size={14} /></motion.span>}
</AnimatePresence>
```

**Reduced motion**: scale stripped, opacity crossfade between icon states remains legible.

---

## 18. Empty states — illustration idle float

4 s loop, stops under reduced motion, ambient. Illustrations: unDraw
(https://undraw.co/license — free to modify, recolour, and use commercially, no attribution
required; the only restrictions are not redistributing the set as a competing pack/dataset), Open
Peeps, Humaaans — recoloured to `--color-primary`/`--color-muted` tokens per `UI-OVERHAUL.md` §1.6.

```tsx
const reduced = useReducedMotion();
<motion.div animate={reduced ? {} : { y: [0, -6, 0] }} transition={{ duration: 4, repeat: reduced ? 0 : Infinity, ease: "easeInOut" }}>
  <EmptyStateIllustration name="no-tasks" />
</motion.div>
```

An infinite `y`-keyframe loop is *not* neutralized automatically by `MotionConfig` — it must be
explicitly gated as above. **Perf**: one small SVG translating, negligible; never animate more than
one illustration on screen (empty states are, by definition, the only content shown).

---

## 19. Auth, hub — ambient slow gradient drift

Only here; stops under reduced motion. The single place `UI-OVERHAUL.md`/`DESIGN.md` allow an
animated background.

```css
.auth-backdrop {
  background: radial-gradient(circle at 30% 20%, color-mix(in oklch, var(--color-primary), transparent 85%), transparent 60%), var(--color-background);
  background-size: 200% 200%;
  animation: ambient-drift 24s ease-in-out infinite alternate;
}
@keyframes ambient-drift { from { background-position: 0% 0%; } to { background-position: 40% 30%; } }
@media (prefers-reduced-motion: reduce) { .auth-backdrop { animation: none; background-position: 20% 15%; } }
```

**Perf**: paint-only on one fixed-size backdrop element, cheap even over 24 s — and the *only*
screen budgeted for it; every other screen keeps `DESIGN.md`'s "no animated backgrounds" rule.

---

## 20. Hover cards — fade + 4 px rise, 150 ms open delay

`--dur-micro`. Radix `HoverCard`'s own `openDelay` prop covers the 150 ms; Motion covers the visual
entrance:

```tsx
<HoverCard.Root openDelay={150} closeDelay={100}>
  <HoverCard.Trigger asChild>{trigger}</HoverCard.Trigger>
  <HoverCard.Portal forceMount>
    <AnimatePresence>
      {open && <HoverCard.Content asChild>
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.14 }}>
          <PersonPreviewCard />
        </motion.div>
      </HoverCard.Content>}
    </AnimatePresence>
  </HoverCard.Portal>
</HoverCard.Root>
```

Bind `open` via `onOpenChange` into local state (as shown) so `AnimatePresence` can run the exit
animation before Radix unmounts the content with `forceMount`.

---

## 21. Command palette — scale-in, items highlight, re-stagger on query change

`--dur-micro`. `cmdk` (existing dep) drives list/filter logic; Motion wraps the panel mount and
reuses §5's `layoutId` technique for the active-item highlight.

```tsx
<AnimatePresence>
  {open && <motion.div className="command-palette" initial={{ opacity: 0, scale: 0.96, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -8 }} transition={{ duration: 0.14 }}>
    <Command shouldFilter>
      <Command.List>
        {results.map((r, i) => (
          <motion.div key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: Math.min(i, 8) * 0.02 } }}>
            <CommandItem item={r} />
          </motion.div>
        ))}
      </Command.List>
    </Command>
  </motion.div>}
</AnimatePresence>
```

`layout` on each row animates position shift as the query re-filters; `key={r.id}` still gives a
genuinely new item its own fade-in. **Perf**: cmdk keeps the DOM list small (fuzzy-filtered, not
virtualized-hundreds) — this is not the >100-item case from §0.

---

## Dark-mode craft

Source: `DESIGN.md` §2.2 (elevation via lightness tint, not shadow), consistent with Rauno
Freiberg's craft notes on coherent depth cues over decorative shadow (https://rauno.me/craft).

- **Elevation = lightness step, not shadow depth.** A black shadow against an already-dark background
  barely reads. Devon's dark palette raises `--color-card` a full step above `--color-background`
  (18%→22% L), and `--color-popover` a step above that — never rely on shadow alone for elevation:
  ```css
  :root[data-theme="dark"] {
    --color-background: oklch(18% 0.015 250);
    --color-card: oklch(22% 0.015 250);
    --color-popover: oklch(26% 0.015 250);
  }
  ```
- **Borders do more work in dark mode** — often the only thing separating two same-lightness
  surfaces; never drop borders in dark mode "for cleanliness," or the UI turns into flat grey.
- **Shadows persist, softer and re-tinted**: `DESIGN.md` §2.4 keeps them at ~40% of light-mode
  opacity, shifted toward `--color-sidebar`'s navy hue rather than neutral black.
- **Primary/accent hues get a lightness bump, not just alpha** — dark `--color-primary` is
  oklch(72%…) vs. light's oklch(40%…), same hue, deliberately lighter, to stay legible without
  turning garish.
- **Semantic colours are re-tuned independently**, not lifted by a blanket percentage — a naive
  global lift blows warning/destructive past a "shouting" intensity they shouldn't carry.

## Shadows scale

| Token | Use for | Never for |
|---|---|---|
| `--shadow-1` | resting cards, focused inputs | flat/inline elements (chips, tags) |
| `--shadow-2` | hover-lifted cards (§3), dropdown menus | page backgrounds, full-bleed sections |
| `--shadow-3` | sheets, dialogs, command palette (topmost layer) | cards at rest |

A shadow-step change (1→2 on hover) is itself the animatable thing (§3) — a card already at
`--shadow-2` at rest has nowhere to go on hover and reads as dead.

## Focus rings

`DESIGN.md` §2.1/§6: `--color-ring`, 2 px, 2 px offset, every interactive element, both themes,
contrast-checked.

```css
:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; border-radius: inherit; }
```

Use `:focus-visible`, never bare `:focus` — clicks show no ring, keyboard tabbing always does
(matches every product in the Jakob's Law map). Radix primitives already forward `:focus-visible`
correctly; never `outline: none` without a token replacement.

## Glass / blur usage limits

`backdrop-filter: blur()` is rationed: (1) dialog/sheet overlays only (§6), one blurred layer behind
the topmost surface; (2) never stack two blurred layers at once — cost roughly multiplies and it
turns to visual mush; (3) never blur a scrollable content area — it recomputes per scroll frame;
(4) no frosted-glass treatment on ordinary content cards — `DESIGN.md`'s "warm paper surface"
identity is opaque, a deliberate divergence from macOS/Aceternity-style glassmorphism, in service of
the Jakob's Law targets (Linear/Notion/Vercel are opaque chrome, not frosted).

## Ambient gradient recipe (recap + limit)

The only two ambient/decorative motions in the product are §18 (empty-state float) and §19
(auth/hub drift) — both explicit exceptions to "no animated backgrounds" in `DESIGN.md`. A new
screen wanting ambient motion needs a `DESIGN.md` update first, not silent replication — this is
what keeps "motion is feedback, not decoration" from eroding screen by screen.

## Skeleton shimmer recipe (recap)

Full CSS in §11. Two craft rules beyond the code: skeleton shapes must match final content
pixel-for-pixel (padding, avatar size, line-height) or real content causes a layout jump on arrival;
and per `DESIGN.md` §4 ("nothing under 1 s, skeleton 1–10 s, progress bar beyond"), delay the
skeleton's mount by ~150 ms so sub-second responses never flicker one in:

```tsx
const [showSkeleton, setShowSkeleton] = useState(false);
useEffect(() => {
  if (!loading) return setShowSkeleton(false);
  const t = setTimeout(() => setShowSkeleton(true), 150);
  return () => clearTimeout(t);
}, [loading]);
```

---

## What Devon adopts

- [ ] `motion@13.2.0` pinned, imported from `motion/react` everywhere (never `framer-motion`);
      `MotionConfig reducedMotion="user"` wraps the app root once.
- [ ] `packages/ui/src/motion/springs.ts` exports `springSettle`/`springSheet`/`springDrag` exactly
      as named in `DESIGN.md` §2.5 — every consumer imports these, never inlines a spring config.
- [ ] Route transitions: View Transitions + `AnimatePresence` fallback (§1), wired through the
      router's navigate function, not per-screen.
- [ ] List/grid stagger (§2) capped at a 12-item delay ceiling, never applied to virtualized rows.
- [ ] Card hover/press (§3), board drag with named springs (§4), sidebar/tabs shared-layout pill (§5)
      built once in `packages/ui`, used everywhere — `UI-OVERHAUL.md` §6 DoD.
- [ ] Dialog/Sheet motion (§6) with `spring.sheet`; `vaul` (pinned) for mobile sheets specifically.
- [ ] Checkbox check-draw + 12-particle burst (§7), reused/scaled for RSVP/sprint celebrations (§8) —
      both gated off entirely, not just toned down, under reduced motion.
- [ ] `@number-flow/react` pinned for every KPI tile and counter (§9); Recharts draw-in
      (`animationDuration: 600`, once) + Motion crosshair (§10).
- [ ] Shimmer skeleton CSS (§11) with the 150 ms mount-delay debounce, shapes matched to final
      layout; `sonner` (pinned) for all toasts (§12) with a shared `UndoProgressBar`.
- [ ] Inbox badge pop (§13), Pomodoro ring (§14), theme toggle circular reveal + icon morph (§15),
      CSS grid-rows collapsibles (§16), button state morph (§17) each built once in `packages/ui`.
- [ ] Hover cards via Radix `HoverCard` + Motion entrance (§20); command palette via `cmdk` + Motion
      panel/list motion (§21).
- [ ] Dark-mode elevation via lightness tokens only, never shadow-only; shadow-scale table enforced
      in review (`--shadow-3` reserved for the topmost layer).
- [ ] `:focus-visible` (never bare `:focus`) with `--color-ring`, 2 px + 2 px offset, on every
      interactive primitive.
- [ ] `backdrop-filter: blur()` confined to dialog/sheet overlays — never stacked, never on
      scrollable content, never a general card treatment.
- [ ] Ambient gradient/float motion restricted to the two screens named here and in `DESIGN.md`;
      any addition requires a `DESIGN.md` update first.
- [ ] unDraw / Open Peeps / Humaaans illustrations recoloured to tokens before use — unDraw's
      no-attribution, modify-and-recolour, commercial-use licence confirmed compatible
      (https://undraw.co/license).
- [ ] Every recipe's reduced-motion branch verified once in Storybook with the OS setting flipped,
      per `UI-OVERHAUL.md` §6 DoD.
