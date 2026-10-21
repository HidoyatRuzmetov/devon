set role devon_migrator;
create table if not exists app.file_upload_approvals (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments(id),
  user_id uuid not null references app.users(id),
  subject_type text not null check (subject_type in ('card','page')),
  subject_id uuid not null,
  name text not null,
  size integer not null check (size > 104857600),
  status text not null default 'pending' check (status in ('pending','approved','rejected','consumed')),
  reviewed_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists file_upload_approvals_pending on app.file_upload_approvals(status, created_at);
alter table app.file_upload_approvals enable row level security;
alter table app.file_upload_approvals force row level security;
drop policy if exists file_upload_approvals_read on app.file_upload_approvals;
create policy file_upload_approvals_read on app.file_upload_approvals for select using
  (app.current_actor_role() = 'super_admin' or (department_id = app.current_department_id() and user_id = app.current_user_id()));
drop policy if exists file_upload_approvals_write on app.file_upload_approvals;
create policy file_upload_approvals_write on app.file_upload_approvals for all using
  (not app.is_view_as() and (app.current_actor_role() = 'super_admin' or (department_id = app.current_department_id() and user_id = app.current_user_id())))
  with check (not app.is_view_as() and (app.current_actor_role() = 'super_admin' or (department_id = app.current_department_id() and user_id = app.current_user_id())));
grant select, insert, update on app.file_upload_approvals to devon_app;
-- RLS scopes ownership; this guard also prevents an uploader from approving their own request.
create or replace function app.guard_file_upload_approval() returns trigger language plpgsql as $$
begin
  if app.current_actor_role() = 'super_admin' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'Only superadmins can review uploads' using errcode = '42501';
    end if;
  elsif not (old.status = 'approved' and new.status = 'consumed')
    or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Only superadmins can review uploads' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_file_upload_approval on app.file_upload_approvals;
create trigger guard_file_upload_approval before insert or update on app.file_upload_approvals
  for each row execute function app.guard_file_upload_approval();
reset role;
