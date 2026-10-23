-- Channel choices apply to future notifications. Existing inbox history stays visible.
set role devon_migrator;
alter table app.notifications add column if not exists inapp_visible boolean not null default true;
reset role;

-- Telegram delivery and its retries still require an owned, live subject, independently
-- of whether this notification was requested in the app.
create or replace function app.notification_subject_is_visible(p_notification_id uuid)
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
revoke all on function app.notification_subject_is_visible(uuid) from public;
grant execute on function app.notification_subject_is_visible(uuid) to devon_app;

create or replace function app.notification_is_visible(p_notification_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce((
    select n.inapp_visible and app.notification_subject_is_visible(n.id)
    from app.notifications n where n.id = p_notification_id
  ), false)
$$;
revoke all on function app.notification_is_visible(uuid) from public;
grant execute on function app.notification_is_visible(uuid) to devon_app;
