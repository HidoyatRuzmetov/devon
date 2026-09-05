-- Expand-only (I-15). Idempotent: `create table if not exists`, `create or replace function`,
-- `drop trigger if exists` then `create trigger`. Objects are owned by devon_migrator (see 0001).
--
-- I-5a: the application role gets exactly INSERT and SELECT on every audit table. Grants alone are not
-- enough (a superuser or a future migration could re-grant UPDATE) and triggers alone are not enough
-- (a role with table ownership could `alter table ... disable trigger`); we ship both independently,
-- and `test/audit.immutability.test.ts` asserts both independently. A migration that touches these
-- grants beyond INSERT/SELECT is SEV1 (I-5a) -- `test/migration-lint.ts` refuses it outright.
set role devon_migrator;

create table if not exists audit.events (
  seq bigint generated always as identity primary key,
  id uuid not null default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_user_id uuid,
  actor_role text,
  on_behalf_of uuid,
  department_id uuid,
  action text not null,
  subject_type text not null,
  subject_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  request_id text,
  prev_hash bytea not null,
  row_hash bytea not null
);

create index if not exists events_at_idx on audit.events (at);
create index if not exists events_department_at_idx on audit.events (department_id, at);
create index if not exists events_actor_at_idx on audit.events (actor_user_id, at);
create index if not exists events_subject_idx on audit.events (subject_type, subject_id);

create table if not exists audit.private_reads (
  seq bigint generated always as identity primary key,
  at timestamptz not null default now(),
  viewer_user_id uuid not null,
  viewer_role text,
  subject_user_id uuid not null,
  fields text[] not null,
  department_id uuid,
  request_id text
);

create index if not exists private_reads_subject_idx on audit.private_reads (subject_user_id);

create table if not exists audit.anchors (
  seq bigint generated always as identity primary key,
  at timestamptz not null default now(),
  head_seq bigint not null,
  head_hash bytea not null,
  written_to text not null
);

revoke all on schema audit from public;
grant usage on schema audit to devon_app;
grant insert, select on audit.events, audit.private_reads, audit.anchors to devon_app;
revoke update, delete, truncate, references, trigger on audit.events from devon_app;
revoke update, delete, truncate, references, trigger on audit.private_reads from devon_app;
revoke update, delete, truncate, references, trigger on audit.anchors from devon_app;

-- `audit.chain_row()` (below) draws the identity value itself, inside its critical section, which
-- means devon_app -- the role that actually runs the INSERT -- needs USAGE on the sequence backing
-- `audit.events.seq`. USAGE only grants calling nextval()/currval(); it carries none of the
-- read/mutate power I-5a restricts, so it does not weaken the table-level INSERT/SELECT-only grant.
grant usage, select on sequence audit.events_seq_seq to devon_app;

-- Canonical byte string for the hash chain: exactly the content columns, excluding `seq`, `prev_hash`
-- and `row_hash` (design §2.3). `jsonb::text` uses Postgres's own key ordering, which is stable for a
-- given server version.
-- Parameter named `ev`, not `row`: `row` is a reserved word in Postgres (row constructor syntax) and
-- fails to parse as a bare identifier.
create or replace function audit.canonical(ev audit.events) returns bytea
language sql immutable as $$
  select convert_to(
    coalesce(ev.id::text, '') || '|' ||
    coalesce(ev.at::text, '') || '|' ||
    coalesce(ev.actor_user_id::text, '') || '|' ||
    coalesce(ev.actor_role, '') || '|' ||
    coalesce(ev.on_behalf_of::text, '') || '|' ||
    coalesce(ev.department_id::text, '') || '|' ||
    coalesce(ev.action, '') || '|' ||
    coalesce(ev.subject_type, '') || '|' ||
    coalesce(ev.subject_id, '') || '|' ||
    coalesce(ev.before::text, '') || '|' ||
    coalesce(ev.after::text, '') || '|' ||
    coalesce(ev.ip::text, '') || '|' ||
    coalesce(ev.user_agent, '') || '|' ||
    coalesce(ev.request_id, ''),
    'UTF8')
