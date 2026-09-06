-- Fixes a chicken-and-egg gap in `0005_rls.sql`'s `memberships_read` policy, found building
-- EPIC-004/005's dependency on real `req.actor.memberships` (this build's `listActiveMembershipsForUser`,
-- `apps/api/src/db/repo.ts`): that policy only ever allowed `department_id = current_department_id()`,
-- but *discovering* which department(s) a user belongs to (every login, every `GET /me`) has to run
-- with no department GUC set yet -- there is no way to query "my own memberships" through the RLS-
-- protected `devon_app` role without already knowing the department id you are asking about. Adding
-- "or it is my own row" does not weaken tenancy isolation (I-1/ADR-002): a user still can never see
-- another user's membership row unless they already share the active department context, and the new
-- clause only ever matches rows where `user_id` is the caller's own.
--
-- Expand-only (I-15): this is a `drop policy` + `create policy` pair, not a table/column drop --
-- `test/migration-lint.test.ts`'s destructive-statement list is exactly DROP TABLE / DROP COLUMN /
-- ALTER COLUMN ... TYPE / TRUNCATE / DELETE FROM, none of which appear here. Idempotent via the same
-- `drop policy if exists` then `create policy` convention `0005_rls.sql` already uses.
set role devon_migrator;

drop policy if exists memberships_read on app.memberships;
create policy memberships_read on app.memberships for select
  using (
    department_id = app.current_department_id()
    or user_id = app.current_user_id()
  );

reset role;
