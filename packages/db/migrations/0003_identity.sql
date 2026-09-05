-- Expand-only (I-15). Idempotent: enum creation guarded by `do $$ ... exception when duplicate_object`
-- (Postgres has no `create type if not exists`); tables via `create table if not exists`.
--
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2) --
-- `test/migration-lint.ts` scans every migration file for that pattern so a later item cannot slip one
-- in without the gate noticing.
set role devon_migrator;

do $$ begin
  create type app.user_role as enum ('super_admin', 'head', 'member');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.user_status as enum ('active', 'locked', 'deleted');
exception when duplicate_object then null;
end $$;

create table if not exists app.users (
  id uuid primary key default gen_random_uuid(),
  login citext not null,
  email citext,
  password_hash text not null,
  given_name text not null,
  family_name text not null,
  patronymic text,
  title text,
  avatar_key text,
  locale text not null default 'uz-Latn' check (locale in ('uz-Latn', 'uz-Cyrl', 'ru', 'en')),
  timezone text not null default 'Asia/Tashkent',
  role app.user_role not null default 'member',
  status app.user_status not null default 'active',
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists users_login_key on app.users (login) where deleted_at is null;

create table if not exists app.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  token_hash bytea not null,
  csrf_hash bytea not null,
  device_label text,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
);

create unique index if not exists sessions_token_hash_key on app.sessions (token_hash);
create index if not exists sessions_active_user_idx on app.sessions (user_id) where revoked_at is null;

create table if not exists app.setup_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_user_id uuid references app.users (id),
  issued_reason text not null default 'first_boot'
);

create unique index if not exists setup_tokens_token_hash_key on app.setup_tokens (token_hash);

create table if not exists app.instance_settings (
  id smallint primary key default 1 check (id = 1),
  is_demo boolean not null default false,
  registration_open boolean not null default true,
  maintenance jsonb not null default '{"enabled":false}',
  limits jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

insert into app.instance_settings (id) values (1) on conflict (id) do nothing;

create table if not exists app.seed_runs (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now(),
  rows_written integer not null
);

create table if not exists app.idempotency_keys (
  key text not null,
  route text not null,
  user_id uuid,
  request_hash text,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (key, route)
);

create index if not exists idempotency_keys_created_at_idx on app.idempotency_keys (created_at);

reset role;
