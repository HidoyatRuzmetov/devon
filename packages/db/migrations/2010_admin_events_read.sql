-- Instance analytics count events across departments just like cards and AI traces. The existing
-- department-scoped policy remains the only write policy; this grants no administrative mutation.
set role devon_migrator;

drop policy if exists events_admin_read on app.events;
create policy events_admin_read on app.events for select
  using (app.current_actor_role() = 'super_admin');

reset role;
