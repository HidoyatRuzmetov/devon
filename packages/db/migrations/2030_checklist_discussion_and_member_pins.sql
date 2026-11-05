-- A checklist discussion belongs to the same source item in every workspace.
set role devon_migrator;

alter table app.card_checklist_items add constraint checklist_item_card_identity
  unique (department_id, card_id, id);
alter table app.card_comments add column checklist_item_id uuid;
alter table app.card_comments add constraint comment_checklist_identity
  foreign key (department_id, card_id, checklist_item_id)
  references app.card_checklist_items (department_id, card_id, id);
create index card_comments_checklist_idx
  on app.card_comments (checklist_item_id, created_at, id)
  where deleted_at is null and checklist_item_id is not null;

-- Personal pins on other people's cards remain private. Assigned-task pins are part of
-- the person's shared work queue. Only that person or their actual head may change them.
drop policy focus_pins_read on app.focus_pins;
create policy focus_pins_read on app.focus_pins for select using (
  department_id = app.current_department_id() and (
    user_id = app.current_user_id() or app.current_department_role() = 'head'
    or exists(select 1 from app.cards c where c.id=card_id
      and c.department_id=app.current_department_id() and c.assignee_user_id=user_id)
  )
);
drop policy focus_pins_write on app.focus_pins;
create policy focus_pins_write on app.focus_pins for all using (
  department_id=app.current_department_id() and not app.is_view_as()
  and (user_id=app.current_user_id() or app.current_department_role()='head')
) with check (
  department_id=app.current_department_id() and not app.is_view_as()
  and (user_id=app.current_user_id() or app.current_department_role()='head')
);

reset role;
