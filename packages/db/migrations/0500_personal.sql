-- Personal workspace (TECH-SPEC §3.3, MODULE-GUIDE.md "0500 personal"). Expand-only (I-15), idempotent
-- per the same conventions as every prior migration: `create table if not exists`, `do $$ ... exception
-- when duplicate_object then null; end $$;` for enum types, `drop policy if exists` then `create
-- policy`.
--
-- I-1: every table here is owner-only. No `department_id` column anywhere in this file, and every RLS
-- policy compares `user_id` to `app.current_user_id()` with no exception for `head` or `super_admin`
-- and no `is_view_as()` carve-out (unlike `app.departments`/`app.memberships` in 0005_rls.sql) -- the
-- head/admin exception those policies grant is exactly the thing this schema must never have.
set role devon_migrator;

do $$ begin
  create type app.personal_sprint_kind as enum ('3h', 'day', 'week', 'custom');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.personal_sprint_status as enum ('active', 'completed', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.pomodoro_session_kind as enum ('focus', 'short_break', 'long_break');
exception when duplicate_object then null;
end $$;

create table if not exists app.personal_sprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  kind app.personal_sprint_kind not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  goal text,
  status app.personal_sprint_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists personal_sprints_user_status_idx
  on app.personal_sprints (user_id, status) where deleted_at is null;
create index if not exists personal_sprints_user_starts_idx
  on app.personal_sprints (user_id, starts_at) where deleted_at is null;

create table if not exists app.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  sprint_id uuid references app.personal_sprints (id),
  parent_id uuid references app.personal_tasks (id),
  title text not null,
  done_at timestamptz,
  notes text,
  sort integer not null default 0,
  estimate_min integer,
  -- Opaque reference to a department card (`app.cards.id`, a different module) -- id only, never a
  -- foreign key: the linked card can live in a table that does not exist yet, or be deleted later,
  -- without ever invalidating this row (TECH-SPEC §3.3).
  linked_card_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists personal_tasks_user_sprint_idx
  on app.personal_tasks (user_id, sprint_id) where deleted_at is null;
create index if not exists personal_tasks_user_parent_idx
  on app.personal_tasks (user_id, parent_id) where deleted_at is null;
create index if not exists personal_tasks_user_open_idx
  on app.personal_tasks (user_id, done_at) where deleted_at is null;

create table if not exists app.personal_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  title text not null,
  body jsonb not null default '{"text": ""}',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists personal_notes_user_pinned_idx
  on app.personal_notes (user_id, pinned) where deleted_at is null;

create table if not exists app.personal_canvases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  title text not null,
  scene jsonb not null default '{"elements": [], "appState": {}}',
  stickies jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists personal_canvases_user_idx
  on app.personal_canvases (user_id) where deleted_at is null;

create table if not exists app.pomodoro_settings (
  user_id uuid primary key references app.users (id),
  focus_min integer not null default 25,
  short_break_min integer not null default 5,
  long_break_min integer not null default 15,
  cycles_before_long integer not null default 4,
  sound text not null default 'chime',
  notifications boolean not null default true,
  auto_start boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.pomodoro_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  task_id uuid references app.personal_tasks (id) on delete set null,
  kind app.pomodoro_session_kind not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists pomodoro_sessions_user_started_idx
  on app.pomodoro_sessions (user_id, started_at);

alter table app.personal_sprints enable row level security;
alter table app.personal_sprints force row level security;
drop policy if exists personal_sprints_owner on app.personal_sprints;
create policy personal_sprints_owner on app.personal_sprints for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

alter table app.personal_tasks enable row level security;
alter table app.personal_tasks force row level security;
drop policy if exists personal_tasks_owner on app.personal_tasks;
create policy personal_tasks_owner on app.personal_tasks for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

alter table app.personal_notes enable row level security;
alter table app.personal_notes force row level security;
drop policy if exists personal_notes_owner on app.personal_notes;
create policy personal_notes_owner on app.personal_notes for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

alter table app.personal_canvases enable row level security;
alter table app.personal_canvases force row level security;
drop policy if exists personal_canvases_owner on app.personal_canvases;
create policy personal_canvases_owner on app.personal_canvases for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

alter table app.pomodoro_settings enable row level security;
alter table app.pomodoro_settings force row level security;
drop policy if exists pomodoro_settings_owner on app.pomodoro_settings;
create policy pomodoro_settings_owner on app.pomodoro_settings for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

alter table app.pomodoro_sessions enable row level security;
alter table app.pomodoro_sessions force row level security;
drop policy if exists pomodoro_sessions_owner on app.pomodoro_sessions;
create policy pomodoro_sessions_owner on app.pomodoro_sessions for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

reset role;
