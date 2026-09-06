-- Group projects (TECH-SPEC §3.2, EPIC-005). Expand-only (I-15), idempotent per the same
-- conventions as 0300. Adds `app.projects` and, now that it exists, the FK from `app.cards.project_id`
-- that 0300 could not add yet.
set role devon_migrator;

do $$ begin
  create type app.project_status as enum ('planning', 'active', 'on_hold', 'done', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists app.projects (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  title text not null,
  description jsonb,
  colour text not null default '#6366f1',
  cover_key text,
  owner_user_id uuid not null references app.users (id),
  members uuid[] not null default '{}',
  status app.project_status not null default 'planning',
  start_on date,
  target_on date,
  milestones jsonb not null default '[]',
  template_of text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists projects_department_status_idx
  on app.projects (department_id, status) where deleted_at is null;
create index if not exists projects_members_gin_idx on app.projects using gin (members);

do $$ begin
  alter table app.cards
    add constraint cards_project_id_fkey foreign key (project_id) references app.projects (id);
exception when duplicate_object then null;
end $$;

reset role;
