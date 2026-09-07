-- Blitz finding (agentic/ledger/blitz): the super admin console's cross-department views
-- (`GET /api/v1/admin/departments`'s `memberCount`/`headName`, `apps/api/src/modules/admin/repo.ts`)
-- showed 0 members and no head for every department, including the demo department that visibly has
-- ~60 active members and a head. Root cause: `0303_memberships_self_read_rls.sql` added a "read my own
-- membership row" clause to `memberships_read` but never added the super-admin bypass that
-- `departments_read` already has (`0005_rls.sql`: "... or app.current_actor_role() = 'super_admin'").
-- `modules/admin/repo.ts`'s own header comment says its queries use the same
-- `actorRole: 'super_admin'` RLS-evaluation context `modules/departments/repo.ts` uses for its
-- cross-department reads -- that context can only work if the policy actually grants that role
-- visibility, which `memberships_read` never did. Any admin query that joins or subqueries
-- `app.memberships` for a department the caller does not itself belong to (member counts, head
-- lookups, roster-shaped exports) was silently returning zero rows instead of erroring, which is why
-- this went unnoticed by anything short of clicking through the console.
--
-- Expand-only (I-15): `drop policy` + `create policy`, not a table/column drop -- same convention
-- `0303_memberships_self_read_rls.sql` and `0005_rls.sql` already use. Adding the super-admin clause
-- does not weaken tenancy isolation (I-1/ADR-002): every other role still sees only its own
-- department's rows or its own row, exactly as before.
set role devon_migrator;

drop policy if exists memberships_read on app.memberships;
create policy memberships_read on app.memberships for select
  using (
    department_id = app.current_department_id()
    or user_id = app.current_user_id()
    or app.current_actor_role() = 'super_admin'
  );

reset role;
