# Event regression audit — 2026-10-08

This ledger concerns local event implementation and explicitly bounded regression coverage. It is not a claim that every event control, viewport, role, locale or theme has been exercised. No production records, deployments, pushes, production migrations, Telegram network calls or application AI calls were used.

## Requirements and reproduced defects

| ID / severity | Surface and state | Expected / observed before repair | Root cause and repair | Evidence and current status |
| --- | --- | --- | --- | --- |
| EVT-01 / high | New-event wizard, Schedule → Capacity | Second Next must show Capacity without publishing. User reported immediate publication. | React could reuse the same native button as its type changed from `button` to `submit` during click activation. Separate keyed Next/Publish nodes; non-final submission and Enter advance only; date-order validation occurs before advancing. | Source and user-report diagnosis; baseline unit checks failed for Enter/date validation/repeated submission, although jsdom's pointer Next test did not reproduce native activation. Fixed real-browser journey proves no POST and an independent empty list after second Next, then one POST after explicit Create in Chromium/Firefox/WebKit. No browser baseline was run with the old button code during another agent's concurrent UI sweep. |
| EVT-02 / medium | Successful creation, detail route | Saved event should open its detail. Actual real Chromium result returned to `/events`. | `onSubmit` navigated to the created detail, then form close navigated over it. Store the created ID and perform one navigation from the close callback. | Real browser test failed on URL before repair and passed after repair in all three engines. |
| EVT-03 / high | Creation/edit, slow or failed save | Repeated submission must persist once; failure must retain form. | No local in-flight lock when the parent pending prop had not updated. Add synchronous guard and local saving state; prevent step/close interactions while saving. | Baseline unit test executed two calls for a double-click; repaired test executes one and retains the failed form with an alert. |
| EVT-04 / medium | Edit wizard, live same-event refetch | An attendee refresh must not erase an unfinished organizer edit. | Effect reset the entire form whenever the EventDto object changed. Reset only for a new open session or different event ID. | Unit regression edits title, rerenders with changed count, verifies draft, then verifies a different event initializes its own data. |
| EVT-05 / high | RSVP, late read / capacity / concurrent write / failure | The actual saved answer and counts must survive late reads; failed answer must not undo unrelated organizer changes. | Optimistic writes neither cancelled older reads nor applied returned DTO, restored whole stale snapshots on error, and allowed competing writes. Cancel old detail/list reads, serialize event writes, apply authoritative result, roll back only `myRsvp`, await final refresh. | Three new cache tests all failed against HEAD, then passed with the fix. Real browser separately verifies yes, persisted reload, waitlist and promotion after another member withdraws. |
| EVT-06 / medium | RSVP note draft, count refresh | An unchanged persisted answer must not clear unfinished note text. | Effect depended on object identity. Depend on event ID and saved answer scalar fields. | Unit regression verifies preservation through a new DTO object and adoption of a genuinely changed answer from another session. |
| EVT-07 / high | Private Telegram RSVP callback boundary | Success may be acknowledged only after an actual authorized RSVP commit. | Old callback emitted `notifications.action.requested`, for which source inspection found no consumer. It acknowledged success without an RSVP write. Call the event service through a fresh, membership-checked principal; preserve prior guests/note; acknowledge actual yes/no/maybe/waitlist after commit. Report refusal and rethrow infrastructure failures for retry. | Fake-bot callback unit tests + real local DB service and independent website API reads. Revoked membership is refused and existing answer remains intact. Telegram network E2E is explicitly excluded, so a real user's historic callback/delivery outcome remains unverified. |
| EVT-08 / high | Connected Telegram group/supergroup event delivery boundary | Committed event/poll intent should queue a separate receipt for every matching connected group. Failed targets must not resend completed targets. | Source supported weekly summary group delivery but had no event group dispatcher. Add outbox subscription and durable per-source-event/group receipts, fresh scope/connection/event checks, sequential atomic leases, bounded retries and sanitized failure codes. | Mocked transport tests and real local migrated DB tests cover actual registered outbox subscription, same-department multiple groups, deduplication, failed-target-only retry, concurrent claim, stale acknowledgment, expired lease, pause, disconnect, event deletion and receipt RLS. No real message was sent. |
| EVT-09 / high | Nested polls/carpools/items/photos/comments, wrong event ID | A child ID under another event's URL must not mutate the original event. | Several child mutations checked child ownership but did not bind child ID to the route's event ID. Require actual parent-event relationship and undeleted event before mutation. | Real local API tests verify seven wrong-parent vote/claim/release/delete requests return 404 and independently read the original records unchanged. Adjacent carpool/poll flow passes in three engines; that older flow uses API mutations and browser list verification, not every nested control. |

