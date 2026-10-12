# Recurring tasks and personal reminder delivery

This ledger covers four ordinary browser journeys using synthetic local tasks, the real API,
migrated PostgreSQL, PgBoss workers, Valkey and Centrifugo. AI, Telegram, email and external
destinations are excluded and blocked. It does not establish whole-platform completion or external
message delivery. All four named journeys are now proved in Chromium, Firefox and WebKit. Earlier
interrupted and failing runs are retained rather than relabeled as passing.

| User-visible defect | Actual evidence before repair | Repair |
| --- | --- | --- |
| Personal reminders never arrive, although their worker jobs complete. | `work-workers-before-persisted.jsonl` records completed real jobs, an overdue unsent reminder and no reminder notification. The real PostgreSQL privacy regression confirms a global administrator cannot claim owner-private reminders. | Enumerate only eligible membership IDs with a stable keyset cursor, then claim each owner's reminders with the exact owner and department RLS context. Each tick examines at most 200 owners and claims at most 100 reminders. Other owners get a turn even when an earlier owner's backlog fills the send budget. No privacy policy or administrator access is widened. |
| Completing an overdue after-done task creates a successor that is already overdue. | `work-workers-completion-before/.../worker-completion-before-interval.json`: completion on October 9 at 15:00 created the daily successor due October 7 at 14:59. | Anchor after-done recurrence to actual `doneAt` or the standalone card's completion through `archivedAt`, including its time of day. Scheduled recurrence keeps its original scheduled anchor/time. |
| The Repeat editor promises an old fixed date for unfinished after-done work. | `release-gates/recurrence-preview-before.log`: all four focused assertions fail against the old preview, including completed and unfinished tasks and changing mode. | Supply the real completion date separately. Before completion, explain that repetition waits for completion; afterwards, preview from that completion. Changing to scheduled repetition restores the scheduled preview. |
| The open task still says Pending after its personal reminder arrives. | Two original `work-workers-fixed` failure PNGs show the delivered Inbox row and the editor's stale Pending chip after an independent sent stamp read. The focused `reminder-live-before.log` assertion fails: the active reminder query stays unsent after its own Inbox event. | Refresh the reminder query prefix on the existing session's Inbox event. This refreshes only personal reminder reads, without broad work-board invalidation or new polling. The same reminder journey now checks Sent on the still-open editor before reload. |

`work-workers-before` contains an initial test expectation error: standalone Mark done intentionally
archives its task, so expecting public status `done` was incorrect. This is not a product defect.
`work-workers-fixed` was interrupted without a final JSON report. Its log proves the three Chromium
recurrence journeys passed, then the reminder test failed because its global row locator also matched
a hidden, force-mounted Inbox tab. That failure occurred after the actual sent stamp and single
notification were read successfully. The locator now selects the visible semantic tabpanel; the
original failure is retained rather than presented as a notification bug or passing final run.

The current combined preview and realtime regression passed 18/18; web typecheck and scoped lint
passed. The preview alone passed 4/4 after failing 4/4 before its fix. The existing
API worker unit regression covers completion anchors, time preservation, recurrence limits and the
bounded/fair owner scan. The PostgreSQL regression covers FORCE RLS privacy, eligible owners,
disjoint concurrent claims including the 101st reminder, and persisted notifications for two owners
in different departments without duplicate delivery on redelivery. Their final release gate is
owned by the root closeout.

## Final bounded result

`work-workers-compiled-final` ran all 12 cases with zero retries or skips: 11 passed, and Chromium
after-done failed while its short-lived PgBoss fixture producer started, before product assertions.
The filtered local PostgreSQL logs confirmed reserved-slot exhaustion: seven simultaneous local API
scopes exceeded the shared 100-connection limit. The existing guarded harness already limits each
API's application pool to six and each PgBoss pool to two; these are separate pools. Local closeout
now coordinates at most four scopes concurrently, and CI invokes the suites serially. No worker,
privacy policy, assertion or production pool limit was weakened.

After the original handle completed and its owned services/ports were removed, the one exact failed
Chromium case ran with fresh fixtures in `work-workers-after-done-replay` and passed 1/1. This proves
12 distinct cases across the two reports, from 13 executions including the preserved fixture
failure. It is not a claim that the initial 12-case report was all green. Both runs used the same
stable production web build input SHA
`10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`.

The reminder passed in all three engines: the still-open editor changes to Sent, one Inbox row is
persisted, real WebSocket publications include `inbox.notification.created`, queue redelivery does
not duplicate it, and reload/deep link retain the result. Actual dates, card counts, reminder sent
stamp and notification body are independently read. All owned worker ports were free after the
precise replay's normal teardown.

Source hashes, exact report counts, commands and boundaries are in `work-workers-evidence.json`.
All 15 original native PNGs were opened individually; `work-workers-pixels.json` records their exact
scope. Chromium's Sent row and all three Inbox reminder rows are readable. Recurrence captures show
the readable card header while the rule/date controls are below the captured viewport. Firefox and
WebKit Sent captures caught the disclosure opening fade and do not prove settled panel readability.
Those limits are retained; passing UI assertions are not substituted for inspected pixels.

## Reproduce the four real browser journeys

The Docker images required by `flow-services.ts` must be cached. The shared local PostgreSQL service
must be available at the harness's guarded loopback port. PowerShell:

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_worker'
$env:FLOW_API_PORT='48971'
$env:FLOW_WEB_PORT='48972'
$env:FLOW_CENTRIFUGO_PORT='48973'
$env:FLOW_REALTIME='1'
$env:FLOW_SEED_DEMO='1'
$env:FLOW_CLAMAV='0'
$env:FLOW_PRODUCTION_BUILD='1'
$env:DEVON_E2E='0'
$env:QA_RUN_ID='work-workers-compiled-final'
pnpm --filter @devon/web exec playwright test --config test/e2e/work-worker-qa.config.ts
```

The preserved exact one-case replay used the same environment, with
`QA_RUN_ID=work-workers-after-done-replay` and added
`--project chromium --grep 'real after-done recurrence'`. It runs fresh fixtures, not a Playwright
automatic retry or an assertion bypass. Do not start more than four local API fixture scopes at once.

The compiled flag requires a fresh stable web build receipt created through
`tools/perf/web-build.mjs`; it refuses stale source. It compiles the web UI while the harness runs
the real API source in development mode so its actual work jobs are scheduled. This is not a claim
that the browser harness starts the compiled production API. The queue producer has its own
short-lived fixture login, one connection and no workers; it can enqueue only the two owned work
queues, and its login is removed on disconnect. The native reminder picker uses its actual minute
precision; tests wait for real eligibility rather than editing database times or clocks.

The four journeys verify scheduled successor/count/no duplicate after queue redelivery, stop-date
expiry without an extra successor, after-done waiting/completion/interval/no duplicate, and a
personal reminder's real sent stamp, single persisted Inbox row, visible live update, reload and
working card deep link. Counts and persistence are independently read from the fixture database or
API. No new tiny-screen or enlarged-text matrix is added.

The existing claim stamps `sent_at` before later notification persistence. A notification-persistence
failure between those steps is not exercised or repaired by these journeys; these results cannot
prove exactly-once delivery across that boundary. This limitation does not diminish the observed
normal reminder failure or the actual privacy-preserving repair.
