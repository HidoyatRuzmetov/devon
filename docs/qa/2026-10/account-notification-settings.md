# Account and notification settings boundaries

This is a bounded local audit of profile identity, appearance, personal notification preferences,
quiet hours and the unconfigured Telegram settings boundary. Fixtures are synthetic; the browser
and API harness restrict transport to owned local services. No Telegram, application-AI, SMTP or
web-push delivery was called. No production mutations, commits, push or deployment were performed.

## Reproduced defects and repairs

| Actual failure                                                                                                                | Repair                                                                                                                                                                                             | Evidence                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A held quiet-hours PUT200 replaced newer unsaved time input.                                                                  | A local draft revision keeps newer typing after the acknowledged save.                                                                                                                             | `settings/before-draft-and-owner`; final boundary gate.                                                                                                                                               |
| A held preference or quiet-hours reply after real logout/new login entered the new owner's cache.                             | Capture owner/CSRF at public submission; check owner before transport, cache merge and callbacks.                                                                                                  | `settings/before-draft-and-owner`, `settings/before-quiet-owner`; final boundary gate.                                                                                                                |
| A held reset from department A replaced the effective default displayed after an actual switch to B.                          | Capture department with the command and merge into that captured cache key. A changed context cannot announce success.                                                                             | `settings/before-department-context`; final boundary gate.                                                                                                                                            |
| A real quiet-hours422 rejected after account replacement still showed the former owner's global error toast.                  | Check scope on both promise resolution and rejection; preserve the original error only for the same current context.                                                                               | `settings/older-receipt-before`; final boundary gate.                                                                                                                                                 |
| A foreign selected department ID returned its default and admitted a less-quiet personal write.                               | Canonical department-child read authorization runs before reading settings or persisting an override.                                                                                              | `settings/quiet-department-before.json`; `settings/quiet-api-final.json`.                                                                                                                             |
| Saving Position from a stale second tab reverted a username changed separately in the first tab.                              | Send only changed profile fields using the existing partial PATCH contract.                                                                                                                        | `settings/before-profile-owner-and-disjoint`; final boundary gate.                                                                                                                                    |
| A delayed profile save after logout/new login replaced the new owner's visible identity.                                      | Capture and recheck profile owner before sending and before any cache/toast update.                                                                                                                | Same before report; final boundary gate.                                                                                                                                                              |
| An authoritative GET showed a newer remote username; a preceding held PATCH receipt then reverted it while catch-up was held. | Acknowledge submitted fields only when their current authoritative value still equals the captured baseline/submission. Preserve unsubmitted fields and later GET values; invalidate for catch-up. | `settings/older-receipt-before`; final boundary gate.                                                                                                                                                 |
| The actual quiet-window422 had no specific visible explanation.                                                               | Return the standard validation Problem with a `quietHours/quiet_hours_too_loud` field error. Replace obsolete feature-local transports, which discarded errors, with the existing shared client.   | `settings/quiet-feedback-before`; real API four-case proof and nested UI validation/retry.                                                                                                            |
| At320px Firefox Tab stopped on an anonymous horizontal scroll container instead of the switch assumed by the initial fixture. | Give the region a translated name, explicit keyboard entry and visible focus; Tab/Space reaches and persists the switch.                                                                           | `settings/keyboard-focus-before`: actual focus was DIV, no role/name,286px client width/560px content. `settings/nested-thirty-three` proved ArrowRight scrolling before the subsequent width repair. |
| The redundant Telegram heading action squeezed the200% notification heading into word fragments.                              | Keep Telegram in the visible settings navigation and remove its duplicate heading action.                                                                                                          | `settings/nested-first-twelve-and-fixture-failures/header-before.png`; final selected pixels.                                                                                                         |
| At200% text size, the selected Uzbek Latin language was clipped inside the native select.                                     | Stack Appearance controls according to their container's available width.                                                                                                                          | `settings/appearance-value-before`:225.22px selected text versus149px available. `settings/final-label-thirty-three` measured full selected labels across the matrix.                                 |
| The rendered ProfileSection accepted an uppercase username as natively valid because its HTML pattern was ignored.            | Escape the literal hyphen for the browser's Unicode-set pattern grammar. Uppercase, spaces and `@` are refused before any PATCH; a valid dotted/dashed username saves.                             | Actual Chromium `settings/username-pattern-before`; all-three final27 below. Independent all-three isolated native-input proof supports the same syntax diagnosis.                                    |
| At320px, the preferences table showed notification types while every Telegram switch was offscreen.                           | Move immutable In-app/Always on information above the native table; keep all ten reason switches in visible responsive columns and wrap reason labels.                                             | `settings/hidden-mobile-controls-before`; `settings/final-responsive-thirty-three`.                                                                                                                   |

