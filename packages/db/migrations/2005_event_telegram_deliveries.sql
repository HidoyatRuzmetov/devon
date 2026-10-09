-- Event group broadcasts cannot use notification_deliveries: that queue belongs to one user's
-- notification and its owner-only RLS. Persist one receipt per committed outbox event and group,
-- so retrying one failed target never resends targets whose receipt was already committed.
-- Telegram has no idempotency key: crash-after-send-before-receipt remains at-least-once.
set role devon_migrator;

create table if not exists app.event_telegram_deliveries (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  source_event_id uuid not null,
  event_id uuid not null references app.events (id),
  poll_id uuid references app.polls (id),
  group_id uuid not null references app.telegram_groups (id),
  event_type text not null,
  group_kind text not null check (group_kind in ('events', 'polls')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  message_id integer,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists event_telegram_deliveries_source_group_key
  on app.event_telegram_deliveries (source_event_id, group_id);
create index if not exists event_telegram_deliveries_pending_idx
  on app.event_telegram_deliveries (next_attempt_at) where status = 'pending';
create index if not exists event_telegram_deliveries_department_idx
  on app.event_telegram_deliveries (department_id);

alter table app.event_telegram_deliveries enable row level security;
alter table app.event_telegram_deliveries force row level security;
drop policy if exists event_telegram_deliveries_scope on app.event_telegram_deliveries;
create policy event_telegram_deliveries_scope on app.event_telegram_deliveries for all
  using ((department_id = app.current_department_id() or app.current_actor_role() = 'super_admin')
    and not app.is_view_as())
  with check ((department_id = app.current_department_id() or app.current_actor_role() = 'super_admin')
    and not app.is_view_as());

reset role;