$$;

create or replace function audit.block_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit.% is append-only (INVARIANT I-5a); attempted %', tg_table_name, tg_op
    using errcode = '42501';
end
$$;

drop trigger if exists events_no_update on audit.events;
create trigger events_no_update before update on audit.events
  for each row execute function audit.block_mutation();

drop trigger if exists events_no_delete on audit.events;
create trigger events_no_delete before delete on audit.events
  for each row execute function audit.block_mutation();

drop trigger if exists events_no_truncate on audit.events;
create trigger events_no_truncate before truncate on audit.events
  for each statement execute function audit.block_mutation();

-- The chain: each row's `prev_hash` is the previous row's `row_hash`; `row_hash` is
-- sha256(prev_hash || canonical(row)). Concurrent inserts are serialised by an advisory lock scoped to
-- the table (design §4(b), ADR-004) -- a deliberate, measured throughput ceiling, not an oversight.
create or replace function audit.chain_row() returns trigger language plpgsql as $$
declare
  prev bytea;
begin
  perform pg_advisory_xact_lock(hashtext('audit.events'));
  -- `nextval()` for the identity column is evaluated when defaults are computed, *before* this BEFORE
  -- INSERT trigger runs, and is not blocked by the lock above (sequences are deliberately
  -- non-transactional). Left alone, two concurrent inserts can be assigned seq numbers in an order
  -- that does not match the order they actually acquire this lock in, so `seq` order and chain order
  -- would silently diverge under concurrency. Drawing a fresh value here, inside the critical section,
  -- keeps the two identical; the value assigned before the trigger ran is discarded (a harmless gap,
  -- same as any identity column already tolerates).
  new.seq := nextval(pg_get_serial_sequence('audit.events', 'seq'));
  select row_hash into prev from audit.events order by seq desc limit 1;
  new.prev_hash := coalesce(prev, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
  new.row_hash := digest(new.prev_hash || audit.canonical(new), 'sha256');
  return new;
end
$$;

drop trigger if exists events_chain on audit.events;
create trigger events_chain before insert on audit.events
  for each row execute function audit.chain_row();

-- Walks the chain in `seq` order and reports the first seq where either the row's own hash no longer
-- matches its stored content (`row_hash_mismatch` -- the payload was altered) or its `prev_hash` no
-- longer matches the previous row's `row_hash` (`prev_hash_mismatch` -- a row was removed or inserted
-- out of band). AC-9's "tampering with one row's payload makes verification report exactly that row"
-- is the first branch reporting that row's own `seq`.
create or replace function audit.verify_chain(from_seq bigint default 1, to_seq bigint default null)
returns table (ok boolean, first_bad_seq bigint, failure text, rows_checked bigint)
language plpgsql as $$
declare
  -- Declared as the composite type (not a generic `record`) so `audit.canonical(r)` below can coerce
  -- it without an explicit cast.
  r audit.events;
  expected_prev bytea;
  checked bigint := 0;
  bad_seq bigint := null;
  bad_reason text := null;
begin
  for r in
    select * from audit.events
    where seq >= from_seq and (to_seq is null or seq <= to_seq)
    order by seq asc
  loop
    checked := checked + 1;
    if expected_prev is not null and r.prev_hash is distinct from expected_prev then
      bad_seq := r.seq;
      bad_reason := 'prev_hash_mismatch';
      exit;
    end if;
    if r.row_hash is distinct from digest(r.prev_hash || audit.canonical(r), 'sha256') then
      bad_seq := r.seq;
      bad_reason := 'row_hash_mismatch';
      exit;
    end if;
    expected_prev := r.row_hash;
  end loop;
  return query select (bad_seq is null), bad_seq, bad_reason, checked;
end
$$;

reset role;
