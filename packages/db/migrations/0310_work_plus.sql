-- v1.1 SPEC §7 -- "work-plus": the ClickUp adoptions that live on a card (CLICKUP-RESEARCH A3, A4,
-- A7, A9, A10, A11 and §7.2). Expand-only (I-15): three added columns on `app.cards` and seven new
-- tables, nothing existing dropped, rewritten or re-meant. Idempotent throughout
-- (`create table if not exists`, `add column if not exists`, enums guarded by
-- `do $$ ... exception when duplicate_object`).
--
-- Every new table is `department_owned`: it carries its own `department_id`, copied from the owning
-- card/person at write time by the API layer -- never derived through a join at read time -- so the
-- RLS policies at the bottom compare a plain column on the row being checked, exactly the shape
-- `0302_work_rls.sql` already uses. Each is registered in `packages/db/src/tenancy.ts`, which
-- `migrate:verify` fails the build without.
--
-- No column here matches the I-2 personal-data pattern; the only person-shaped numbers in this file
-- are a weekly capacity in hours and a count of minutes logged against a work card.
set role devon_migrator;

-- ---------------------------------------------------------------------------------------------
-- A3 -- estimates, and A7 -- the recurring series pointer
-- ---------------------------------------------------------------------------------------------

-- Minutes rather than hours: the entry field accepts "2 soat 30 daqiqa" and the workload grid sums
-- in hours, so an integer minute count is the only representation that is exact in both directions
-- (a `numeric` of hours would make "1/3 of an hour" a rounding argument on every read).
alter table app.cards add column if not exists estimate_min integer;

-- `app.cards.recurrence` (jsonb) already exists from `0300_work_cards.sql` and now carries a
-- `RecurrenceRule` (`packages/contracts/src/work-plus.ts`). These two make a *series* out of it:
-- every instance points at the first card of its series, and each instance remembers its position
-- so the rule's `count` limit can be enforced without walking the chain.
alter table app.cards add column if not exists recurrence_series_id uuid;
alter table app.cards add column if not exists recurrence_index integer;

create index if not exists cards_recurrence_series_idx
  on app.cards (department_id, recurrence_series_id) where recurrence_series_id is not null;
-- The recurrence job's own scan: every department's live series-head cards in one indexed pass.
create index if not exists cards_recurrence_open_idx
  on app.cards (department_id) where recurrence is not null and deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- A10 -- dependencies
-- ---------------------------------------------------------------------------------------------

-- One row per edge, read as "`card_id` is blocked by `blocked_by_card_id`". "Blocks" is the same
-- edge from the other end, which is why the card sheet shows two lists over one table.
--
-- The cycle guard is deliberately *not* a database constraint: SQL can express "not a self-loop" (the
-- check below) but a transitive cycle needs a recursive walk, which belongs in a place that can
-- answer the user with a sentence instead of a constraint-violation code. `apps/api/src/modules/
-- work/repo.ts` loads the department's edges and calls `wouldCreateDependencyCycle()` from
-- `@devon/contracts` inside the same transaction as the insert, so two concurrent writers cannot
-- both think they are safe (the insert takes the unique index's lock first).
create table if not exists app.card_dependencies (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  card_id uuid not null references app.cards (id),
  blocked_by_card_id uuid not null references app.cards (id),
  created_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  constraint card_dependencies_no_self check (card_id <> blocked_by_card_id)
);

create unique index if not exists card_dependencies_edge_key
  on app.card_dependencies (card_id, blocked_by_card_id);
create index if not exists card_dependencies_blocker_idx
  on app.card_dependencies (department_id, blocked_by_card_id);
create index if not exists card_dependencies_department_idx
  on app.card_dependencies (department_id, card_id);

-- ---------------------------------------------------------------------------------------------
-- A3 -- the light time log
-- ---------------------------------------------------------------------------------------------

-- "Light" is the whole design: one row per person per day per card, minutes and an optional note.
-- No running timer, no start/stop state machine, no per-second precision -- CLICKUP-RESEARCH §6.2
-- found that the timer is exactly the feature people stop using in week two, while "I spent about
-- two hours on this yesterday" survives.
create table if not exists app.card_time_logs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  card_id uuid not null references app.cards (id),
  user_id uuid not null references app.users (id),
  minutes integer not null,
  spent_on date not null default (now() at time zone 'Asia/Tashkent')::date,
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint card_time_logs_minutes_range check (minutes > 0 and minutes <= 1440)
);