## Shared-group persistence design

Existing `app.notification_deliveries` requires a user-owned notification and is governed by owner-only notification RLS. A shared group is not one user and must not receive a private notification's personal callback data. Reusing that queue would require a synthetic recipient or changing its ownership contract. The additive `2005_event_telegram_deliveries.sql` therefore adds department-owned receipts with forced RLS, a department index and a unique `(source_event_id, group_id)` index. Applied migrations are unchanged.

Event writes and their outbox intent commit together through the existing transaction API. The registered subscriber persists receipts separately before acknowledging outbox processing; an outbox retry uses the unique key to avoid duplicate targets. The periodic event worker sends only after a leased receipt is claimed. Each target is checked again immediately before sending. Paused departments retain pending work; disconnected groups, deleted events, irrelevant closed polls or closed non-cancellation events are skipped. Shared messages contain only title, date in the event's valid timezone and a website pointer. They omit description, attendees, contact data, RSVP notes and user-specific callbacks.

Each lease has a token and expires after 60 seconds; concurrent claimers use `FOR UPDATE SKIP LOCKED`. A receipt acknowledgment with an old token cannot update a new claim. Send failures back off from 30 seconds to at most one hour. There are at most eight external attempts, including crash recovery: a ninth claimed lease records an exhausted receipt without sending. A process crash after Telegram accepted a send but before the DB receipt commits can still produce a duplicate on retry. This is **at-least-once**, not exactly-once delivery; Telegram provides no idempotency key for this operation. No live dispatch reliability is claimed from local sink tests.

## Event-owned browser/control traceability

| Surface / states | Executed evidence | Status and remaining scope |
| --- | --- | --- |
| Creation Basics/Schedule/Capacity, Next, Enter, invalid order, explicit Create, pending duplicate, error retention | Wizard unit tests; real creation journey through pointer controls in Chromium/Firefox/WebKit | Fixed and retested for listed transitions. Remaining boundaries: every field limit, category/illustration choice, Back/step jump, full Escape/focus restoration, locale/theme/reflow matrix. |
| Created detail deep link | Real URL assertion after actual persisted Create in three engines | Fixed and retested. |
| RSVP yes/no, counts, Update, reload, capacity waitlist/promotion, independent account reads | Real browser journey in three engines; local DB + cache/draft regressions | Fixed and retested for listed transitions. Remaining browser boundaries: maybe, guests, note submission, deadline/closed event, Undo, attendees drawer and failure/offline/concurrent websocket delivery. |
| Nested carpool and poll workflows | Existing real API journey and event list render; wrong-parent real DB tests | Tested at API/persistence layer; complete browser controls and their dialogs still pending. |
| Items, discussion, photos and feedback tabs | Child scoping API tests for items/comment/photo; source inspection | Complete browser CRUD/error/empty/populated and role matrix still pending. Feedback is not covered by the new tests. |
| List/grid/month/calendar, filters, sorting, ICS/add-to-calendar, organizer edit/cancel/diff and detail tab overflow | Source inspection only in this slice | Pending interaction coverage in broader platform audit. |
| Telegram group connect/settings and private callbacks | Source inspection + local excluded-boundary tests | External E2E excluded by goal; production connection kinds/permissions and historical user updates not read or changed. |
| Application AI draft | Disabled/unavailable hook boundary in wizard unit; real local API environment keys scrubbed | External E2E excluded by goal. No AI response-quality claim. |

## Commands and observed results

Commands run from repository root with pnpm 11.15.0. Integration tests create a fresh Testcontainers PostgreSQL and use the real Fastify app. Browser tests use isolated `devon_flow_e2e_events`, API port 48921 and web port 48922; global setup rejects nonlocal/unsafe DB and scrubs external integration configuration. No default developer or production database was reset. Dedicated absolute browser output directory prevents concurrent suites cleaning each other's results.

