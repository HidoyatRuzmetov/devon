-- Telegram linking (TECH-SPEC §7, MODULE-GUIDE.md reserved prefix 0600 domain). Expand-only (I-15).
-- Idempotent, same conventions as 0600_notifications.sql.
--
-- These three tables are classified `global` in `packages/db/src/tenancy.ts` (with a justification
-- there for each): a Telegram webhook update carries only a chat id, which must be resolvable to a
-- user or a department *before* any per-request tenancy context exists -- the same bootstrap shape
-- `app.sessions`/`app.setup_tokens` already have, and like those two tables, no RLS is applied here;
-- per-user/per-department visibility is enforced at the application (`can()`) layer instead.
--
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2).
set role devon_migrator;

-- Bootstrap-only, mirrors app.setup_tokens: a `/start <code>` deep link is valid for a short window
-- and consumed exactly once (race-safe consumption is the repo layer's job, same pattern as
-- `consumeSetupToken`).
create table if not exists app.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  code text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists telegram_link_codes_code_key on app.telegram_link_codes (code);
create index if not exists telegram_link_codes_user_idx on app.telegram_link_codes (user_id);

create table if not exists app.telegram_links (
  user_id uuid primary key references app.users (id),
  chat_id bigint not null,
  linked_at timestamptz not null default now(),
  link_code_used text,
  locale_at_link text,
  muted_until timestamptz,
  unlinked_at timestamptz
);

-- Partial: an unlinked row is kept for history (never deleted -- I-15 expand-only) but a chat id must
-- be free to be relinked (by the same or a different account) once its previous link is gone.
create unique index if not exists telegram_links_chat_id_key
  on app.telegram_links (chat_id) where unlinked_at is null;

-- Bootstrap-only, mirrors app.telegram_link_codes above: `app.departments` does not yet carry a
-- `join_key` column (that lands with the department-join epic), so a department's own short-lived
-- connect code for `/connect <code>` is this module's artifact until then.
create table if not exists app.telegram_group_connect_codes (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  code text not null,
  created_by uuid references app.users (id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists telegram_group_connect_codes_code_key
  on app.telegram_group_connect_codes (code);
create index if not exists telegram_group_connect_codes_department_idx
  on app.telegram_group_connect_codes (department_id);

create table if not exists app.telegram_groups (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  chat_id bigint not null,
  title text,
  connected_by uuid references app.users (id),
  kinds text[] not null default '{}'::text[],
  connect_key_used text,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz
);

create unique index if not exists telegram_groups_chat_id_key
  on app.telegram_groups (chat_id) where disconnected_at is null;
create index if not exists telegram_groups_department_idx on app.telegram_groups (department_id);

reset role;
