set role devon_migrator;
create table app.personnel_records (
  department_id uuid not null references app.departments(id),
  owner_user_id uuid not null references app.users(id),
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(department_id,owner_user_id)
);
alter table app.personnel_records enable row level security;
alter table app.personnel_records force row level security;
create policy personnel_records_read on app.personnel_records for select using (
  department_id=app.current_department_id() and not app.is_view_as()
  and (owner_user_id=app.current_user_id() or app.current_department_role()='head')
);
create policy personnel_records_insert on app.personnel_records for insert with check (
  department_id=app.current_department_id() and not app.is_view_as() and owner_user_id=app.current_user_id()
);
create policy personnel_records_update on app.personnel_records for update using (
  department_id=app.current_department_id() and not app.is_view_as() and owner_user_id=app.current_user_id()
) with check (department_id=app.current_department_id() and not app.is_view_as() and owner_user_id=app.current_user_id());
reset role;
