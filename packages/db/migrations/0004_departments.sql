-- Expand-only (I-15). Idempotent per the same conventions as 0003.
set role devon_migrator;

do $$ begin
  create type app.department_status as enum ('active', 'paused_by_admin', 'deletion_requested', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.membership_role as enum ('head', 'member');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.membership_status as enum ('active', 'pending_approval', 'removed');
exception when duplicate_object then null;
end $$;

create table if not exists app.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null,
  description text,
  emoji text,
  colour text,
  locale_default text not null default 'uz-Latn',
  timezone text not null default 'Asia/Tashkent',
  settings jsonb not null default '{}',
  status app.department_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists departments_slug_key on app.departments (slug) where deleted_at is null;

-- Scoped to the tenant, never global: a global unique constraint on (user_id) would leak the
-- existence of another department's membership through a duplicate-key error
-- (backend-architecture-and-multitenancy.md §2).
create table if not exists app.memberships (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  user_id uuid not null references app.users (id),
  role app.membership_role not null default 'member',
  title_override text,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  status app.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists memberships_department_user_key
  on app.memberships (department_id, user_id) where deleted_at is null;
create index if not exists memberships_department_user_idx on app.memberships (department_id, user_id);
create index if not exists memberships_active_user_idx on app.memberships (user_id) where status = 'active';

reset role;