All report directories above are under `artifacts/qa/2026-10/`. The original selected-department
before gate had2 failures/1 pass. The older-receipt before gate had2 actual failures. The first
nested gate also had strict duplicate-link fixture failures at768px; those were corrected by
scoping navigation to the actual Settings sections. They are not reported as product defects.

## Executed gates

- `settings/final-twenty-seven/results.json`:8 timing journeys plus native username validation ×
  Chromium/Firefox/WebKit, **27/27 passed**, zero retries/skips. Held responses forward real API
  status/body, not invented success.
- `settings/quiet-api-final.json`: **4/4 real database/API tests**: foreign read/write refusal,
  own department success, standard422 and unchanged persisted override on refusal.
- Existing profile replay: `settings/profile-prior-five-and-click-failure/results.json` had
  **5/6 passes**. The Firefox interrupted retry did not show a second PATCH in its trace; the
  fixture now explicitly counts the interrupted transport. `settings/profile-interruption-three`
  passed the corrected replay **3/3**. The earlier failure's cause was not conclusively established;
  the original report and trace remain separate from the later observed interrupted requests.
- `settings/final-label-thirty-three/results.json`: **33/33 passed** before the responsive table
  repair, including selected native-label measurements. The earlier32/33 and strict fixture failures
  remain preserved. `settings/final-responsive-thirty-three/results.json` **passed33/33** against
  the final responsive source, zero retries/skips: nine functional cases plus24 render cases.
- Final API/web TypeScript, scoped API/web ESLint and owned source/test Prettier checks passed.

The nested matrix changes Language and Appearance through actual profile controls, reloads and
checks them, then visits Profile settings, Notification preferences and Telegram. Its24 visual
cases cover four locales × two themes × three engines at320×800 normal text and768×384 with
actual200% typography tokens. Geometry checks and captured pixels do not prove every nested
security/photo dialog or every field validation. Full-page capture avoids sticky-toolbar artifacts
produced by oversized main-element screenshots; separate appearance captures inspect those controls.
The final responsive assertions additionally require all ten Telegram switches to fit within the
table region without horizontal scrolling and every localized reason label to be unclipped.
Only explicitly listed selected pixels were read, not every captured image. Final selected reads
include `chromium-en-light-320-1-account-notifications.png`,
`firefox-uz-Cyrl-dark-768-2-account-notifications.png`,
`chromium-uz-Latn-dark-768-2-account-appearance.png`, and
`webkit-ru-dark-768-2-account-telegram.png` under `settings/nested/`. The full-page mobile capture
includes the fixed bottom navigation at the viewport boundary; it is not an extra content row.

One responsive rerun omitted per-call namespace environment values, began in the harness's default
`devon_flow_e2e` namespace, and was interrupted after two cases. No concurrent agent used that
namespace; owned processes were gone before the correct48971/48972 rerun. Ctrl-C did not write a
fresh JSON report: argv inspection found that the old report belonged to the preceding before
failure, so its mistaken copy was removed. The actual incident is recorded under
`settings/namespace-setup-interrupted/incident.json`; it contributes no passing coverage.

## Transport accommodation and limits

HTTP loopback WebKit cannot accept the production Secure-cookie switch/login responses normally.
The test-only adapters are exact-origin, exact-path POST allowlists. They forward real successful
responses and actual cookies with only standalone Secure removed; unsuccessful responses are
unchanged. The active-department adapter is explicitly installed only by this settings fixture.
Production cookie/auth/status behavior is unchanged. APIRequestContext similarly refuses browser-issued
Secure cookies over HTTP; persisted new-owner checks use its independent, already authenticated
fixture context. An earlier verifier401 report is retained as a transport limitation, not an application bug.

Not established: actual production HTTPS/cookie behavior, external Telegram connection/delivery,
email capability/delivery, web push, OS clipboard success, every personal preference reason/failure
combination, all account security dialogs in all locales, system-theme resolution, timezone editing,
same-field concurrent profile conflict prevention or an ABA receipt/version guarantee. Profile partial
patches prevent unrelated stale-field replacement; this is not a server-side compare-and-swap design.
The existing field-by-field null quiet-hours inheritance and coarse quieter-than-default rule remain
the documented contract. Current department authorization does not claim a held concurrent Leave race.

## Reproduction

Run from `apps/web`, with the owned namespace and ports:

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_settings'
$env:FLOW_API_PORT='48971'
$env:FLOW_WEB_PORT='48972'
pnpm exec playwright test --config test/e2e/settings-qa.config.ts
pnpm exec playwright test --config test/e2e/settings-nested-qa.config.ts
```

Run sequentially: each setup owns one API stack and the shared local database pool has a bounded
budget. The two configurations have unique absolute result directories. The real API contract gate
runs from `apps/api` with `pnpm test:unit test/integration/notification-quiet-department.test.ts`.
