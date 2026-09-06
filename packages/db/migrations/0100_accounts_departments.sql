-- EPIC-001/EPIC-002 (accounts, departments): registration security metadata, department invite/join
-- fields, department creation requests, join rate-limiting and self-service account deletion.
-- Expand-only (I-15), idempotent per MODULE-GUIDE.md "DB: migrations" conventions.
--
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2).
set role devon_migrator;

-- app.departments gains invite/join fields (design.md/TECH-SPEC §2.2, §3.1). The table itself already
-- exists (0004_departments.sql, foundation-owned); adding columns to it is expand-only and does not
-- change its existing tenancy classification ('tenant_root' in tenancy.ts already).
alter table app.departments add column if not exists join_key text;
alter table app.departments add column if not exists join_password_hash text;
alter table app.departments add column if not exists join_requires_approval boolean not null default false;
alter table app.departments add column if not exists created_from_request_id uuid;

create unique index if not exists departments_join_key_key
  on app.departments (join_key) where join_key is not null;

-- A user must be able to list their own memberships across every department they belong to (the
-- department switcher, GET /me, and the session's Actor.memberships all need this) --
-- `memberships_read` (0005_rls.sql) scopes to the single per-request department GUC, by design, for
-- the department-board case. This is an ADDITIONAL permissive SELECT policy (Postgres combines
-- multiple permissive policies for the same command with OR), narrowly "my own rows, any department",
-- never anyone else's -- no sub-select, just a direct column-to-GUC-function comparison, same shape as
-- every other policy in 0005_rls.sql.
drop policy if exists memberships_read_own on app.memberships;
create policy memberships_read_own on app.memberships for select
  using (user_id = app.current_user_id());

do $$ begin
  create type app.department_request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

-- A request exists before any department does, so it cannot itself carry a department_id -- classified
-- 'global' in tenancy.ts, same reasoning as app.setup_tokens (AC-12-style bootstrap row).
create table if not exists app.department_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references app.users (id),
  name text not null,
  description text,
  units jsonb not null default '[]',
  locale text not null default 'uz-Latn' check (locale in ('uz-Latn', 'uz-Cyrl', 'ru', 'en')),
  status app.department_request_status not null default 'pending',
  reviewed_by uuid references app.users (id),
  reason text,
  reviewed_at timestamptz,
  created_department_id uuid references app.departments (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists department_requests_status_idx on app.department_requests (status);
create index if not exists department_requests_requester_idx on app.department_requests (requester_user_id);

-- One row per user: 2FA (TOTP) and the Telegram-link hook (TECH-SPEC §2.1, §7). Kept off `app.users`
-- itself (rather than widening that table) so this module never edits a file another module also
-- edits -- classified 'global' in tenancy.ts, same reasoning as app.sessions.
create table if not exists app.user_security (
  user_id uuid primary key references app.users (id),
  totp_secret_enc text,
  totp_enabled boolean not null default false,
  recovery_codes_hash text[] not null default '{}',
  telegram_user_id bigint,
  telegram_link_code text,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_security_telegram_user_id_key
  on app.user_security (telegram_user_id) where telegram_user_id is not null;

-- A short-lived challenge between "password verified" and "TOTP code verified" during login -- never a
-- full session (design's sliding-window session semantics only ever start once 2FA, when enabled, has
-- also passed). Classified 'global': belongs to a login attempt, not a department.
create table if not exists app.login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  token_hash bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create unique index if not exists login_challenges_token_hash_key on app.login_challenges (token_hash);

-- Join-by-key rate limiting and audit (TECH-SPEC §2.2 "join attempts are rate-limited per key and per
-- IP"). Classified 'global': join attempts are keyed by (key, ip), and a wrong-key attempt has no
-- department to scope to at all.
create table if not exists app.join_attempts (
  id uuid primary key default gen_random_uuid(),
  join_key text,
  department_id uuid references app.departments (id),
  ip inet,
  user_id uuid references app.users (id),
  ok boolean not null,
  at timestamptz not null default now()
);

create index if not exists join_attempts_key_at_idx on app.join_attempts (join_key, at);
create index if not exists join_attempts_ip_at_idx on app.join_attempts (ip, at);

-- Self-service "delete my account" (TECH-SPEC §2.1: soft-delete now, anonymise after 30 days). One
-- active row per user; the anonymisation job (a later epic's worker) reads `scheduled_for <= now()`.
create table if not exists app.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists account_deletion_requests_active_key
  on app.account_deletion_requests (user_id) where completed_at is null and cancelled_at is null;

reset role;
