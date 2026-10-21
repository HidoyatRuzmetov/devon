-- Private head conversations. Their content never enters department-wide AI traces or search.
set role devon_migrator;

create table if not exists app.ai_conversations (
  id uuid primary key,
  department_id uuid not null references app.departments(id),
  owner_user_id uuid not null references app.users(id),
  title text not null default '' check (length(title) <= 120),
  locale text not null check (locale in ('uz-Latn','uz-Cyrl','ru','en')),
  messages jsonb not null default '[]' check (jsonb_typeof(messages) = 'array'),
  active_message_id uuid,
  run_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((active_message_id is null) = (lease_until is null))
);
create index if not exists ai_conversations_owner_recent_idx
  on app.ai_conversations(department_id,owner_user_id,updated_at desc);
alter table app.ai_conversations enable row level security;
alter table app.ai_conversations force row level security;
drop policy if exists ai_conversations_owner on app.ai_conversations;
create policy ai_conversations_owner on app.ai_conversations for all
  using (department_id = app.current_department_id() and owner_user_id = app.current_user_id()
    and current_setting('app.department_role', true) = 'head' and not app.is_view_as())
  with check (department_id = app.current_department_id() and owner_user_id = app.current_user_id()
    and current_setting('app.department_role', true) = 'head' and not app.is_view_as());
grant select,insert,update,delete on app.ai_conversations to devon_app;
reset role;
