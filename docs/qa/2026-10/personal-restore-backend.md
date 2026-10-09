# Personal deletion receipts and Undo backend — 2026-10-08

This is local backend evidence. Root owns the personal client deletion, navigation and Undo journeys. No production changes, deployments, commits/pushes, external integrations or video work were performed by this agent.

## Requirement and inspected facts

Root reproduced a client defect: delayed deletion timers are cancelled on unmount, so the UI says Deleted but navigation can leave the original item persisted. The repair requires persisted deletion before success and a real server restore, not cancellation of an uncommitted timer.

Inspected `personal/repo.ts`, `index.ts`, module DTO/schemas, shared permission order, migration0500, session revocation and `withContext` audit flush. Tasks/notes/canvases already soft-delete with `deleted_at` and increment version. Task deletion visits active owner descendants only. These timestamps are PostgreSQL transaction timestamps, not a reliable unique operation identity. Existing personal RLS is forced and strictly owner-only, with no head/admin/view-as exception. Personal permission checks precede the department view-as refusal; an admin may still write their own personal data while looking at a department, but cannot access someone else's personal rows.

## Implemented contract and persistence

- Additive migration `2006_personal_delete_receipts.sql` adds nullable `deleted_operation_id` UUID to the three tables and an owner/operation partial task index. Existing deleted records receive no receipt and stay deleted. Existing RLS/grants are unchanged.
- Legacy `DELETE /api/v1/personal/{tasks|notes|canvases}/:id` keeps204/no body. Explicit `?receipt=true` returns200 `{restoreToken: UUID}` after the actual audited deletion commits. Shared contracts export `personalDeleteReceiptSchema`, `personalRestoreBodySchema`, `PersonalDeleteReceipt` and `PersonalRestoreBody`.
- `POST /api/v1/personal/{kind}/:id/restore` requires `{restoreToken}` plus existing session/CSRF/owner permission, and returns the existing item DTO200. The token must match the row's current deletion operation. Wrong/foreign/stale token returns404 without writes/audit. Task restore under a still-deleted or invisible parent returns409 without partial restoration.
- Task deletion/restore take one owner namespace advisory transaction lock, then lock the current root, so parent/child Undo and deletion cannot invert row-lock order. Restoration visits only owner descendants deleted in the same UUID operation. Historically deleted descendants and foreign-owner children are excluded even if timestamps equal. Recursive queries use `UNION` to avoid looping forever through a corrupted cycle; restoring a root attached to a deleted cycle refuses with409.
- Note/canvas restore is one conditional UPDATE; PostgreSQL row locking and condition recheck permit only one transition for a current token. Restores clear the deletion operation, increment version and preserve title/body/scene/stickies/creation time. Audit uses identifiers only on restore, in the same `withContext` transaction. No private content or receipt is added to shared realtime/outbox events.
- No token expiry was introduced: the parent approved an owner's operation receipt as a capability without a specified retention expiry. Old receipt compatibility is not inferred for pre-migration deletions.

## Enter-to-create sibling extension

Root additionally reproduced that TaskRow Enter submits an empty title, rejected by the existing minimum-length rule, and never supplies a parent for the promised sibling. Root owns the localized initial title, focus/selection and actual keyboard browser journey. The backend now accepts optional `afterTaskId` UUID on task creation. It locks an active actor-owned anchor and derives its parent/period; the request cannot combine that anchor with explicit `parentId`, `sprintId` or `sort`. Invisible/deleted anchors, or an anchor referring to an invisible/deleted parent or period, refuse422 without normalization or creation.

The anchor's sibling group is normalized in stable `(sort,created_at,id)` order and exactly one slot is created immediately after it. This handles old integer positions and creation timestamps that tie. Other parent/period groups are untouched. Changed positions and the new task's creation audit commit in the same transaction. Ordinary list reads gain the same ID tie-breaker. All task-mutating create/patch/reorder/rollover/delete/restore paths acquire the owner task advisory lock **before any row access/lock**, so new insert shifting cannot race a group move, ancestor deletion or rollover. Rollover previously did not take a sprint row lock first; this extension does not add an inverted lock order.

## Executed verification

```powershell
pnpm --filter @devon/api exec vitest run --config test/vitest.config.ts test/integration/personal-restore.test.ts
pnpm --filter @devon/db exec vitest run --config test/vitest.config.ts test/unit/migration-lint.test.ts test/unit/tenancy.test.ts
pnpm --filter @devon/api typecheck
pnpm --filter @devon/contracts typecheck
pnpm --filter @devon/api exec eslint --config ../../packages/config/eslint/base.js src/modules/personal/repo.ts src/modules/personal/index.ts test/integration/personal-restore.test.ts
```

