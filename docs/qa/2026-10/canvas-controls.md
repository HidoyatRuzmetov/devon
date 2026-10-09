# Canvas controls audit

Scope: the personal canvas drawing editor, its existing scene/absolute-point format, sticky notes,
keyboard and pointer alternatives, local persistence and adjacent queued saves. This ledger does
not mark the rest of Personal or the platform complete.

## Safety and fixtures

- Synthetic `demo.xodim` data in dedicated `devon_flow_e2e_visual`, API `127.0.0.1:48911`, web
  `127.0.0.1:48912`. Harness network guards and integration stripping remain enabled.
- Every canvas has a unique title. Fixtures use the real create/read API and actual UI transitions;
  no production records, AI, Telegram or mail calls.
- Chromium native touch uses browser CDP input and records actual `pointerType: touch` events.
  Firefox/WebKit mouse/keyboard evidence is not presented as native touch proof.
- Browser results now include `QA_RUN_ID` in their absolute output directory so a later own run
  preserves earlier traces. The original three before traces were copied to `before/traces` before
  this change. Escape before JSON remains; its intermediate trace was cleaned by the next own run
  before the per-run output repair. The distinct touch/overflow before traces were preserved.

## Reproduced defects and repairs

1. **Freehand movement did not move the drawing.** An actual drag changed x/y but left the visible
   absolute point list fixed. Before measured displacement was `(0,0)` instead of `(40,30)`, and the
   selection outline separated from the visible stroke. Translation now moves both the stored
   origin and absolute points without mutating snapshots. Bounds derive from the actual points.
2. **Global Delete could delete from another control.** With a rectangle selected and the external
   Share button focused, Delete removed the rectangle. Shortcuts now require focus within the
   editor; destructive/move shortcuts additionally require the drawing region or sticky grip.
   Input, textarea, native select and contenteditable retain their own typing behavior.
3. **Sticky text could not be undone.** Fill followed by Undo left `Edited note`, instead of the
   original text. Text edits record the state before the first changed character in each focus/edit
   session. Drawing text, sticky text, movement, colour, stroke and deletion share immutable history.
   Undo/Redo reflect actual availability and are disabled during a live gesture.
4. **Keyboard creation/selection and existing text editing were missing.** Add object and a native
   Selected object control provide equivalents to pointer creation/hit testing. Coordinate controls,
   Edit text and Delete are contextual. Arrows move selected objects; Shift moves 10 pixels. Pen +
   Add supports arrows, Enter/Finish and Escape/Cancel. Drawing text can also be edited by double click.
5. **Pointer completion/cancellation was incomplete.** Shapes and drawing now capture the primary
   pointer, ignore secondary-button creation, complete outside the paper, and restore the preceding
   state on cancellation/lost capture. Escape was independently reviewed as a hypothesis, then
   actually reproduced: `hasPointerCapture` stayed true after cancellation. It now releases the
   stored capture owner and clears the gesture before the resulting lost-capture event.
6. **Native touch shape movement became scrolling.** Actual Chromium touch reached the rectangle,
   emitted pointermove followed by pointercancel/lostcapture, and restored x19 instead of moving
   50 pixels. `touch-action` on an SVG group did not prevent the root SVG pan behavior. The Select
   and drawing tools now use the root surface's `touch-action:none`; a named visible Pan hand tool
   provides intentional native scrolling. Wheel and named-region keyboard scrolling remain available.
7. **Coordinate labels spilled at large text.** Actual Uzbek Latin 320px/200% rendered document width
   341px. The Horizontal label painted beyond its 80px field. Coordinate fields now use 96px and
   wrap long labels. No global overflow clipping was added.
8. **A long accepted stroke could overflow the argument stack.** The source review hypothesis was
   reproduced using the actual bounds helper: 140,000 points fit the existing 3MB scene limit, but
   `Math.min(...points)` threw `RangeError: Maximum call stack size exceeded`. A linear min/max loop
   handles that scene without a variadic argument limit. This is unit boundary evidence, not an
   assertion that a browser user drew 140,000 points during this audit.
9. **Ink controls lacked useful names/state.** Colour controls now have translated colour names and
   pressed state, focus outlines, 32px desktop/44px narrow targets. New green/orange inks use darker
   same-family values appropriate for drawing text on white paper. Existing saved inks remain as
   stored. The editor preserves scene `appState`, sticky rotation and existing identifiers.
