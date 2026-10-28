set role devon_migrator;
create table if not exists app.work_action_receipts (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments(id),
  user_id uuid not null references app.users(id),
  operation_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(department_id,user_id,operation_id)
);
alter table app.work_action_receipts enable row level security;
alter table app.work_action_receipts force row level security;
drop policy if exists work_action_receipts_scope on app.work_action_receipts;
create policy work_action_receipts_scope on app.work_action_receipts for all
  using (department_id=app.current_department_id() and user_id=app.current_user_id() and not app.is_view_as())
  with check (department_id=app.current_department_id() and user_id=app.current_user_id() and not app.is_view_as());
reset role;
