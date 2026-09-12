-- EPIC-017 / v1.1 SPEC §7 -- automations: the head's rule builder and its run log. Expand-only
-- (I-15), idempotent, department-owned with RLS, registered in `packages/db/src/tenancy.ts`.
--
-- Two tables and no more. A rule is one trigger, a small typed config and up to five actions, all
-- validated by `automationRuleBodySchema` (`packages/contracts/src/work-plus.ts`) at the API
-- boundary rather than by database constraints -- a jsonb check constraint would have to be
-- rewritten by a contract migration every time the product grows an action, which is exactly the
-- kind of change I-15 makes expensive.
--
-- The run log is the reason automations are usable at all rather than frightening: CLICKUP-RESEARCH
-- §7.3's own finding is that people turn automations off because they cannot see what they did.
-- Every evaluation writes a row -- applied, skipped (with the reason) or failed -- and the head's
-- screen is that table, newest first, with a kill switch above it.
--
-- No column here matches the I-2 personal-data pattern.
set role devon_migrator;

do $$ begin
  create type app.automation_trigger as enum (
    'card_created',
    'card_status_changed',
    'card_assigned',
    'card_due_soon',
    'card_overdue',
    'card_field_changed'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.automation_run_status as enum ('applied', 'skipped', 'failed');
exception when duplicate_object then null;
end $$;

create table if not exists app.automation_rules (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  name text not null,
  trigger app.automation_trigger not null,
  trigger_config jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  run_count integer not null default 0,
  last_run_at timestamptz,
  last_error text,
  created_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

-- The engine's own lookup: "every enabled rule in this department for this trigger", in one indexed
-- pass per event rather than a scan plus a filter in JavaScript (I-14).
create index if not exists automation_rules_trigger_idx
  on app.automation_rules (department_id, trigger) where enabled = true and deleted_at is null;
create index if not exists automation_rules_department_idx
  on app.automation_rules (department_id) where deleted_at is null;

create table if not exists app.automation_runs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  rule_id uuid not null references app.automation_rules (id),
  card_id uuid references app.cards (id),
  status app.automation_run_status not null,
  -- `{ actions: [...], reason: 'filter_did_not_match' | 'chain_depth' | ..., error: '...' }` -- the
  -- run log's own sentence, rendered in four locales by the client from the machine-readable reason
  -- rather than stored as prose in one language.
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists automation_runs_recent_idx
  on app.automation_runs (department_id, at desc);
create index if not exists automation_runs_rule_idx
  on app.automation_runs (rule_id, at desc);

alter table app.automation_rules enable row level security;
alter table app.automation_rules force row level security;
-- Head-only on both sides at the database boundary, matching `automations.read` /
-- `automations.manage` in the action registry (both `department_managed`). A member never learns
-- that a rule exists; they only ever see its effect, which is a card that was assigned or labelled.
drop policy if exists automation_rules_read on app.automation_rules;
-- The `super_admin` branch is unscoped on purpose, exactly like `cards_read` in 0302: it is what
-- lets the hourly time-trigger tick ask "which departments have a due-soon rule at all" in one
-- query, and what lets the admin console's own instance lens work. No route exposes it -- every
-- automations route is `{kind:'department_managed'}`, which `can()` denies to a super admin outside
-- a matching view-as, and denies for every non-read action even inside one.
create policy automation_rules_read on app.automation_rules for select
  using (
    (department_id = app.current_department_id() and app.current_department_role() = 'head')
    or app.current_actor_role() = 'super_admin'
  );
drop policy if exists automation_rules_write on app.automation_rules;
create policy automation_rules_write on app.automation_rules for all
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

alter table app.automation_runs enable row level security;
alter table app.automation_runs force row level security;
drop policy if exists automation_runs_read on app.automation_runs;
create policy automation_runs_read on app.automation_runs for select
  using (
    (department_id = app.current_department_id() and app.current_department_role() = 'head')
    or app.current_actor_role() = 'super_admin'
  );
-- The engine writes a run row in the same transaction as the card write that triggered it, acting
-- as the person whose action fired the rule -- who is usually a member, not the head. So the write
-- policy is department-scoped rather than head-only: a run row records what the system did, not
-- what its author decided, and the read policy above still keeps it out of a member's sight.
drop policy if exists automation_runs_write on app.automation_runs;
create policy automation_runs_write on app.automation_runs for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

reset role;
