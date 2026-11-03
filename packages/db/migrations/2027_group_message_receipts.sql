set role devon_migrator;
create table app.telegram_message_receipts (
  department_id uuid not null references app.departments(id),
  operation_id uuid not null,
  group_id uuid not null references app.telegram_groups(id),
  message_hash text not null,
  status text not null default 'sending' check(status in ('sending','sent','failed')),
  recipients integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(department_id,operation_id)
);
alter table app.telegram_message_receipts enable row level security;
alter table app.telegram_message_receipts force row level security;
create policy telegram_message_receipts_head on app.telegram_message_receipts for all
  using(department_id=app.current_department_id() and app.current_department_role()='head' and not app.is_view_as())
  with check(department_id=app.current_department_id() and app.current_department_role()='head' and not app.is_view_as());
reset role;
