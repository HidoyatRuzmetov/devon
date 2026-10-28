# ADR-015: Fortnightly deliverables and workspace retirement

Date: 28 October 2026. Status: accepted by the user's implementation request.

## Decision

Checklist items are the deliverable unit. A cycle begins in draft, becomes agreed at check-in, and is frozen at checkout. Later additions increase the denominator. Blocked and unfinished items do not count as completed. A closed checkout stores a snapshot so subsequent checklist edits cannot rewrite history. Unfinished items are copied into the next draft without an age badge and may be removed there.

Cycle boundaries and Telegram reminders use Asia/Tashkent. The initial draft remains open until Monday 2 November 2026. Reminder receipts, row locks and idempotent writes prevent duplicate transitions and notifications.

Private calendar data remains owner-scoped, including assistant context. Internal Pomodoro receipts remain for recovery and exactly-once completion; no session history, task association or performance statistics are exposed in the timer.

The assistant produces typed, reviewable plans. Deterministic validation checks permissions, entity types, dependencies and strict argument schemas. Related actions use explicit bindings and transaction/idempotency boundaries. No arbitrary database or code-execution tool is exposed.

The retired Notes, Canvas, Periods and management features are removed from application code and contracted out of the database. Historical audit events remain. Before contraction, deployment stops application writers, takes a restricted backup and restores it into a disposable database. After crossing the contract boundary, deployment must not start old images against the changed schema; recovery requires fixing the candidate or restoring the verified database first.

## Consequences

Progress measures completion of agreed deliverables rather than claiming to measure productivity. The denominator and snapshots are inspectable. Late additions stay visible. Data from retired workspaces can be recovered from the restricted backup rather than through unused product screens.

Telegram cannot enumerate every silent group member through the Bot API. Mentions use verified linked accounts and observed current group membership; the bot reports incomplete coverage rather than claiming to notify unknown members. Notifications are explicit mentions because one visible word cannot contain multiple Telegram mention entities.

Evidence: [release verification](../qa/2026-10-28-deliverables/README.md).
