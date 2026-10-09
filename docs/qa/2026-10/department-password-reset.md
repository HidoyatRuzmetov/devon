# Head password reset: current eligibility and atomic effects

This is a bounded local PostgreSQL/API regression slice using disposable Testcontainers data.
It does not reset a production password, call external integrations, or publish changes.

An actual reset was paused at the real password-hashing boundary. Removing its target through
the actual department repository committed successfully. After hashing resumed, the old reset
still reported success and replaced that former member's password. The before failure is
preserved in `artifacts/qa/2026-10/departments/password-race-before.json` (one selected failing
case; the other cases were excluded by the test-name filter).

The final credential-writing transaction now locks the real actor and target users, rechecks
active/nondeleted account eligibility, then locks and rechecks their department memberships.
The actor must still be the active head, and the target must still be an active ordinary member.
Password replacement, the temporary-password flag, session revocation, audit and outbox events
commit together. Hashing remains outside that transaction.

`apps/api/test/integration/department-password-reset.test.ts` initially passed eight real-DB
cases in `artifacts/qa/2026-10/departments/password-race-final.json`:

- Member removal, target locking/deletion, actor locking/demotion and target promotion during
  hashing refuse the reset without changing credentials, live sessions, audit or outbox rows.
- An eligible reset revokes the old session and accepts its actual temporary password.
- A real failing outbox INSERT trigger rolls credentials, sessions and audit back; removing the
  disposable trigger permits one complete successful reset.

Additional actual transfer/reset, transfer/leave and competing-transfer regressions confirmed
three problems. A reset and transfer acquired their two membership locks in opposite orders,
producing PostgreSQL `40P01` (deadlock). A transfer also succeeded after its selected target
actually left, and two competing transfers from the same head both succeeded. The before
reports are `transfer-concurrency-before.json` and `transfer-deadlock-before.json` in the same
department artifact directory. The deadlock was introduced by this slice's first eligibility
repair; it is not misclassified as an original platform defect.

Headship transfer now locks the two active/nondeleted accounts in sorted user order, then the
two memberships in that same order. It rechecks the source as the actual current active head
and the target as an active ordinary member before changing either role. Password reset uses
the same account-before-membership order. Concurrent transfers have one winner; transfer
after target departure is refused; the reset/transfer overlap resolves without deadlock and
the superseded reset leaves credentials untouched. Versions, audit and outbox remain atomic.

The final complete real-DB report is `password-transfer-final.json`: **11/11**, zero skipped
cases. The affected actual UI journeys (temporary reset with initial transport failure,
pending confirmation Close with held receipt, and head transfer followed by Leave) also passed
**9/9** across Chromium, Firefox and WebKit with zero retries/skips. That separate browser report
is `password-transfer-ui-nine/results.json`; it does not replace the earlier 48-case department
matrix. API and web typechecks passed after the final source changes.
