# Ordinary workflow release — October 12

This release closes the current colleague-facing repair batch. It does not claim every possible
control/state combination was tested. Earlier improvements already deployed in `af078d3` remain
documented in their original ledgers; this document describes the additional changes. Its table is
the pre-push local verification snapshot. Exact commit, GitHub CI and deployment receipts are
collected afterwards in the release handoff; they cannot be embedded retrospectively into the
same immutable source commit.

## Changes

- The people board has themed thin native scrollbars, separate left/right edge fades, searchable
  person navigation, My column and boundary-aware previous/next controls. Add card stays in the
  sticky member header. There are no extra per-column scroll regions or intercepted wheel gestures.
- Structure retains a failed unit-create draft, refreshes assignment counts and sends only one
  mutation on a row drop. Reparenting correctly updates descendant paths in PostgreSQL.
- Approval creates the requested department units atomically, preserving order and categorical
  colours. Closing rejection clears its abandoned draft; rejected/approved status text matches the
  recorded decision and explains recovery.
- Personal reminders are claimed under the actual owner's department context. Existing FORCE RLS
  privacy remains enforced. Delivery refreshes the open card's Pending/Sent status through the
  existing Inbox event. After-done recurrence uses actual completion, including its time of day;
  unfinished work no longer promises an old fixed next date.
- A rejected background session-activity write is logged without raw database details and cannot
  terminate the API. Session authentication, expiry and revocation still use their existing checks.
- CI adds the real board, Structure, invitation, department decision, work-worker and antivirus
  browser regressions after a fresh production frontend build. QA reports retain only explicit
  server environment overrides instead of serializing ambient credentials. A copied-config fixture
  is outside recursive browser-test discovery, avoiding a teardown/listing race.

## Verification

The stable genuine production React frontend input hash is
`10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`, with `DEVON_E2E=0`.
The local browser API is the actual source runner, not the Linux production API image.

| Check                                              | Actual result                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Workspace type checks and lint                     | Passed; existing lint warnings remain nonblocking                                                          |
| Full API suite                                     | 964 passed before the last session-activity regression; its final focused suite passes11/11                |
| Full frontend suite                                | 320 passed                                                                                                 |
| Four-locale validation / secret guard              | 3,718 keys, 2,097 used, zero errors / zero hits                                                            |
| Real PostgreSQL regressions                        | Department units2/2; Structure reparenting2/2; reminder privacy/concurrent claims4/4                       |
| Board / Structure, three engines                   | 6/6 and9/9, zero retries or skips                                                                          |
| Decisions / invitation passwords, three engines    | 3/3 and6/6, zero retries or skips                                                                          |
| Actual scanner, three engines                      | 6/6; clean publication, harmless antivirus refusal, outage and same-upload recovery                        |
| Work workers, three engines                        | 11 initial passes plus the exact failed fixture case's fresh1/1 replay; original11/1 report retained       |
| Deployment/recovery source guards                  | Original65 passes,2 failures,1 Linux-only skip; affected14 guards pass after the fixture/report-env repair |
| Inventory matcher/applicability guards             | 12/12 passed; unlisted combinations remain pending                                                         |
| Standard production browser / accessibility suites | 21/21 browser cases passed; final4 accessibility cases executing at this snapshot                          |
| GitHub / production                                | Exact-commit CI and deployment receipts collected after this snapshot                                      |

The original parallel browser attempt exhausted the shared local PostgreSQL100 connection budget.
Every API already bounds its application pool and five separate real queue pools, but seven
simultaneous scopes exceeded the shared server's total. Final replay limits simultaneous scopes;
CI executes them sequentially. That attempt is retained as failed evidence. PowerShell also removed
an unquoted `@a11y` argument in the original root invocation; the final command quotes it, preserving
the intended21 non-accessibility cases, one worker and zero retries. Neither failure is counted as a
passing browser gate. The raw rejecting-promise session regression produced three unhandled errors
before repair and none afterwards.

The original strict slow-4G performance budgets remain failed in their recorded historical scope;
this batch does not relax them or claim a current performance pass. Application AI and Telegram
external end-to-end verification remain excluded per the user's instructions. Extreme enlarged-text
and tiny-screen matrices are deferred by the user. Local encrypted backups remain the approved
backup destination. Production review is read-only; tutorial recording awaits separate user approval.

Detailed actual reports, native-pixel review limits and reproduction commands are in
`board-navigation.md`, `structure-authoring.md`, `department-decisions.md`,
`invitation-password.md`, `work-workers.md` and `scanner-upload.md`.
