-- EPIC-013 (super admin console): the wipe-switch confirmation ledger and the sentinel ed25519 keyring
-- (TECH-SPEC §11 "decision 16"). Expand-only (I-15), idempotent per MODULE-GUIDE.md "DB: migrations".
-- Neither table carries a department_id: both are instance-wide admin bookkeeping, classified 'global'
-- in tenancy.ts with a reason, same shape as app.setup_tokens / app.department_requests. Neither needs
-- row level security -- exactly like app.setup_tokens and app.sessions, both are reached only through
-- `Tx.raw()` from `modules/admin/repo.ts`, which itself is reachable only behind `{kind:'instance'}`
-- (super_admin-only, I-8b) -- there is no per-row visibility distinction to enforce inside the table.
--
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2).
set role devon_migrator;

do $$ begin
  create type app.wipe_request_status as enum (
    'pending_verification', 'countdown', 'cancelled', 'executing', 'completed', 'failed'
  );
exception when duplicate_object then null;
end $$;

create table if not exists app.wipe_requests (
  id uuid primary key default gen_random_uuid(),
  initiated_by_user_id uuid not null references app.users (id),
  phrase text not null,
  status app.wipe_request_status not null default 'countdown',
  countdown_seconds integer not null default 60,
  countdown_ends_at timestamptz not null,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references app.users (id),
  executed_at timestamptz,
  sentinel_response text,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists wipe_requests_status_idx on app.wipe_requests (status);

-- ADR-014: the sentinel's ed25519 keypair. `public_key_b64` is plain text (a public key is not a
-- secret -- the console shows it persistently, never behind a "shown once" ceremony);
-- `private_key_enc` (AES-256-GCM, `modules/admin/crypto.ts`) is the only sensitive column.
create table if not exists app.sentinel_keys (
  id uuid primary key default gen_random_uuid(),
  public_key_b64 text not null,
  private_key_enc text not null,
  active boolean not null default true,
  created_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

-- Exactly one active key at a time -- `modules/admin/repo.ts`'s rotate step deactivates the previous
-- row in the same transaction it inserts the new one, so this partial unique index never trips under
-- normal operation; it exists as the DB-level backstop against a bug doing otherwise.
create unique index if not exists sentinel_keys_one_active_idx
  on app.sentinel_keys (active) where active;

reset role;