create index if not exists card_time_logs_card_idx
  on app.card_time_logs (card_id) where deleted_at is null;
create index if not exists card_time_logs_person_week_idx
  on app.card_time_logs (department_id, user_id, spent_on) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- 7.4 -- reminders on a card
-- ---------------------------------------------------------------------------------------------

-- "Remind me at X" -> inbox + Telegram. The worker claims a row by stamping `sent_at`, so a second
-- worker process (or a restart mid-batch) can never send the same reminder twice.
create table if not exists app.card_reminders (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  card_id uuid not null references app.cards (id),
  user_id uuid not null references app.users (id),
  remind_at timestamptz not null,
  note text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists card_reminders_due_idx
  on app.card_reminders (remind_at) where sent_at is null and deleted_at is null;
create index if not exists card_reminders_person_idx
  on app.card_reminders (department_id, user_id, card_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- 7.2 -- card and project templates
-- ---------------------------------------------------------------------------------------------

do $$ begin
  create type app.work_template_kind as enum ('card', 'project');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.work_template_scope as enum ('department', 'personal');
exception when duplicate_object then null;
end $$;

-- One table for both kinds, because the gallery shows them side by side and the only thing that
-- differs is the shape of `payload` (validated by `cardTemplatePayloadSchema` /
-- `projectTemplatePayloadSchema` at the API boundary, never by a database constraint -- a jsonb
-- check constraint cannot be evolved without a contract migration).
create table if not exists app.work_templates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  kind app.work_template_kind not null,
  scope app.work_template_scope not null default 'personal',
  owner_user_id uuid not null references app.users (id),
  name text not null,
  description text,
  payload jsonb not null default '{}'::jsonb,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists work_templates_gallery_idx
  on app.work_templates (department_id, kind, scope) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- A9 -- the focus list ("Diqqat markazi"), up to five pinned cards per person
-- ---------------------------------------------------------------------------------------------

create table if not exists app.focus_pins (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  user_id uuid not null references app.users (id),
  card_id uuid not null references app.cards (id),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists focus_pins_person_card_key
  on app.focus_pins (user_id, card_id);
create index if not exists focus_pins_person_idx
  on app.focus_pins (department_id, user_id, position);

-- ---------------------------------------------------------------------------------------------
-- A4 -- per-person weekly capacity
-- ---------------------------------------------------------------------------------------------

-- Absent row = the registry default (40 working hours, `DEFAULT_WEEKLY_CAPACITY_HOURS`), so a
-- department that never opens this screen still gets a workload grid that means something, and
-- adding the concept needed no backfill.
create table if not exists app.work_capacity (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  user_id uuid not null references app.users (id),
  weekly_hours numeric(5, 1) not null default 40.0,
  updated_by_user_id uuid references app.users (id),
  updated_at timestamptz not null default now(),
  constraint work_capacity_hours_range check (weekly_hours >= 0 and weekly_hours <= 168)
);

create unique index if not exists work_capacity_person_key
  on app.work_capacity (department_id, user_id);

-- ---------------------------------------------------------------------------------------------
-- A11 -- department goals
-- ---------------------------------------------------------------------------------------------

do $$ begin
  create type app.goal_metric as enum (
    'cards_done', 'on_time_rate', 'estimate_hours', 'open_cards_max'
  );
exception when duplicate_object then null;
end $$;

-- A goal is a *filter plus a number*. It stores no progress: the value is recomputed from the cards
-- the filter matches every time it is read, so it can never drift from the work it summarises --
-- the same reasoning `projects.progress` already follows (`modules/projects/repo.ts`).
create table if not exists app.goals (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  title text not null,
  description text,
  metric app.goal_metric not null default 'cards_done',
  filter text not null default '',
  target_value numeric(10, 2) not null default 1,
  starts_on date,
  due_on date,
  created_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists goals_department_idx
  on app.goals (department_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Row level security -- same shape as 0302_work_rls.sql: plain column comparisons, no sub-selects
-- ---------------------------------------------------------------------------------------------

alter table app.card_dependencies enable row level security;
alter table app.card_dependencies force row level security;
drop policy if exists card_dependencies_read on app.card_dependencies;
create policy card_dependencies_read on app.card_dependencies for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists card_dependencies_write on app.card_dependencies;
create policy card_dependencies_write on app.card_dependencies for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.card_time_logs enable row level security;
alter table app.card_time_logs force row level security;
drop policy if exists card_time_logs_read on app.card_time_logs;
create policy card_time_logs_read on app.card_time_logs for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
-- A time log is a statement about what *you* did. Anybody in the department may read the card's
-- log (that is what makes an estimate believable), but only its author may write or amend one --
-- neither a colleague nor the head may put hours in somebody else's name.
drop policy if exists card_time_logs_write on app.card_time_logs;
create policy card_time_logs_write on app.card_time_logs for all
  using (
    department_id = app.current_department_id()
    and user_id = app.current_user_id()
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and user_id = app.current_user_id()
    and not app.is_view_as()
  );

-- A reminder is private: "remind me at 09:00" is not a fact the department needs. Owner-only on
-- both sides, so not even the head sees another person's reminders (the same boundary I-1 draws
-- around the personal workspace, applied to the one personal thing that lives on a shared card).
alter table app.card_reminders enable row level security;
alter table app.card_reminders force row level security;
drop policy if exists card_reminders_read on app.card_reminders;
create policy card_reminders_read on app.card_reminders for select
  using (department_id = app.current_department_id() and user_id = app.current_user_id());
drop policy if exists card_reminders_write on app.card_reminders;
create policy card_reminders_write on app.card_reminders for all
  using (
    department_id = app.current_department_id()
    and user_id = app.current_user_id()
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and user_id = app.current_user_id()
    and not app.is_view_as()
  );

-- A department template is everyone's; a personal one is its owner's. Same split `saved_views`
-- already models with `shared`.
alter table app.work_templates enable row level security;
alter table app.work_templates force row level security;
drop policy if exists work_templates_read on app.work_templates;
create policy work_templates_read on app.work_templates for select
  using (
    department_id = app.current_department_id()
    and (scope = 'department' or owner_user_id = app.current_user_id())
  );
-- A head curates the department gallery; everyone owns their own personal templates. Expressed as
-- a plain column comparison against `app.current_department_role()` (migration 0904), never a
-- sub-select into `app.memberships`.
drop policy if exists work_templates_write on app.work_templates;
create policy work_templates_write on app.work_templates for all
  using (
    department_id = app.current_department_id()
    and (owner_user_id = app.current_user_id() or app.current_department_role() = 'head')
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and (owner_user_id = app.current_user_id() or app.current_department_role() = 'head')
    and not app.is_view_as()
  );

-- A focus list is opt-in to the head (SPEC §7 A9, default off), and that opt-in is a *product*
-- decision the API applies when it builds the response -- the database boundary stays owner-only,
-- so a bug in that toggle can never expose one.
alter table app.focus_pins enable row level security;
alter table app.focus_pins force row level security;
drop policy if exists focus_pins_read on app.focus_pins;
create policy focus_pins_read on app.focus_pins for select
  using (department_id = app.current_department_id() and user_id = app.current_user_id());
drop policy if exists focus_pins_write on app.focus_pins;
create policy focus_pins_write on app.focus_pins for all
  using (
    department_id = app.current_department_id()
    and user_id = app.current_user_id()
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and user_id = app.current_user_id()
    and not app.is_view_as()
  );

-- Capacity is department-readable (the workload grid is the head's, but a member sees their own row
-- and the numbers behind "Mening yuklamam" on Home), and writable by its owner or the head.
alter table app.work_capacity enable row level security;
alter table app.work_capacity force row level security;
drop policy if exists work_capacity_read on app.work_capacity;
create policy work_capacity_read on app.work_capacity for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
drop policy if exists work_capacity_write on app.work_capacity;
create policy work_capacity_write on app.work_capacity for all
  using (
    department_id = app.current_department_id()
    and (user_id = app.current_user_id() or app.current_department_role() = 'head')
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and (user_id = app.current_user_id() or app.current_department_role() = 'head')
    and not app.is_view_as()
  );

-- Goals are head-only on both sides at the database boundary too, not just in `can()`: a goal is
-- management data (SPEC §2.2 puts `goals.read` on `department_managed`).
alter table app.goals enable row level security;
alter table app.goals force row level security;
drop policy if exists goals_read on app.goals;
create policy goals_read on app.goals for select
  using (
    department_id = app.current_department_id()
    and (app.current_department_role() = 'head' or app.current_actor_role() = 'super_admin')
  );
drop policy if exists goals_write on app.goals;
create policy goals_write on app.goals for all
  using (
    department_id = app.current_department_id()
    and app.current_department_role() = 'head'
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and app.current_department_role() = 'head'
    and not app.is_view_as()
  );

reset role;
