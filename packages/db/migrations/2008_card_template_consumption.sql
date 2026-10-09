-- The existing shared card-template path needs the same bounded consumption operation as projects.
-- It cannot grant members general template-edit privileges. Project helper2007 stays unchanged.
reset role;
create or replace function app.consume_card_template(p_template_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  consumed_payload jsonb;
begin
  if app.is_view_as()
    or app.current_user_id() is null
    or app.current_department_id() is null
    or coalesce(app.current_actor_role(), '') not in ('member', 'head', 'super_admin') then
    return null;
  end if;
  perform 1
  from app.departments d
  join app.memberships m on m.department_id = d.id
  join app.users u on u.id = m.user_id
  where d.id = app.current_department_id() and d.status = 'active' and d.deleted_at is null
    and d.features -> 'templates' = 'true'::jsonb
    and m.user_id = app.current_user_id() and m.status = 'active' and m.deleted_at is null
    and u.status = 'active' and u.deleted_at is null
    and u.role::text = app.current_actor_role()
  for share of d, m, u;
  if not found then return null; end if;
  update app.work_templates t set use_count = t.use_count + 1
  where t.id = p_template_id and t.department_id = app.current_department_id()
    and t.kind = 'card' and t.deleted_at is null
    and (t.scope = 'department' or t.owner_user_id = app.current_user_id())
  returning t.payload into consumed_payload;
  return consumed_payload;
end
$$;
revoke all on function app.consume_card_template(uuid) from public;
grant execute on function app.consume_card_template(uuid) to devon_app;