10. **WebKit's native selected-object field exceeded its container.** At 320px with doubled text,
    the native field's anonymous rendering produced a 332px document. The real before diagnostic
    is `canvas-webkit-selector-root-before/webkit/selector-diagnostic.json`. The field retains
    native select semantics and keyboard behavior, with a local `appearance-none` wrapper and
    decorative chevron. Its current label and field fit without globally clipping the page.

## Evidence paths and actual pixel review

All paths are repository-relative. Capturing a screenshot does not itself mean its pixels were reviewed.

Before pixels actually opened and inspected:

- `artifacts/qa/2026-10/canvas-nested/before/chromium/stroke-after.png`: stationary stroke and displaced
  selection outline; corresponding `stroke-move.json` records dx/dy0. The original three real failure
  traces are in `before/traces/`.
- `artifacts/qa/2026-10/canvas-nested/gesture-diagnostics/chromium/overflow-before.png`: Horizontal
  spills beyond its field at 320px/200% Uzbek Latin. `overflow-before.json` records viewport320/doc341.
- `artifacts/qa/2026-10/canvas-nested/gesture-diagnostics/chromium/native-touch-before.png`: restored
  rectangle position; `touch-diagnostic.json` records actual touch target/cancellation sequence.
- `artifacts/qa/2026-10/canvas-nested/gesture-before/chromium/escape-capture.json`: actual captured
  pointer remains owned after Escape (before the repair).

Final affected browser gate: `QA_RUN_ID=canvas-final-root`,
`pnpm --filter @devon/web exec playwright test --config test/e2e/canvas-controls.config.ts`,
with `FLOW_DB_NAME=devon_flow_e2e_visual`, ports 48911/48912 and `FLOW_SEED_DEMO=1`.
The completed run reported **32 passed, 4 skipped, 0 failed**, zero retries. Two Chromium-only
CDP native-touch cases account for the four explicit Firefox/WebKit skips. They are not native
touch coverage in those engines. The other ten cases passed in each of the three engines.
This config uses the list reporter; no JSON summary file is claimed for this run.

The three engine `canvas-final-root/<browser>/reflow.json` files retain **192 observations**:
four locales, both themes, four widths and normal/doubled text. Final captures are under
`artifacts/qa/2026-10/canvas-nested/canvas-final-root/`. The reviewer actually opened all **24**
`pixel-sheets/<browser>-<locale>-<theme>.png` comparison sheets generated by
`tools/qa/canvas-review.py`. Each sheet contains the desktop toolbar crop and complete 320px
normal/doubled-text views: **72 source captures represented**, not 72 unscaled original reviews.
WebKit's 2x source captures are reduced to CSS-pixel scale in those sheets. Toolbar wrapping,
selected-object controls, coordinate labels, touch targets and translated instructions fit.
Two selected originals were also opened: WebKit Cyrillic/dark/320/doubled text and Chromium
English/light/1440. The reviewer additionally opened all three `keyboard-history.png` originals
(WebKit shown resized), Chromium `mouse-pan-selection.png`, and Firefox/WebKit
`pointer-boundaries.png` (the last WebKit image explicitly at original detail). These confirm
selection outlines, sticky/drawing text and visible focus in their recorded functional states.
Other original functional captures and lower desktop canvas regions remain pending pixel review;
numeric geometry and capture alone do not establish those states.

## Current validation status

- Original three actual Chromium failure cases and full keyboard creation/edit/history pass after
  the initial repairs. That intermediate run correctly failed at touch/capture checks; it is not
  counted as final completion.
- Web typecheck and owned ESLint pass after the final Pan/capture and coordinate changes.
- Geometry boundary/immutable-history units: 2 passed after the reproduced long-stroke failure.
- The final three-engine gate passed the shared cases, including keyboard creation/edit/history,
  pointer finish/cancel/Escape, reflow/target/axe assertions, mouse Pan and keyboard scrolling,
  sticky readability and the three adjacent autosave cases. Persisted effects have independent
  reads; the native Chromium cases also record actual touch input and measured displacement.
- A raw one-move CDP stream left an incomplete touch sequence that did not activate the next Pan
  tap. Replacing that fixture with a continuous browser-native gesture and asserting the actual
  finger displacement fixed the fixture. A trial SVG pointer-events change did not fix it and was
  reverted. No product repair is claimed for that fixture diagnostic.
- Unperformed physical device/native Firefox/WebKit touch and browser-managed pinch gestures remain
  pending. No manual claim of those states will be made from CDP or mouse coverage.
