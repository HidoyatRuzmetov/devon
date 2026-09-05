-- Expand-only (I-15). Idempotent: `create or replace` for functions, `drop policy if exists` then
-- `create policy`.
--
-- Every policy below compares a column to one of these GUC-reading functions -- never a sub-select
-- against another table. A sub-query in a policy can see stale rows under READ COMMITTED and
-- momentarily expose cross-tenant data (backend-architecture-and-multitenancy.md §2);
-- `test/migration-lint.ts` rejects a `select` inside a `create policy ... using (...)` clause that is
-- not marked `security definer` or `for share`.
set role devon_migrator;

create or replace function app.current_department_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.department_id', true), '')::uuid $$;

create or replace function app.current_user_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app.current_actor_role() returns text language sql stable as
  $$ select nullif(current_setting('app.actor_role', true), '') $$;

create or replace function app.is_view_as() returns boolean language sql stable as
  $$ select coalesce(nullif(current_setting('app.view_as', true), ''), 'false')::boolean $$;

grant execute on function app.current_department_id() to public;
grant execute on function app.current_user_id() to public;
grant execute on function app.current_actor_role() to public;
grant execute on function app.is_view_as() to public;

alter table app.memberships enable row level security;
alter table app.memberships force row level security;

drop policy if exists memberships_read on app.memberships;
create policy memberships_read on app.memberships for select
  using (department_id = app.current_department_id());

drop policy if exists memberships_write on app.memberships;
create policy memberships_write on app.memberships for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.departments enable row level security;
alter table app.departments force row level security;

drop policy if exists departments_read on app.departments;
create policy departments_read on app.departments for select
  using (id = app.current_department_id() or app.current_actor_role() = 'super_admin');

drop policy if exists departments_write on app.departments;
create policy departments_write on app.departments for all
  using (
    id = app.current_department_id()
    and app.current_actor_role() in ('head', 'super_admin')
    and not app.is_view_as()
  )
  with check (id = app.current_department_id() and not app.is_view_as());

reset role;
