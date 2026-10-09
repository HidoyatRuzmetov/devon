# Personal periods and Pomodoro: bounded local evidence

This slice uses the real local API/PostgreSQL and disposable synthetic accounts in
`devon_flow_e2e_periods` on API 48971/web 48972. The existing outbound guard blocks external
integrations; Telegram, application AI, SMTP and real web-push delivery are not called. API dev
mode and the documented plain-HTTP WebKit Secure-cookie accommodation remain in use. This is
functional local evidence, not a production deployment or external integration check.

## Confirmed defects and corrections

| Actual observation | Resulting behavior | Preserved evidence |
| --- | --- | --- |
| Aborted session POST left a running countdown with no saved session and no failure feedback. | Start waits for an actual receipt. A lost committed response is recovered only from the exact owner/kind/task/start-time row; no duplicate POST or manufactured success. | `artifacts/qa/2026-10/period-timer/before-five-product-one-selector` |
| Aborted Stop reset the UI to Ready while the real session remained open. | Ending pauses and retains the original end time/completed intent. Retry persists that intent before clearing or advancing the phase, including after reload. | Same before report; final browser gates include manual and automatic failures. |
| Failed settings silently showed an apparently saved value. | Valid failed drafts stay visible with error, explicit Retry and Revert. Shared pending state blocks overlapping widget/panel settings writes; late results cannot populate another account's cache. | Same before report; current desired draft retention follows the reviewed requirement, rather than the original baseline assertion expecting silent reversion. |
| Session GET failure appeared as an empty log; open sessions were labelled Skipped. | Genuine read failure and Retry are separate from empty data; open rows say In progress. | Same before report and captured current log pixels. |
| Completing a period failed with no feedback. | Failure leaves the active period intact and provides save feedback; successful retry completes it. | `period-timer/before-completion-feedback` contains the corrected, actually failing semantic-selector case. |
| Custom selected a fixed uneditable day. | Custom creation has editable start/end dates with validation; existing active periods have goal/date editing with retained failed draft. | Original before report; UI persistence/fault journey validates 56-hour creation, 72-hour edit and rollover. |
| Today rolled an actual 72-hour custom period into a 24-hour successor. | Both Today and Periods use one duration calculation and retain the chosen custom time box. | `period-timer/before-today-custom-duration/results.json`: actual POST200 and persisted successor 86,400,000ms instead of 259,200,000ms. |
| Enlarged text squeezed four statistics into the narrow content beside the desktop sidebar. | Statistics columns follow available content width. Typography-sized date columns also stack at enlarged text so the native date and time fit. | `period-timer/before-statistics-reflow` contains the eight failing locale/theme checks and original pixels. |
| Starting focus from the full panel after selecting a Today task saved a session with no task; leaving Personal prevented an elapsed session from finishing. | Both timer controls use the selected task. One owner-scoped automatic controller stays mounted across application routes, persists completion before advancing, and retains the started task through automatic break/focus transitions. Break API rows still have no task. | `period-timer/before-selected-task-and-cross-route` preserves both real failures; `selected-task-cross-route-six` passes both journeys in all three engines. |

The first expanded run also found defects introduced during this slice: the edit Save button
referenced a nonexistent translation key, and the number validation message changed its
accessible name. Both were corrected using actual pixels/DOM. A second missing-label timeout
came from stale generated catalogues; `messages:merge` was then run. These are recorded rather
than counted as pre-existing product bugs.

Two test mistakes were corrected without changing API behavior: styled `innerText` was compared
with DOM `textContent`, and rollover was expected to archive its source when the documented API
actually completes it. Vaul's intentionally extended drawer pseudo-element also makes the
drawer `scrollWidth` large; bounds checks now inspect the real form controls. A seven-pass visual
run had one truncated Playwright trace/close error (`seven-visual-pass-trace-fault`), which is not
classified as an application failure.

## Control/state coverage

`apps/web/test/e2e/period-timer-boundary.qa.spec.ts` contains 18 functional journeys plus eight
locale/theme journeys. The configuration runs Chromium, Firefox and WebKit with one worker,
zero retries, and zero skipped cases. The complete matrix passed 69/69 (23 in each engine),
preserved in `period-timer/final-sixty-nine/results.json`, before the three extra selected-task,
cross-route and captured-task journeys were added. The final source matrix passed 77/78: its
one Chromium failure was a strict selector matching both the main panel and a closing popup.
That unchanged actual receipt journey passed 3/3 after scoping the final assertion to its intended
tabpanel. The combined evidence therefore verifies all 78 engine/case cells; it is not described
as a single green 78-case report. Reports are `seventy-seven-pass-selector-fault/results.json`
and `final-held-three/results.json`. Neither run used retries or skipped cases.

| Surface/control | Executed state/transition |
| --- | --- |
| Start focus | Saved start; failed transport; committed response lost; exact-row recovery; held receipt prevents a second start across panel/widget tab remount. |
| Pause/Resume | Frozen countdown under controlled time; resume completes the same real session; pending-end Resume is disabled. |
| Skip/Stop | Actual end persistence; held end/shared pending boundary; failed Stop retained and retried; automatic completed intent survives failure/reload; original end time and completion flag are asserted. |
| Automatic phase | Actual focus completion once, configured one-cycle long break auto-start, skip, explicit short-break start, Stop, persisted completed/skipped log rows. |
| Selected task/routes | Actual Today selection followed by full-panel Start persists that task; an elapsed timer completes from Home; choosing another Today task after starting does not retarget automatic focus/break/focus transitions. |
| Settings | Four numeric fields saved via blur/Tab; invalid whole-number range makes no write; Silent saved; auto-start saved; failed draft Retry and Revert; held settings receipt cannot enter a different owner's cache. |
| Cross-account boundaries | Real UI logout/login while actual POST/PATCH responses are held: a previous owner's start/end/settings response cannot replace the new owner's active timer or settings. |
| Read feedback | Real session-log GET failure shows Retry, then reads actual data; initial empty state and open/completed/skipped records are separate. Statistics error source is repaired but its fault path is not separately asserted. |
| Periods | UI create, custom validation, edit, complete, rollover, retained failed edit and retry; failed rollover and retry; open parent/child move while a completed task stays in its source period; actual source status and successor duration checked. |
| Today rollover | Actual UI control preserves an expired custom period's 72-hour duration. |
| Keyboard/reflow | Enter opens Custom/Settings; Escape restores their trigger focus; four locales × two themes × 320×800 normal text and 768×384 at actual 200% typography. Date-dialog submit and final settings checkbox remain scroll-reachable; actual paused timer, statistics and open log captured. Each visual journey starts and stops a real saved session. |

Pixels live under `artifacts/qa/2026-10/period-timer/pixels/` with engine, locale, theme, viewport,
text-scale and state in the filename. The four unit regressions in `pomodoro-owner.test.ts`
cover owner-separated storage, refusing ownerless legacy state, exact persisted ending intent,
pause clock, and corrupt-state fallback. Scoped source/test ESLint and the final shared-source
web typecheck passed after the controller and selector changes.

## Explicit remaining boundaries

This is not every possible input/failure combination. Native notification permission prompts,
audible chime/bell/digital playback, operating-system notification delivery, mute restoration,
concurrent same-owner browser tabs and browser-close start recovery are not proved by this matrix.
The mini widget remains visible only in Personal; automatic completion runs across routes without
adding another header control. Legacy ownerless state is
intentionally not trusted; an old unowned server log is not automatically migrated or closed.
The unchanged API calculates elapsed session duration from timestamps; this slice does not claim
that paused wall-clock time is excluded from its statistics. These exclusions are not passed cells.
