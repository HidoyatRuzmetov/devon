-- Notifications (TECH-SPEC §3.6, MODULE-GUIDE.md reserved prefix 0600). Expand-only (I-15).
-- Idempotent: enum creation guarded by `do $$ ... exception when duplicate_object`, tables via
-- `create table if not exists`, policies via `drop policy if exists` then `create policy`.
--
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2).
set role devon_migrator;

do $$ begin
  create type app.notification_reason as enum
    ('assigned', 'mentioned', 'due', 'updated', 'rsvp', 'poll', 'decision', 'digest', 'system');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.notification_channel as enum ('inapp', 'telegram', 'email');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.notification_digest_mode as enum ('instant', 'daily', 'weekly', 'off');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.notification_delivery_status as enum ('pending', 'sent', 'failed', 'skipped');
exception when duplicate_object then null;
end $$;

-- user_owned (I-1: private to the user, no head/admin exception -- TECH-SPEC §3.3's tenancy shape,
-- reused here because an inbox notification is exactly that private).
create table if not exists app.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  reason app.notification_reason not null,
  subject_type text not null,
  subject_id text,
  department_id uuid,
  title jsonb not null,
  body jsonb,
  deep_link text,
  event_at timestamptz,
  read_at timestamptz,
  archived_at timestamptz,
  snoozed_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on app.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on app.notifications (user_id) where read_at is null and archived_at is null;

alter table app.notifications enable row level security;
alter table app.notifications force row level security;

drop policy if exists notifications_scope on app.notifications;
create policy notifications_scope on app.notifications for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create table if not exists app.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  reason app.notification_reason not null,
  channel app.notification_channel not null,
  enabled boolean not null default true,
  digest_mode app.notification_digest_mode not null default 'instant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_prefs_user_reason_channel_key
  on app.notification_prefs (user_id, reason, channel);

alter table app.notification_prefs enable row level security;
alter table app.notification_prefs force row level security;

drop policy if exists notification_prefs_scope on app.notification_prefs;
create policy notification_prefs_scope on app.notification_prefs for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create table if not exists app.notification_quiet_hours (
  user_id uuid primary key,
  start_minute integer,
  end_minute integer,
  include_weekends boolean,
  updated_at timestamptz not null default now()
);

alter table app.notification_quiet_hours enable row level security;
alter table app.notification_quiet_hours force row level security;

drop policy if exists notification_quiet_hours_scope on app.notification_quiet_hours;
create policy notification_quiet_hours_scope on app.notification_quiet_hours for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create table if not exists app.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  notification_id uuid not null references app.notifications (id),
  channel app.notification_channel not null,
  status app.notification_delivery_status not null default 'pending',
  provider_id text,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists notification_deliveries_notification_idx
  on app.notification_deliveries (notification_id);
create index if not exists notification_deliveries_user_idx
  on app.notification_deliveries (user_id, created_at desc);

alter table app.notification_deliveries enable row level security;
alter table app.notification_deliveries force row level security;

drop policy if exists notification_deliveries_scope on app.notification_deliveries;
create policy notification_deliveries_scope on app.notification_deliveries for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

-- department_owned: TECH-SPEC §7 quiet-hours default + group-connect policy, one row per department.
create table if not exists app.notification_department_settings (
  department_id uuid primary key references app.departments (id),
  quiet_start_minute integer not null default 1200,
  quiet_end_minute integer not null default 480,
  quiet_weekends boolean not null default true,
  group_connect_head_only boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table app.notification_department_settings enable row level security;
alter table app.notification_department_settings force row level security;

drop policy if exists notification_department_settings_read on app.notification_department_settings;
create policy notification_department_settings_read on app.notification_department_settings
  for select
  using (department_id = app.current_department_id());

drop policy if exists notification_department_settings_write on app.notification_department_settings;
create policy notification_department_settings_write on app.notification_department_settings
  for all
  using (
    department_id = app.current_department_id()
    and app.current_actor_role() in ('head', 'super_admin')
    and not app.is_view_as()
  )
  with check (department_id = app.current_department_id() and not app.is_view_as());

reset role;
