-- AI module (TECH-SPEC §8, MODULE-GUIDE.md "0800 ai"). Expand-only (I-15); idempotent per the same
-- conventions as every prior migration: `create type` guarded by `do $$ ... exception when
-- duplicate_object then null; end $$;`, `create table/index if not exists`, `drop policy if exists`
-- then `create policy`.
--
-- No column here matches birth/dob/passport/pinfl/inn/address/salary/nationality/religio (I-2). No
-- column here ever carries prompt/response text either -- `app.ai_traces` is metering only (tokens,
-- cost, latency, status); see `packages/db/src/schema/ai.ts`'s header for why that is a deliberate
-- privacy guard rail this module adds on top of TECH-SPEC §8's own "reasoning_content never stored".
set role devon_migrator;

do $$ begin
  create type app.ai_trace_status as enum (
    'ok',
    'empty_after_retry',
    'schema_invalid_after_retry',
    'provider_error',
    'blocked_budget',
    'blocked_flag'
  );
exception when duplicate_object then null;
end $$;

create table if not exists app.ai_department_settings (
  department_id uuid primary key references app.departments (id),
  budget_uzs_per_month integer not null default 0,
  soft_cap_pct integer not null default 80,
  flags jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.ai_traces (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  user_id uuid not null references app.users (id),
  feature text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_uzs integer not null default 0,
  latency_ms integer not null default 0,
  retried boolean not null default false,
  status app.ai_trace_status not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_traces_department_created_idx
  on app.ai_traces (department_id, created_at desc);
create index if not exists ai_traces_department_feature_idx
  on app.ai_traces (department_id, feature);

alter table app.ai_department_settings enable row level security;
alter table app.ai_department_settings force row level security;
drop policy if exists ai_department_settings_read on app.ai_department_settings;
create policy ai_department_settings_read on app.ai_department_settings for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
-- Only a head may change budget/flags (enforced again in the API layer's `can()` check via
-- `{kind:'department'}`'s update-requires-head rule); the RLS write policy still needs `for all` so
-- `insert`/`update` are permitted at all under `force row level security`.
drop policy if exists ai_department_settings_write on app.ai_department_settings;
create policy ai_department_settings_write on app.ai_department_settings for all
  using (
    department_id = app.current_department_id()
    and app.current_actor_role() in ('head', 'super_admin')
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and app.current_actor_role() in ('head', 'super_admin')
    and not app.is_view_as()
  );

alter table app.ai_traces enable row level security;
alter table app.ai_traces force row level security;
drop policy if exists ai_traces_read on app.ai_traces;
create policy ai_traces_read on app.ai_traces for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');
-- Traces are append-only from the API's point of view (no PATCH/DELETE route exists), but the write
-- policy still needs `for all` so `insert` is permitted at all under `force row level security` --
-- same reasoning `0302_work_rls.sql` gives for `card_activity_write`.
drop policy if exists ai_traces_write on app.ai_traces;
create policy ai_traces_write on app.ai_traces for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

reset role;
