-- Explicit November 2026 follow-up: show the account DOB to active department colleagues in People.
-- Keep account writes and the private birthday stores under their existing RLS. This read-only
-- projection exposes only the canonical date for the caller's actual current department roster.
reset role;
create or replace function app.directory_birth_dates()
returns table(owner_user_id uuid, date_of_birth date)
language sql stable security definer
set search_path = pg_catalog
as $$
  select b.owner_user_id, b.birth_date
  from app.account_birthdays b
  join app.memberships subject_member on subject_member.user_id=b.owner_user_id
    and subject_member.department_id=app.current_department_id()
    and subject_member.status='active' and subject_member.deleted_at is null
  join app.users subject_user on subject_user.id=b.owner_user_id
    and subject_user.status='active' and subject_user.deleted_at is null
  where not app.is_view_as() and app.current_user_id() is not null
    and app.current_department_id() is not null
    and exists (
      select 1 from app.memberships viewer
      join app.users viewer_user on viewer_user.id=viewer.user_id
      join app.departments department on department.id=viewer.department_id
      where viewer.department_id=app.current_department_id()
        and viewer.user_id=app.current_user_id()
        and viewer.status='active' and viewer.deleted_at is null
        and viewer_user.status='active' and viewer_user.deleted_at is null
        and viewer_user.role::text=app.current_actor_role()
        and department.status='active' and department.deleted_at is null
    );
$$;
revoke all on function app.directory_birth_dates() from public;
grant execute on function app.directory_birth_dates() to devon_app;
