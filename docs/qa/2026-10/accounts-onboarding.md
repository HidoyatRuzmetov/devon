# Accounts, invitations and department settings QA — October 2026

This is local functional evidence using synthetic accounts, real API/database/storage and actual
browser actions. Account tests own `devon_flow_e2e_account`; department tests own
`devon_flow_e2e_departments`. Both use API/web 48971/48972 sequentially. Application AI, Telegram,
SMTP and other external calls are excluded by the API transport guard and browser origin guard.
The API runs in development mode with the explicitly recorded scanner-off exception. This does
not prove production TLS, ClamAV or external integration behavior.

## Reproduced account defects

| Observation | Repair | Evidence boundary |
| --- | --- | --- |
| An invitation key was lost after existing-user sign-in; the browser landed at `/`. | An exact same-origin `/join` return survives sign-in, 2FA and registration. Other destinations, credentials and controls are refused; invitation passwords are never retained in the return URL. | Actual failing sign-in screenshot/trace in `account/before-invitation`; later real membership joins. |
| Successful profile saves remounted the form and erased text typed while the request was pending. | Stable form refs preserve newer dirty text; normalized server values replace only the submitted revision. | Original regression report in `before-profile-and-password-results.json`; original failing traces were cleaned by a subsequent Playwright run and are not claimed preserved. |
| A too-short new password claimed the current password was incorrect. | Distinguish validation 422, current-password refusal 403 and transport/server failure. Explain the existing length/common-password requirements. | Actual API 422 and UI error in the original regression report. |
| TOTP enrollment transport failure had no visible response. | Enrollment, session revocation, deletion request/cancellation and settings reads expose failure and preserve state for retry. Recovery codes have separate Copy and Done controls; cancellation closes incomplete enrollment. | Before-fix screenshot/trace in `account/before-settings-failure`; actual successful retries and persisted state. Separate Done/Cancel changes are usability improvements, not independently recorded before-fix browser defects. |
| The login form advertises email, but a real saved profile email returned 401. | Exact username lookup remains first; otherwise only a unique trimmed, case-insensitive email can identify the account. Blank/ambiguous aliases fail closed. Password/status/TOTP/throttle checks remain the existing flow. | Actual failed email login trace in `account/before-email`; real email login, ambiguity and wrong-password refusals. |
| Pasting the whole invitation URL into the manual key field returned 422. | Shared local normalization accepts the token, `key=...`, or a plain HTTP/HTTPS `/join?key=...` link. Invalid schemes, credentials and non-token characters remain invalid. Add an explicit readonly Key and Copy key control alongside Copy link. | Exact raw 12-character key worked before the repair; this user-reported raw-key failure was not reproduced. Whole-link paste failed in `account/before-manual-link`. |

The administrator temporary-password path already passed real reset → profile change → logout →
old password refusal → new login in Chromium. The UI now explains that the temporary password is
the current password, supports Enter submission and refreshes the flag. Successful sign-in guides
these users to the actual password section, while preserving explicit invitation returns. This is
navigation/feedback repair; no new mandatory password gate was added.

## Browser transport accommodation

The first three-engine account run recorded **35 passed, 7 failed**. Two failures were a newly
written test's strict locator matching both the temporary-password notice and success status during
the real `/me` refresh. Five WebKit failures came from its refusal of production Secure cookies on
the harness's plain HTTP loopback. Both causes are test/harness defects, not new product defects.
That report and failed artifacts are retained in `account/before-local-cookie-adapter`.

The WebKit-only `flow-ui-cookies.ts` accommodation intercepts exact POST login, registration and
2FA-login endpoints on the literal guarded HTTP origin. It uses the actual API response with
redirects disabled, applies only successful actual Set-Cookie values through the local fixture jar,
and forwards the actual status/body and all other headers. Only the standalone Secure attribute in
successful Set-Cookie headers and the jar's Secure flag change; domain, path,
expiry, Max-Age precedence, HttpOnly and SameSite are retained. Invalid/foreign cookie attributes
are refused. Production cookie code is unchanged. No fake authentication success counts as proof.

