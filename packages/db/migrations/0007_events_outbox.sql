-- Domain event bus outbox (MODULE-GUIDE.md "Domain events"). Expand-only (I-15), idempotent per the
-- same conventions as prior migrations. A row here is written by `tx.emit()` inside the same
-- transaction as the domain write that caused it (transactional-outbox pattern -- an event can never
-- exist without the write that produced it having committed, and vice versa); a background worker
-- (`src/events-worker.ts`) polls for `processed_at is null` and drains it. `department_id` is
-- nullable: an instance-level event (e.g. an admin action) has none, same shape as `audit.events`.
set role devon_migrator;

create table if not exists app.outbox_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null,
  department_id uuid references app.departments (id),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index if not exists outbox_events_unprocessed_idx
  on app.outbox_events (created_at)
  where processed_at is null;

reset role;
