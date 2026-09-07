-- Analytics + Pages/onboarding-lite (TECH-SPEC §9, §3.5; EPIC-010, EPIC-011; MODULE-GUIDE.md "0700
-- analytics / pages"). Expand-only (I-15), idempotent per every prior migration's conventions:
-- `create table if not exists`, `do $$ ... exception when duplicate_object then null; end $$;` for
-- enum types, `drop policy if exists` then `create policy`. Same department-owned RLS shape as
-- `0302_work_rls.sql`: every policy compares a column on the row being checked against the
-- `app.current_*` GUC functions, never a sub-select against another table.
set role devon_migrator;

-- ---------------------------------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------------------------------

create table if not exists app.analytics_daily (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  day date not null,
  metrics jsonb not null default '{}',
  computed_at timestamptz not null default now()
);

create unique index if not exists analytics_daily_department_day_key
  on app.analytics_daily (department_id, day);

create table if not exists app.analytics_saved_filters (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  owner_user_id uuid not null references app.users (id),
  name text not null,
  query text not null default '',
  since_days integer not null default 84,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists analytics_saved_filters_department_owner_idx
  on app.analytics_saved_filters (department_id, owner_user_id) where deleted_at is null;

create table if not exists app.analytics_pinned_charts (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  owner_user_id uuid not null references app.users (id),
  chart_key text not null,
  title text not null,
  filter_query text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists analytics_pinned_charts_owner_idx
  on app.analytics_pinned_charts (department_id, owner_user_id, sort);

alter table app.analytics_daily enable row level security;
alter table app.analytics_daily force row level security;
drop policy if exists analytics_daily_read on app.analytics_daily;
create policy analytics_daily_read on app.analytics_daily for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists analytics_daily_write on app.analytics_daily;
create policy analytics_daily_write on app.analytics_daily for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.analytics_saved_filters enable row level security;
alter table app.analytics_saved_filters force row level security;
drop policy if exists analytics_saved_filters_read on app.analytics_saved_filters;
create policy analytics_saved_filters_read on app.analytics_saved_filters for select
  using (
    department_id = app.current_department_id()
    and (shared = true or owner_user_id = app.current_user_id())
  );
drop policy if exists analytics_saved_filters_write on app.analytics_saved_filters;
create policy analytics_saved_filters_write on app.analytics_saved_filters for all
  using (
    department_id = app.current_department_id()
    and owner_user_id = app.current_user_id()
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and owner_user_id = app.current_user_id()
    and not app.is_view_as()
  );

alter table app.analytics_pinned_charts enable row level security;
alter table app.analytics_pinned_charts force row level security;
drop policy if exists analytics_pinned_charts_read on app.analytics_pinned_charts;
create policy analytics_pinned_charts_read on app.analytics_pinned_charts for select
  using (
    department_id = app.current_department_id() and owner_user_id = app.current_user_id()
  );
drop policy if exists analytics_pinned_charts_write on app.analytics_pinned_charts;
create policy analytics_pinned_charts_write on app.analytics_pinned_charts for all
  using (
    department_id = app.current_department_id()
    and owner_user_id = app.current_user_id()
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and owner_user_id = app.current_user_id()
    and not app.is_view_as()
  );

-- ---------------------------------------------------------------------------------------------
-- Pages + onboarding-lite
-- ---------------------------------------------------------------------------------------------

do $$ begin
  create type app.page_kind as enum ('how_we_work', 'onboarding', 'brief', 'note');
exception when duplicate_object then null;
end $$;

create table if not exists app.pages (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  kind app.page_kind not null default 'note',
  title text not null,
  blocks jsonb not null default '{"type": "doc", "content": []}',
  created_by_user_id uuid not null references app.users (id),
  updated_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists pages_department_kind_idx
  on app.pages (department_id, kind) where deleted_at is null;

create table if not exists app.page_versions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  page_id uuid not null references app.pages (id),
  title text not null,
  blocks jsonb not null,
  author_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now()
);

create index if not exists page_versions_department_idx
  on app.page_versions (department_id, page_id, created_at desc);

create table if not exists app.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  name text not null,
  enabled boolean not null default false,
  items jsonb not null default '[]',
  created_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists onboarding_templates_department_enabled_idx
  on app.onboarding_templates (department_id, enabled) where deleted_at is null;

create table if not exists app.onboarding_runs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  template_id uuid not null references app.onboarding_templates (id),
  user_id uuid not null references app.users (id),
  created_task_count integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists onboarding_runs_template_user_key
  on app.onboarding_runs (template_id, user_id);
create index if not exists onboarding_runs_department_idx
  on app.onboarding_runs (department_id, template_id);

alter table app.pages enable row level security;
alter table app.pages force row level security;
drop policy if exists pages_read on app.pages;
create policy pages_read on app.pages for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists pages_write on app.pages;
create policy pages_write on app.pages for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.page_versions enable row level security;
alter table app.page_versions force row level security;
drop policy if exists page_versions_read on app.page_versions;
create policy page_versions_read on app.page_versions for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
-- Versions are append-only from the API's point of view (no PATCH/DELETE route), but `for all` is
-- still required so `insert` is permitted at all under `force row level security` (same reasoning as
-- `0302_work_rls.sql`'s `card_activity_write`).
drop policy if exists page_versions_write on app.page_versions;
create policy page_versions_write on app.page_versions for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.onboarding_templates enable row level security;
alter table app.onboarding_templates force row level security;
drop policy if exists onboarding_templates_read on app.onboarding_templates;
create policy onboarding_templates_read on app.onboarding_templates for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists onboarding_templates_write on app.onboarding_templates;
create policy onboarding_templates_write on app.onboarding_templates for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.onboarding_runs enable row level security;
alter table app.onboarding_runs force row level security;
drop policy if exists onboarding_runs_read on app.onboarding_runs;
create policy onboarding_runs_read on app.onboarding_runs for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
-- Written only by the system (the membership-joined subscriber, `systemContext()`-style, exactly
-- like `events/reminder-worker.ts`), never by a member's own request -- `for all` is still required
-- under `force row level security` for that system actor's own `insert` to succeed.
drop policy if exists onboarding_runs_write on app.onboarding_runs;
create policy onboarding_runs_write on app.onboarding_runs for all
  using (department_id = app.current_department_id())
  with check (department_id = app.current_department_id());

reset role;