## Coverage and current gate status

All 15 account journeys have passed in each engine across retained runs, with zero retries or skips:
Chromium 15 in `before-cookie-header-adapter/results.json`; Firefox 14 in that run plus the corrected
delayed-profile case in `final-firefox-profile-results.json`; WebKit 15 in `final-webkit/results.json`.
This is aggregate coverage from separate runs, not a single uninterrupted 45-case green matrix.
The intermediate Firefox delayed-save test timed out while replacing its interception pattern;
keeping the route installed and delaying only the first save made the real response/draft/persistence
proof pass. No new production profile defect is inferred from that intermediate timeout.
The WebKit jar-only adapter first failed because the forwarded Secure header re-applied the flag;
that failed report is retained in `before-cookie-header-adapter` before the narrow header repair.
The QA source covers these real journeys:

- Existing-user sign-in and new registration from an invitation; wrong join password and actual roster membership.
- Every profile field, reload, renamed username, email login, collision refusal, interrupted save and newer draft during a delayed actual successful response.
- Short/wrong passwords, actual password change, own/foreign session revocation and all-session sign-out.
- Real TOTP enrollment using an independent RFC 6238 code generator, invalid code, recovery-code login and password-confirmed disable.
- Telegram's profile-settings location and actual unconfigured status; no external connection attempt is counted.
- Notification preferences' real In-app header and absence of Email.
- Typed account deletion request, reload, cancellation and interrupted nested settings mutations.
- Actual PNG signed upload/finalization and generated WebP variant, invalid bytes, interrupted PUT, retry and photo removal.
- Administrator reset, temporary-password profile change, cleared flag, old-password refusal/new login, and invitation-return precedence.
- Exact raw key and a whitespace-surrounded full invitation URL through the manual form.

Screenshots are English/light, mainly 390px, with the registration form at 320px. They do not
establish four-locale/dark-theme account coverage. Traces contain only synthetic local account data;
TOTP secrets/recovery codes are not included in published screenshots. No production data changed.
The final registration capture was rerun in all three engines (**3 passed**) and waits for the
actual entrance filter to reach `blur(0px)`. The 320px form and invitation images were inspected as
pixels; fields, photo control, submission and invitation Join are readable and fit. Profile/photo,
Telegram-unconfigured and department permission/invitation captures were also inspected. Full-page
images include the viewport-fixed bottom navigation at its capture position; they do not establish
every scrolling state or a fixed-overlay layout defect by themselves.

Focused route units: **26 passed** across auth email, session and invitation normalization. Cookie
transport/auth-return units: **23 passed**. API, contracts and web type checks passed; scoped source
and QA lint has zero errors. The existing Login/ConfirmDialog autofocus warnings remain warnings.

## Department defects and current evidence

The corrected before-fix six-case run reproduced: an unsaved permission erased by an unrelated
feature-save refetch; missing transport feedback for invite rotation, join, head-managed password
reset and department deletion; and an empty view for a member's head-only deep link. Those traces
are retained in `departments/before-six-product-defects`. Draft refs now preserve unsaved permissions;
operation errors stay visible and retryable; privileged deep links fall back to permitted readonly
General settings. A demotion clears the readonly permission draft and resynchronizes actual data.

Reopening a failed reset retained its previous error (`before-dialog-lifecycle`). Each new selection
now resets its selected error. A confirmed action captures its target before transport, permits Close
or Escape while explaining that closing does not cancel it, and blocks another destructive action
until settlement. The pending lock survives tab remounts through the department mutation key. Late
callbacks dismiss only their own selection, and the actual reset receipt appears once after Close
while its tab remains mounted. Successful membership writes invalidate real roster/detail/session
views. This pending design is a safety/usability repair; the original Cancel-enabled observation is
not counted as a requirement to trap users in a pending dialog.

The earlier transfer-to-Leave timeout was a test race: it clicked the still-closing transfer dialog
after its title changed to Leave. Waiting for that dialog to disappear fixes the locator race; the
actual role transfer had already refreshed correctly. The next 27-case run passed all eight core
journeys in every engine (24), while the three new pending tests collided with the two legitimate
Close buttons. That harness report is retained in `before-close-locator-correction`. A subsequent
attempt could not boot during the independently owned personal receipt export edit; no department
test ran and no product department failure is inferred from that startup attempt.