- Final real migrated PostgreSQL/Fastify batch **16/16 passed**: nine deletion/restore cases and seven anchor/sibling cases. Fixtures use a fresh owned Testcontainers database. Superuser SQL is used only for fixture setup, exact persisted-state/audit inspection, lock ordering and the deliberate audit fault.
- Same-operation three-level task subtree roundtrip; historical child deliberately assigned the exact root deletion timestamp stays deleted; a foreign-owner child linked through fixture SQL is untouched. Restoring the historical child while the parent remains deleted returns409 with no effects.
- Note/canvas data and versions roundtrip. A later deletion generates a new UUID, and the earlier token cannot undo it; state and audit are independently unchanged after404.
- Legacy204, invalid UUID/query422 and missing CSRF403 verified for all three kinds, with independently persisted snapshots/audit unchanged on refusals.
- Member/head/admin foreign restore attempts404; own admin data is still accessible during an actual signed view-as lens. Direct repository calls spoofing the owner argument are refused by actual `devon_app` RLS, with no audit/state change.
- Both task operation orderings are synchronized using actual PostgreSQL blocker relationships: restore then new delete leaves the second operation deleted; new delete then queued old Undo leaves it deleted and refuses the stale token. Note/canvas two writers are proven waiting in the blocker graph before releasing the fixture lock; exactly one200/one404, version increment once and one restore audit.
- A deliberately failing `BEFORE INSERT` audit trigger yields500 and rolls back the whole task subtree restoration; after removing the temporary trigger, the same receipt restores successfully. The expected error appears in the test log and is not a production error. A revoked owner's session returns401 and leaves its deleted note/audit unchanged.
- Anchor tests verify nested insertion with tied sorts/timestamps, exact group order and unchanged unrelated versions; independent API list order agrees. Foreign/deleted/broken anchors, invalid UUID and conflicting placement inputs refuse422 without any task/audit effects. Both same-anchor concurrent requests are proven in PostgreSQL's blocker graph before release; both create and produce unique positions. Both ancestor-deletion/insertion orders and both rollover/insertion orders use the same real blocker proof: deletion-first refuses insertion, insertion-first is included in the ancestor tombstone, and a rollover leaves the new sibling under the same parent in the committed new period.
- Migration/tenancy unit batch **15/15 passed**. API/contracts type checks, targeted personal API lint and explicit repository Prettier checks passed. No policies or tests were weakened.

The first test fixture sent `Content-Type: application/json` with no DELETE/POST body, which Fastify correctly rejects400. The fixture now removes that header for bodyless requests and sends `{}` for the existing view-as POST; this was a request fixture correction, not a server-parser workaround. The first backend typecheck exposed missing204 response schemas alongside the new200 receipt; both statuses are now explicitly declared and verified.

## Pending and excluded

Root reports its separate persisted-before-success/navigation browser batch passed24 cases across three engines; detailed controls/capture evidence remains in root's ledger, not attributed to this backend suite. The actual Enter focus/selection and final descendant-cache reconciliation browser journeys are root-owned pending at this save. This backend ledger does not substitute API success for human flows. No live external service verification, production migration, deploy or recording is claimed.

## Task placement, hierarchy and period follow-up

Root authorized this bounded follow-up after source inspection found global parent/period foreign keys without owner or active-row validation. Before editing source, a real Fastify/PostgreSQL batch reproduced **five of five failing regressions**: foreign/deleted parent/period references created rows201; patches persisted unsafe references200 plus audits; a mixed-owner reorder returned200 and updated only the accessible subset; a simultaneous two-node parent cycle returned200 and disappeared from the actual pure frontend tree; a root period change left its active descendants in the old period. The initial renderer check imported the web helper into the API test; final tests are split by package to preserve API `rootDir` and type safety.

Implemented `personal/task-placement.ts` plans the entire prospective owner-scoped undeleted graph under the existing owner advisory transaction lock. It refuses unknown/deleted/foreign or duplicate batch targets before writes; structural edits refuse invisible/deleted parents, self/ancestor/simultaneous cycles and invisible/deleted periods with the same safe422. Validating a stale patch preserves the existing409 version conflict before reference checks. No foreign row contents are read. Title/notes/done/sort-only edits of legacy malformed rows remain possible; there is no automatic production data repair.

Creation inherits a non-null parent's period when omitted and refuses an explicit mismatch, including null. Reparenting derives the final parent's period; mixed batches resolve simultaneous parent moves before applying descendant periods. A sprint-only move of a nested branch detaches it to top level in the destination. Every active descendant, including completed children, follows a moved branch; historically deleted or foreign rows stay untouched. One batched placement UPDATE plus existing root audit commits atomically; descendant changes are recorded with a bounded count/reason. Endpoint DTO shapes remain unchanged. Client optimistic state must reconcile the authoritative full list; root owns this hook work.

Unfinished-only rollover preserves its documented policy. It moves unfinished rows and detaches active edges only where the parent and child split periods, in both completed-parent/unfinished-child and unfinished-parent/completed-child directions. Deleted descendants retain their historical data. The reported moved count excludes completed rows whose boundary edge is detached. Undo of a same-operation deleted branch under a parent that since moved periods inherits that active parent's current period; unavailable parent/period refuses409 without changes.

