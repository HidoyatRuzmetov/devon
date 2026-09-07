-- EPIC-001 (accounts): upload bookkeeping for the storage plugin's presigned-upload flow
-- (TECH-SPEC §2.1 "photo (optional; presigned upload, ClamAV, 512 px WebP variants)", §6 "storage").
-- Expand-only (I-15), idempotent per MODULE-GUIDE.md "DB: migrations" conventions.
--
-- One row per presigned upload URL ever issued: inserted when the API hands the browser a URL, then
-- moved through its scan/finalise states by `POST /api/v1/accounts/avatar`. The bytes themselves live
-- in the object store (MinIO, or the local-disk driver in dev), never in Postgres -- `key` is the
-- random, server-chosen object key (H1.8: "random storage keys, no user filenames on disk"); the
-- browser's original filename is never received, let alone stored.
--
-- Classified `global` in tenancy.ts (with its reason there): the API scopes every read/write to the
-- owner via `own_account`, and the hourly retention sweep (TECH-SPEC §6 `retention.sweep` -- "temp
-- uploads only") must see every user's expired rows at once, exactly like app.event_reminder_jobs.
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2).
set role devon_migrator;

do $$ begin
  create type app.upload_status as enum (
    'pending',      -- URL issued; bytes may or may not have arrived yet
    'rejected',     -- bytes arrived but were not what was declared (size, MIME, not a decodable image)
    'infected',     -- ClamAV reported a signature; the object was deleted immediately
    'scan_failed',  -- ClamAV unreachable/errored; the object was deleted (fail closed, never visible)
    'finalized',    -- variants generated, users.avatar_key points at this upload
    'expired'       -- never finalised before expires_at; swept, object deleted
  );
exception when duplicate_object then null;
end $$;

create table if not exists app.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  purpose text not null check (purpose in ('avatar')),
  key text not null,
  mime text not null,
  size integer not null check (size > 0),
  status app.upload_status not null default 'pending',
  -- A short machine code for the non-happy statuses ('size_mismatch', 'not_an_image',
  -- 'Win.Test.EICAR_HDB-1' ...) -- never user text, never a path.
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists uploads_user_status_idx on app.uploads (user_id, status);
create index if not exists uploads_pending_expires_idx on app.uploads (expires_at) where status = 'pending';

reset role;