The final 10×3 department gate **passed all 30 cases**, zero retries/skips, with the retained report in
`departments/final-thirty/results.json`. The added removal case independently exposed a real bug:
historical `status=removed` rows appeared as ordinary members with action menus even after actual
removal 204 and the removed member's 403. All three engines reproduced this in
`before-removed-roster`; the current-team view now filters those historical rows without deleting
the underlying membership. The final gate covers real permission save/refetch/failure, key rotation,
join failure/retry, readonly permission/API refusal, head reset/failure/temporary login, typed deletion,
clean reopening, transfer followed by former-head Leave, Close with a late reset receipt, and removal
with a cross-tab pending lock. The later approval/rejection/Undo evidence is recorded below;
custom invitation-password/password-rotation nested journeys are not claimed covered by this slice.
Key copy controls are present, but system clipboard success
is not established by merely seeing the controls. The invitation password field now displays and
enforces its existing 8–128-character input range.

## Join-decision transition repair and final gate

After the final30 gate, a separate real late-Undo journey reproduced UI Approve204 → another
committed Remove204/member403 → older toast Undo204. A read-only SQL query in the owned test
database confirmed the removed member persisted as `pending_approval`, with the append-only audit
sequence `join_approved` → `member_removed` → `join_decision_undone`. The before report/trace is
retained in `departments/before-stale-undo`. This is now a confirmed backend transition defect,
not just the earlier source hypothesis. Undo now names the original decision and exact resulting
membership version; the transaction checks eligible actor/target accounts, active head/member roles,
expected status and receipt version while locking users before memberships. Approval/rejection and
Undo increment the existing membership revision. Remove, Leave, rejoin and head transfer invalidate
an earlier receipt. Legacy approval/rejection bodies remain accepted; Undo without a receipt returns409.

The first expanded receipt matrix passed six cases and failed the three account lock/unlock cases:
the administrative membership revision UPDATE had silently affected no rows under the empty
department RLS context. That report is retained in `before-admin-receipt-rls`. The independently
owned admin repair scopes each target department within the same user-locked transaction and
restores the original empty context before audit flushing. Its actual44-case DB proof belongs to
the admin ledger; this slice reran its true account lock/unlock/Leave/rejoin/transfer browser journey.

The corrected four-journey receipt/rollback matrix **passed12/12** across all three engines in
`departments/final-receipts-twelve-results.json`. It verifies immediate UI Undo once, rejection Undo,
malformed/wrong-state/superseded/duplicate refusal, concurrent approval versus rejection and
concurrent duplicate Undo with exactly one winner, and concurrent removal remaining final. A
target-specific temporary trigger in the owned test database rejects the actual outbox INSERT:
real Undo500 leaves membership, revision, audit and outbox unchanged; removing that fixture trigger
and retrying produces Undo204 and all expected changes atomically. No success response is invented.

Removal, Leave, transfer and Undo now emit identifiers-only `departments.membership.changed` in
the same transaction. SQL verifies the committed Undo outbox record and its absence on rollback.
The root-owned realtime invalidator and actual broker freshness journey are separate evidence.

An additional actual pending-response test exposed enabled Approve/Reject after closing a still
pending invite rotation and remounting Members (`before-join-pending-controls`). Join decisions now
respect the shared department pending count and synchronously guard submission, including an old
toast Undo; blocked Undo preserves its toast and gives wait feedback. Its initial ambiguous Close
locator failed before reaching that assertion (`before-join-pending-locator`); using actual Escape
corrected the harness without weakening the control/state assertion.

The final **16×3 gate passed48/48**, zero retries/skips, in
`departments/final-forty-eight-results.json`. It reruns all core department paths and all new pending/
receipt/atomicity paths against the final department source. The separate bounded control/state
overlay is `account-department-file-controls.md`; it explicitly retains unexecuted combinations.
