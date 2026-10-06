-- Retain project and child task history. Only tasks removed with this project may be restored
-- by its short undo action; independently deleted tasks remain deleted.
set role devon_migrator;
alter table app.projects add column if not exists deleted_by_user_id uuid references app.users (id);
alter table app.cards add column if not exists deleted_by_project_id uuid references app.projects (id);
reset role;

-- As in 2003, inbox reads have no active department. Reveal only whether the caller's own
-- notification refers to live content, without exposing a project or card across tenant RLS.
create or replace function app.notification_is_visible(p_notification_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce((
    select n.user_id = app.current_user_id()
      and case when n.subject_type = 'card' then exists (
        select 1 from app.cards c
        where c.id = case
          when n.subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then n.subject_id::uuid else null end
          and c.deleted_at is null
      ) when n.subject_type = 'project' then exists (
        select 1 from app.projects p
        where p.id = case
          when n.subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then n.subject_id::uuid else null end
          and p.deleted_at is null
      ) else true end
    from app.notifications n where n.id = p_notification_id
  ), false)
$$;
revoke all on function app.notification_is_visible(uuid) from public;
grant execute on function app.notification_is_visible(uuid) to devon_app;