```powershell
pnpm --filter @devon/web exec vitest run --config test/vitest.config.ts test/unit/event-form-dialog.test.tsx test/unit/event-rsvp-cache.test.tsx test/unit/event-rsvp-panel.test.tsx
pnpm --filter @devon/api exec vitest run --config test/vitest.config.ts test/integration/event-consistency.test.ts test/unit/events test/unit/telegram.rsvp.test.ts test/unit/telegram.commands-safe.test.ts
pnpm --filter @devon/db exec vitest run --config test/vitest.config.ts test/unit/migration-lint.test.ts test/unit/tenancy.test.ts
$env:FLOW_DB_NAME='devon_flow_e2e_events'
$env:FLOW_API_PORT='48921'
$env:FLOW_WEB_PORT='48922'
pnpm --filter @devon/web exec playwright test --config test/e2e/event-regressions.config.ts --workers=1
```

- Browser: **6/6 passed**, Chromium/Firefox/WebKit desktop configurations, real local creation and persistence plus adjacent API-based carpool/poll journey. No retries or forced clicks.
- API expanded adjacent-rule batch: **107/107 passed**, 8 files including 5 real-DB consistency tests, existing event route/permission/logic/ICS tests, delivery/callback boundaries and existing Telegram command-safety. The earlier focused subset passed 42/42.
- Web final focused batch: **9/9 passed** (5 wizard, 3 cache, 1 RSVP-draft).
- Migration lint/tenancy registry: **15/15 passed**.
- Final API, web and DB type checks passed after schema-parsing independent JSON reads. Targeted event API/web source/test ESLint passed. Affected final browser rerun after the RSVP-draft repair again passed **6/6** across Chromium/Firefox/WebKit.
- Independent review of the shared realtime invalidator found the deferral/flush strategy coherent; its six unit cases passed, including newly added unrelated-rule and dispose-before-settlement cases. This is cache-level evidence, not an actual broker journey.
- Baseline cache check: **3/3 intentionally failed against HEAD**; fixed file automatically restored in `finally`. Baseline wizard check: 3 failures in the original four-test batch. These are failing-before evidence, not passing checks.

### Pixel evidence actually opened

Opened and visually inspected Chromium desktop full-page captures at 1280×720 from `artifacts/qa/2026-10/results/events/event-wizard-rsvp.flow--fl-c3440-rsists-RSVP-across-sessions-chromium/`:

- `wizard-capacity.png`: final wizard remains open after Next; Create is a distinct primary control, Capacity is focused, Back is separated.
- `member-rsvp-saved.png`: persisted answer presents Update, capacity text 1/1 and one attendee. The progress bar was captured during its fill animation; this frame alone does not establish the settled fill width.

The corresponding two Firefox and two WebKit captures were also opened and visually inspected. Their native input rendering differs appropriately by engine; no clipping was apparent in these desktop captures. WebKit records 2560×1440 device pixels at a 1280×720 CSS viewport. These desktop English/light examples are **not** full mobile, locale, theme, short-height, text-zoom or reflow coverage. Those remain explicit pending inventory states, not implied passing visual checks.

## Residual limits and handoff

The changes are local and uncommitted in the shared workspace. Production behavior still depends on a future authorized release and additive migration; this work did neither. Telegram delivery and application AI remain excluded from external E2E. Independent two-account WebSocket broker verification belongs to the shared realtime audit; local query-cache race tests cannot substitute for an actual broker journey. Full event nested-tab interaction, all role/locale/theme/state combinations and accessibility/production-build gates remain owned by the wider audit and must be reported separately.

An existing `pg@8.23.0` deprecation warning appeared in the real DB suite: overlapping `client.query()` calls on one connection will be unsupported in pg 9. Rerunning with `NODE_OPTIONS=--trace-deprecation` still passed 5/5 DB tests and traced the warning into Drizzle's execute path. Event service/repository `Promise.all` reads/writes on the same transaction and the shared context's parallel flush are source candidates; the library-only stack does not conclusively identify one caller. This warning was reported to the shared DB owner and was not suppressed or misreported as fixed.
