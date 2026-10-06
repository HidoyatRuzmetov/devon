-- Inbox reads have no active department: a direct RLS-constrained join to cards would hide
-- legitimate notifications. This read-only helper crosses that boundary only to answer whether
-- the caller's OWN notification still refers to a live card. It exposes no card data, accepts
-- no user/department override, and returns false for every unknown or other user's notification.
-- Its owner is the migration runner (the bootstrap superuser), so FORCE RLS does not recursively
-- hide the row being inspected. No table privileges or write capability are granted to callers.
reset role;
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
      ) else true end
    from app.notifications n where n.id = p_notification_id
  ), false)
$$;
revoke all on function app.notification_is_visible(uuid) from public;
grant execute on function app.notification_is_visible(uuid) to devon_app;