The pure frontend tree presents every cycle member as a safe top-level row once, retains valid descendants/orphans and stable sort ties, and never writes recovered references. Tree building and flattening are iterative so deep valid trees do not overflow the recursion stack.

Executed final follow-up gates:

```powershell
pnpm --filter @devon/api exec vitest run --config test/vitest.config.ts test/integration/personal-hierarchy.test.ts test/integration/personal-restore.test.ts
pnpm --filter @devon/api exec vitest run --config test/vitest.config.ts test/unit/notifications.personal-digest.test.ts
pnpm --filter @devon/web exec vitest run --config test/vitest.config.ts test/unit/personal-task-tree.test.ts
pnpm --filter @devon/api typecheck
```

- **32/32 real PostgreSQL/Fastify tests passed**:16 hierarchy cases plus the retained16 restore/anchor cases. These include atomic negative batches; parent-period inheritance; explicit contradictory mixed batches; completed-active vs historically deleted descendants; both rollover split directions; restore after parent-period movement; explicit legacy cycle recovery; and **both actual PostgreSQL blocking-graph orderings** of parent deletion versus child creation. Delete-first refuses422; create-first persists201 and is included in the later ancestor tombstone. Temporary audit-failure triggers produce the expected500 and prove complete rollback of both a branch patch and mixed reorder, with independently unchanged task/audit snapshots.
- **3/3 web tree tests passed**, covering valid ordering/depth/stable ties, every cycle/orphan row once without data mutation, and a12,000-row deep hierarchy without stack overflow.
- **4/4 adjacent personal digest tests passed** with mocked notification boundaries and no external calls.
- API typecheck and targeted personal API/web ESLint passed. Explicit repository Prettier checks and `git diff --check` passed. The prior migration/tenancy15-test gate remains the migration evidence; the hierarchy follow-up adds no migration.

The first fixed-code follow-up run caught a Drizzle array interpolation mistake in the new sprint-reference query, producing local500 and **7 failures/14 passes**, rather than the required422/valid creation. It was corrected to explicitly bound scalar UUID parameters in an `IN` clause; the final32-test batch above passes. This was an implementation error found by isolated regression checks, not a production execution. Two older anchor fixtures were updated to represent an unrelated root group and deliberately fixture-seeded historical foreign-parent corruption now that ordinary creation correctly refuses those relationships; assertions and privacy boundaries were retained.

## Rollover lifecycle review follow-up

Parent's independent review identified an unlocked source-period read and missing lifecycle guard. Before repair, an isolated three-case batch reproduced **two failures/one pass**: rerolling a completed source or rolling an archived source returned200, created an extra empty active period/audit and incremented the source; a patch-first race committed the latest goal to the source but created the next period using its stale null goal. The opposite rollover-first race already refused a stale patch409 and is retained.

`patchSprint` now acquires the same owner task advisory lock before row access, and `rolloverSprint` locks its source row `FOR UPDATE` after that owner lock. Only an active source can roll over; completed/archived sources return409 through the existing safe problem contract before new rows/audits. Both source-edit/rollover races are synchronized with actual PostgreSQL row-blocker relationships, so results prove committed-state ordering rather than relying on timing guesses. Final complete personal API batch **35/35 passed** (19 hierarchy/lifecycle +16 restore/anchor). API typecheck and targeted lifecycle lint/format passed after these last source edits. No additional migrations, production calls or UI coverage claims were added.

## Atomic acknowledgement for queued task writes

Independent review of root's queued task mutation client found that inferring ownership of descendant revisions from a later GET cannot prove which client changed them. A second session can detach a child into the same destination before the branch move; the original move then does not touch that child. A later read of its destination and exactly one higher version must not authorize overwriting that remote edit.

The API now supports optional `versions=true` on PATCH `/personal/tasks/:id` and POST `/personal/tasks/reorder`. PATCH returns `{task, affectedVersions}` instead of the existing task DTO; reorder returns `{updated, affectedVersions}`. Without that flag both legacy response shapes remain identical. Each acknowledgement contains `{id,beforeVersion,afterVersion}` for an actual `UPDATE RETURNING` row in the same owner-scoped transaction, including implicit active descendants and every explicit reorder target. The prior version is exactly the returned version minus one; there is no post-commit read, foreign-row metadata or inferred acknowledgement. Audit failure still aborts all rows and no successful receipt is returned.

Final realDB batch **38/38 passed** (22 hierarchy/lifecycle/receipt +16 restore/anchor). Three added cases prove exact implicit/completed child versions, exclusion of historically deleted and foreign rows, explicit reorder acknowledgements with unchanged legacy `{updated}` response, and an actual second authenticated owner session that detaches a child before moving the root. The root receipt excludes that remote child; a stale subsequent child patch remains409. API typecheck passed. Root owns the client use of this metadata and its separate browser queue journeys.
