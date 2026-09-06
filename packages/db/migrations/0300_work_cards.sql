-- Work core (TECH-SPEC §3.2, EPIC-004). Expand-only (I-15). Idempotent per the same conventions as
-- prior migrations: enum creation guarded by `do $$ ... exception when duplicate_object`, tables via
-- `create table if not exists`.
--
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2).
--
-- Every child table (`card_checklist_items`, `card_comments`, `card_activity`, `attachments`) carries
-- its own `department_id`, copied from the owning card at write time by the API layer -- never derived
-- through a join at read time -- so `0302_work_rls.sql`'s policies can compare a plain column on the
-- row being checked, the same reasoning `0005_rls.sql`'s header gives for `memberships.department_id`.
set role devon_migrator;

do $$ begin
  create type app.card_kind as enum ('task', 'project_task');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.card_status as enum ('active', 'done', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.card_priority as enum ('none', 'low', 'medium', 'high', 'urgent');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.card_project_scope as enum ('none', 'objective', 'subjective');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.card_source as enum ('manual', 'ai', 'telegram', 'template');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.attachment_scan_status as enum ('pending', 'clean', 'infected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.saved_view_layout as enum ('people_board', 'table', 'timeline', 'calendar', 'mine');
exception when duplicate_object then null;
end $$;

create table if not exists app.cards (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  kind app.card_kind not null default 'task',
  title text not null,
  description jsonb,
  assignee_user_id uuid references app.users (id),
  giver_user_id uuid references app.users (id),
  project_id uuid, -- FK to app.projects added in 0301 (that table does not exist yet here)
  project_scope app.card_project_scope not null default 'none',
  status app.card_status not null default 'active',
  priority app.card_priority not null default 'none',
  start_at timestamptz,
  due_at timestamptz,
  done_at timestamptz,
  archived_at timestamptz,
  order_key text not null default 'a0',
  labels uuid[] not null default '{}',
  watchers uuid[] not null default '{}',
  links jsonb not null default '[]',
  recurrence jsonb,
  source app.card_source not null default 'manual',
  created_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists cards_department_assignee_idx
  on app.cards (department_id, assignee_user_id) where deleted_at is null;
create index if not exists cards_department_status_idx
  on app.cards (department_id, status) where deleted_at is null;
create index if not exists cards_department_project_idx
  on app.cards (department_id, project_id) where deleted_at is null and project_id is not null;
create index if not exists cards_due_at_idx on app.cards (due_at) where status = 'active';
create index if not exists cards_labels_gin_idx on app.cards using gin (labels);
create index if not exists cards_watchers_gin_idx on app.cards using gin (watchers);

create table if not exists app.card_checklist_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  card_id uuid not null references app.cards (id),
  parent_item_id uuid references app.card_checklist_items (id),
  text text not null,
  done_at timestamptz,
  assignee_user_id uuid references app.users (id),
  due_at timestamptz,
  order_key text not null default 'a0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists checklist_items_department_card_idx
  on app.card_checklist_items (department_id, card_id) where deleted_at is null;

create table if not exists app.card_comments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  card_id uuid not null references app.cards (id),
  author_user_id uuid not null references app.users (id),
  body jsonb not null,
  mentions uuid[] not null default '{}',
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists card_comments_department_card_idx
  on app.card_comments (department_id, card_id, created_at) where deleted_at is null;

create table if not exists app.card_activity (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  card_id uuid not null references app.cards (id),
  actor_user_id uuid references app.users (id),
  kind text not null,
  data jsonb not null default '{}',
  at timestamptz not null default now()
);

create index if not exists card_activity_department_card_idx
  on app.card_activity (department_id, card_id, at);

create table if not exists app.attachments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  subject_type text not null,
  subject_id uuid not null,
  key text not null,
  name text not null,
  mime text not null,
  size integer not null,
  scan_status app.attachment_scan_status not null default 'pending',
  thumb_key text,
  uploaded_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists attachments_department_subject_idx
  on app.attachments (department_id, subject_type, subject_id) where deleted_at is null;

create table if not exists app.labels (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  name text not null,
  colour text not null default '#6366f1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists labels_department_name_key
  on app.labels (department_id, name) where deleted_at is null;

create table if not exists app.saved_views (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  owner_user_id uuid not null references app.users (id),
  name text not null,
  filter text not null default '',
  layout app.saved_view_layout not null default 'people_board',
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists saved_views_department_owner_idx
  on app.saved_views (department_id, owner_user_id) where deleted_at is null;

reset role;
