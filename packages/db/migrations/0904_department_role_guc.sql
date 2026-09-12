-- v1.1 SPEC §2.1/§2.3. Expand-only (I-15): adds one GUC accessor and re-creates exactly one policy.
--
-- The bug this closes (documented live by `apps/api/test/integration/cross-department-access.test.ts`,
-- "a fresh department's own head can read (and lazily initialise) its AI settings on first visit"):
-- `0800_ai.sql`'s `ai_department_settings_write` requires
-- `app.current_actor_role() in ('head','super_admin')`, but `app.actor_role` carries the
-- **instance-wide** role (`app.users.role`), which for every real department head is `'member'`
-- (I-8b: `head` is a per-department `app.memberships.role`, a different column entirely). So the check
-- could never be true for any head. `GET /ai/settings` lazily INSERTs a default row on a department
-- that has none; that INSERT was rejected by RLS, so the first visit to the board/projects/AI screens
-- of any freshly approved department 500'd -- and kept 500ing, because the row never got created.
--
-- The fix is to give RLS the per-department role it was always missing, rather than to widen the
-- policy or to lie about `actor_role`. `app.current_department_role()` reads a new GUC set by
-- `packages/db/src/context.ts`'s `withContext()` from `RequestContext.departmentRole`, which
-- `apps/api/src/lib/actor.ts`'s `contextDepartmentRole()` computes from `Actor.memberships` -- the
-- same source `can()` itself uses, so the database boundary and the application boundary now agree by
-- construction instead of by coincidence.
--
-- No sub-select appears in any policy below (`packages/db/test/migration-lint.ts` rejects one), and
-- the GUC is request-scoped (`set_config(..., true)` = transaction-local), so it cannot leak across a
-- pooled connection's next borrower.
set role devon_migrator;

create or replace function app.current_department_role() returns text language sql stable as
  $$ select nullif(current_setting('app.department_role', true), '') $$;

grant execute on function app.current_department_role() to public;

-- Re-created, not edited in place (0800_ai.sql is applied and immutable, I-15).
drop policy if exists ai_department_settings_write on app.ai_department_settings;
create policy ai_department_settings_write on app.ai_department_settings for all
  using (
    department_id = app.current_department_id()
    and (
      app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
    )
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and (
      app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
    )
    and not app.is_view_as()
  );

-- v1.1 SPEC §4.2 / PERMISSIONS-AUDIT §4.7: the ONE thing a head may learn from a colleague's personal
-- workspace is an aggregate minute count -- "4 soat fokuslandi bu hafta" -- and never a note, a task
-- title, a canvas or a Pomodoro label (I-1). The `personal_*` tables are owner-only with FORCE row
-- level security and deliberately carry no head branch, which is exactly right and stays.
--
-- So the aggregate is exposed the only way that keeps I-1 intact: a `security definer` function whose
-- *return type* physically cannot carry content (a user id and an integer), which checks for itself
-- that the caller is the head of the department it is being asked about, using the same two GUCs RLS
-- uses. It joins through `app.memberships` so it can only ever report on people in that department.
create or replace function app.focus_minutes_by_user(p_department_id uuid, p_since timestamptz)
returns table (user_id uuid, minutes integer)
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  if app.current_department_id() is distinct from p_department_id
     or app.current_department_role() is distinct from 'head'
     or app.is_view_as() then
    raise exception 'focus_minutes_by_user: caller is not the head of this department'
      using errcode = '42501';
  end if;

  return query
    select s.user_id,
           (sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))) / 60)::int
    from app.pomodoro_sessions s
    join app.memberships m
      on m.user_id = s.user_id
     and m.department_id = p_department_id
     and m.status = 'active'
     and m.deleted_at is null
    where s.kind = 'focus'
      and s.completed
      and s.started_at >= p_since
    group by s.user_id;
end
$$;

revoke all on function app.focus_minutes_by_user(uuid, timestamptz) from public;
grant execute on function app.focus_minutes_by_user(uuid, timestamptz) to devon_app;

reset role;
