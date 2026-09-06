-- Row level security for the work/projects tables (EPIC-004/005), same shape as `0005_rls.sql`:
-- every policy compares a column on the row being checked against the `app.current_*` GUC functions
-- -- never a sub-select against another table. Expand-only (I-15); idempotent via `drop policy if
-- exists` then `create policy`, and `enable`/`force row level security` are naturally idempotent.
set role devon_migrator;

alter table app.cards enable row level security;
alter table app.cards force row level security;
drop policy if exists cards_read on app.cards;
create policy cards_read on app.cards for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists cards_write on app.cards;
create policy cards_write on app.cards for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.card_checklist_items enable row level security;
alter table app.card_checklist_items force row level security;
drop policy if exists card_checklist_items_read on app.card_checklist_items;
create policy card_checklist_items_read on app.card_checklist_items for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists card_checklist_items_write on app.card_checklist_items;
create policy card_checklist_items_write on app.card_checklist_items for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.card_comments enable row level security;
alter table app.card_comments force row level security;
drop policy if exists card_comments_read on app.card_comments;
create policy card_comments_read on app.card_comments for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists card_comments_write on app.card_comments;
create policy card_comments_write on app.card_comments for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.card_activity enable row level security;
alter table app.card_activity force row level security;
drop policy if exists card_activity_read on app.card_activity;
create policy card_activity_read on app.card_activity for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
-- Activity rows are append-only from the API's point of view (no PATCH/DELETE route exists), but the
-- write policy still needs `for all` so `insert` is permitted at all under `force row level security`.
drop policy if exists card_activity_write on app.card_activity;
create policy card_activity_write on app.card_activity for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.attachments enable row level security;
alter table app.attachments force row level security;
drop policy if exists attachments_read on app.attachments;
create policy attachments_read on app.attachments for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists attachments_write on app.attachments;
create policy attachments_write on app.attachments for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.labels enable row level security;
alter table app.labels force row level security;
drop policy if exists labels_read on app.labels;
create policy labels_read on app.labels for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists labels_write on app.labels;
create policy labels_write on app.labels for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

-- A saved view is visible department-wide once its owner shares it; otherwise only its owner sees it
-- -- still a plain column comparison on the row itself, no sub-select.
alter table app.saved_views enable row level security;
alter table app.saved_views force row level security;
drop policy if exists saved_views_read on app.saved_views;
create policy saved_views_read on app.saved_views for select
  using (
    department_id = app.current_department_id()
    and (shared = true or owner_user_id = app.current_user_id())
  );
drop policy if exists saved_views_write on app.saved_views;
create policy saved_views_write on app.saved_views for all
  using (
    department_id = app.current_department_id()
    and owner_user_id = app.current_user_id()
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and owner_user_id = app.current_user_id()
    and not app.is_view_as()
  );

alter table app.projects enable row level security;
alter table app.projects force row level security;
drop policy if exists projects_read on app.projects;
create policy projects_read on app.projects for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists projects_write on app.projects;
create policy projects_write on app.projects for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

reset role;
