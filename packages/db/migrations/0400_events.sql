-- EPIC-008 events (TECH-SPEC §3.4). Expand-only (I-15). Idempotent per the conventions in
-- `migrations/0004_departments.sql`/`0005_rls.sql`: `create type` guarded by `do $$ ... exception
-- when duplicate_object then null; end $$;`, `create table/index if not exists`.
--
-- Every table below denormalises `department_id` directly onto itself (not just onto `events`) rather
-- than deriving it from a join to `app.events`, because an RLS policy's `using`/`with check` clause may
-- never contain a sub-select (`0005_rls.sql`'s header comment, enforced by `test/migration-lint.ts`) --
-- a plain `department_id = app.current_department_id()` policy on a comment/rsvp/vote/etc. row needs
-- the column to be right there. The application always sets it from the parent event's own
-- `department_id`, never from client input (`apps/api/src/modules/events/repo.ts`).
--
-- `app.event_reminder_jobs` is the one exception: it carries no RLS (see `packages/db/src/tenancy.ts`'s
-- `GLOBAL_ALLOWLIST` entry) because the reminder worker polls it across every department at once,
-- exactly like `app.outbox_events` (`0007_events_outbox.sql`).
set role devon_migrator;

do $$ begin
  create type app.event_category as enum
    ('team_building', 'sports', 'volunteering', 'social', 'training', 'family', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.event_status as enum ('draft', 'open', 'full', 'cancelled', 'done');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.event_rsvp_status as enum ('yes', 'no', 'maybe', 'waitlist');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.carpool_status as enum ('open', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.carpool_seat_status as enum ('confirmed', 'waitlist');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.poll_kind as enum ('date', 'single', 'multi');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.poll_status as enum ('open', 'closed');
exception when duplicate_object then null;
end $$;

create table if not exists app.events (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  title text not null,
  description text,
  category app.event_category not null default 'other',
  illustration_key text not null default 'team_building',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Tashkent',
  place text,
  place_url text,
  capacity integer,
  waitlist_enabled boolean not null default true,
  rsvp_deadline timestamptz,
  cost_note text,
  reminder_offsets_minutes integer[] not null default '{1440,60}',
  organizer_user_id uuid not null references app.users (id),
  status app.event_status not null default 'open',
  updated_summary text,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists events_department_id_idx on app.events (department_id);
create index if not exists events_department_starts_at_idx
  on app.events (department_id, starts_at) where deleted_at is null;

alter table app.events enable row level security;
alter table app.events force row level security;

drop policy if exists events_scope on app.events;
create policy events_scope on app.events for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid not null references app.events (id),
  user_id uuid not null references app.users (id),
  status app.event_rsvp_status not null default 'yes',
  guests smallint not null default 0,
  note text,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists event_rsvps_event_user_key on app.event_rsvps (event_id, user_id);
create index if not exists event_rsvps_department_id_idx on app.event_rsvps (department_id);

alter table app.event_rsvps enable row level security;
alter table app.event_rsvps force row level security;

drop policy if exists event_rsvps_scope on app.event_rsvps;
create policy event_rsvps_scope on app.event_rsvps for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.event_comments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid not null references app.events (id),
  author_user_id uuid not null references app.users (id),
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists event_comments_department_id_idx on app.event_comments (department_id);
create index if not exists event_comments_event_id_idx on app.event_comments (event_id);

alter table app.event_comments enable row level security;
alter table app.event_comments force row level security;

drop policy if exists event_comments_scope on app.event_comments;
create policy event_comments_scope on app.event_comments for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.carpools (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid not null references app.events (id),
  driver_user_id uuid not null references app.users (id),
  seats smallint not null,
  departure_place text,
  departure_at timestamptz,
  note text,
  status app.carpool_status not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists carpools_department_id_idx on app.carpools (department_id);
create index if not exists carpools_event_id_idx on app.carpools (event_id);

alter table app.carpools enable row level security;
alter table app.carpools force row level security;

drop policy if exists carpools_scope on app.carpools;
create policy carpools_scope on app.carpools for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.carpool_seats (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  carpool_id uuid not null references app.carpools (id),
  user_id uuid not null references app.users (id),
  seats_claimed smallint not null default 1,
  status app.carpool_seat_status not null default 'confirmed',
  claimed_at timestamptz not null default now()
);

create unique index if not exists carpool_seats_carpool_user_key
  on app.carpool_seats (carpool_id, user_id);
create index if not exists carpool_seats_department_id_idx on app.carpool_seats (department_id);

alter table app.carpool_seats enable row level security;
alter table app.carpool_seats force row level security;

drop policy if exists carpool_seats_scope on app.carpool_seats;
create policy carpool_seats_scope on app.carpool_seats for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.event_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid not null references app.events (id),
  label text not null,
  quantity smallint not null default 1,
  claimed_by_user_id uuid references app.users (id),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists event_items_department_id_idx on app.event_items (department_id);
create index if not exists event_items_event_id_idx on app.event_items (event_id);

alter table app.event_items enable row level security;
alter table app.event_items force row level security;

drop policy if exists event_items_scope on app.event_items;
create policy event_items_scope on app.event_items for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.polls (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid references app.events (id),
  kind app.poll_kind not null,
  question text not null,
  anonymous boolean not null default false,
  closes_at timestamptz,
  created_by_user_id uuid not null references app.users (id),
  status app.poll_status not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists polls_department_id_idx on app.polls (department_id);
create index if not exists polls_event_id_idx on app.polls (event_id);

alter table app.polls enable row level security;
alter table app.polls force row level security;

drop policy if exists polls_scope on app.polls;
create policy polls_scope on app.polls for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.poll_options (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  poll_id uuid not null references app.polls (id),
  label text not null,
  option_date timestamptz,
  sort_order integer not null default 0
);

create index if not exists poll_options_department_id_idx on app.poll_options (department_id);
create index if not exists poll_options_poll_id_idx on app.poll_options (poll_id);

alter table app.poll_options enable row level security;
alter table app.poll_options force row level security;

drop policy if exists poll_options_scope on app.poll_options;
create policy poll_options_scope on app.poll_options for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.poll_votes (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  poll_id uuid not null references app.polls (id),
  option_id uuid not null references app.poll_options (id),
  user_id uuid references app.users (id),
  voter_hash text,
  created_at timestamptz not null default now()
);

create index if not exists poll_votes_department_id_idx on app.poll_votes (department_id);
create index if not exists poll_votes_poll_id_idx on app.poll_votes (poll_id);
create index if not exists poll_votes_option_id_idx on app.poll_votes (option_id);

alter table app.poll_votes enable row level security;
alter table app.poll_votes force row level security;

drop policy if exists poll_votes_scope on app.poll_votes;
create policy poll_votes_scope on app.poll_votes for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.event_photos (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid not null references app.events (id),
  url text not null,
  caption text,
  added_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now()
);

create index if not exists event_photos_department_id_idx on app.event_photos (department_id);
create index if not exists event_photos_event_id_idx on app.event_photos (event_id);

alter table app.event_photos enable row level security;
alter table app.event_photos force row level security;

drop policy if exists event_photos_scope on app.event_photos;
create policy event_photos_scope on app.event_photos for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

create table if not exists app.event_feedback (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid not null references app.events (id),
  user_id uuid not null references app.users (id),
  rating smallint not null,
  comment text,
  anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  constraint event_feedback_rating_range check (rating between 1 and 5)
);

create unique index if not exists event_feedback_event_user_key
  on app.event_feedback (event_id, user_id);
create index if not exists event_feedback_department_id_idx on app.event_feedback (department_id);

alter table app.event_feedback enable row level security;
alter table app.event_feedback force row level security;

drop policy if exists event_feedback_scope on app.event_feedback;
create policy event_feedback_scope on app.event_feedback for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

-- No RLS (tenancy.ts: GLOBAL_ALLOWLIST) -- polled cross-department by the reminder worker, exactly
-- like app.outbox_events.
create table if not exists app.event_reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  event_id uuid not null references app.events (id),
  kind text not null,
  fire_at timestamptz not null,
  fired_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists event_reminder_jobs_event_kind_key
  on app.event_reminder_jobs (event_id, kind);
create index if not exists event_reminder_jobs_due_idx
  on app.event_reminder_jobs (fire_at) where fired_at is null;

reset role;
