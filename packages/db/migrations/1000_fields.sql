-- Custom fields (v1.1 SPEC §5): department-defined columns on people and on cards, the values people
-- fill in, and the head's "notify to fill" requests. Expand-only (I-15), idempotent by the same
-- conventions every migration before it uses: `create table if not exists`, `create index if not
-- exists`, `drop policy if exists` then `create policy`.
--
-- Three tables, all `department_owned` (`packages/db/src/tenancy.ts`): a field definition belongs to
-- one boshqarma, a value belongs to one subject inside it, a request is one head asking one colleague.
--
-- Two deliberate denormalisations, both so RLS can be written without a sub-select (every policy in
-- this codebase compares columns on the row being checked against the `app.current_*` GUCs, and
-- nothing else -- see `0904_department_role_guc.sql`'s header):
--
--   1. `field_values.head_only` copies `field_defs.visible_to = 'head_only'`. A member must never be
--      able to SELECT a colleague's head-only answer, and the policy has to decide that from the
--      value row alone. `apps/api/src/modules/fields/repo.ts` keeps the copy in step whenever a
--      definition's visibility changes -- in the same transaction, so the two cannot drift.
--   2. `field_values.subject_user_id` carries the *user* a person value is about, alongside
--      `subject_id`, which is the **membership** id (SPEC §5: a person value is department-scoped and
--      is stored against the membership, never against the global user row). The user id is what a
--      "may I see my own answer?" policy needs; the membership id is what the model says the value
--      hangs off. `null` for card values.
--
-- No column here names data this product refuses to hold (I-2). The blocklist is additionally enforced
-- on the *labels a head types*, in all four locales and both Uzbek scripts, by
-- `packages/contracts/src/custom-fields.ts`'s `isBlockedFieldLabel`.
set role devon_migrator;

-- ---------------------------------------------------------------------------------------------
-- Definitions
-- ---------------------------------------------------------------------------------------------

create table if not exists app.field_defs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  applies_to text not null check (applies_to in ('card', 'person')),
  key text not null,
  label jsonb not null default '{}'::jsonb,
  description jsonb,
  type text not null check (
    type in (
      'text', 'long_text', 'number', 'date', 'select',
      'multi_select', 'person', 'url', 'checkbox', 'derived'
    )
  ),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  default_value jsonb,
  show_in_table boolean not null default true,
  show_on_card_tile boolean not null default false,
  self_editable boolean not null default true,
  visible_to text not null default 'everyone' check (visible_to in ('everyone', 'head_only')),
  sort integer not null default 0,
  reminder_days integer not null default 3 check (reminder_days between 1 and 30),
  created_by_user_id uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1
);

create index if not exists field_defs_department_idx
  on app.field_defs (department_id, applies_to, sort);

-- A key is unique per (department, entity) among the live ones only: archiving `talim` and later
-- creating a fresh `talim` is a normal thing for a head to do, and the archived rows keep their
-- values readable on the person page's history.
create unique index if not exists field_defs_department_key_key
  on app.field_defs (department_id, applies_to, key) where archived_at is null;

alter table app.field_defs enable row level security;
alter table app.field_defs force row level security;

-- Read: any active member of the department. A *definition* is not sensitive -- knowing the boshqarma
-- tracks "Chet tillari" is not knowing anyone's answer, and the member fill screen needs the labels,
-- the options and the required flag to render a form at all.
drop policy if exists field_defs_read on app.field_defs;
create policy field_defs_read on app.field_defs for select
  using (
    department_id = app.current_department_id()
    or app.current_actor_role() = 'super_admin'
  );

-- Write: the boshqarma boshligʻi only (`app.current_department_role()`, the per-department role --
-- never `current_actor_role()`, which is `member` for every real head, I-8b).
drop policy if exists field_defs_write on app.field_defs;
create policy field_defs_write on app.field_defs for all
  using (
    department_id = app.current_department_id()
    and (
      app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
    )
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and (
      app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
    )
    and not app.is_view_as()
  );

-- ---------------------------------------------------------------------------------------------
-- Values
-- ---------------------------------------------------------------------------------------------

create table if not exists app.field_values (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  def_id uuid not null references app.field_defs (id),
  subject_type text not null check (subject_type in ('card', 'person')),
  subject_id uuid not null,
  subject_user_id uuid references app.users (id),
  head_only boolean not null default false,
  value jsonb,
  updated_by_user_id uuid references app.users (id),
  updated_at timestamptz not null default now()
);

create index if not exists field_values_department_idx
  on app.field_values (department_id, subject_type, subject_id);

create index if not exists field_values_department_def_idx
  on app.field_values (department_id, def_id);

create unique index if not exists field_values_def_subject_key
  on app.field_values (def_id, subject_id);

-- SPEC §5 asks for a GIN index on the value: the filter grammar's `field:<key>:<value>` and the
-- people table's per-column filters both look answers up by content, not by id.
create index if not exists field_values_value_gin
  on app.field_values using gin (value jsonb_path_ops);

alter table app.field_values enable row level security;
alter table app.field_values force row level security;

-- Read: inside the department, and then one of three things must be true -- the value is not
-- head-only, it is the caller's own answer, or the caller is this department's head. A member reading
-- a colleague's "head_only" answer is exactly what PERMISSIONS-AUDIT §4.13 refuses.
drop policy if exists field_values_read on app.field_values;
create policy field_values_read on app.field_values for select
  using (
    app.current_actor_role() = 'super_admin'
    or (
      department_id = app.current_department_id()
      and (
        head_only = false
        or subject_user_id = app.current_user_id()
        or app.current_department_role() = 'head'
      )
    )
  );

-- Write: the head writes anything in their department; anyone may write a card value (a card is
-- department work, `department_child`); a person may write their own answer. Whether a *specific*
-- definition is self-editable is a product rule, enforced in `apps/api/src/modules/fields/service.ts`
-- on top of this boundary, not instead of it.
drop policy if exists field_values_write on app.field_values;
create policy field_values_write on app.field_values for all
  using (
    department_id = app.current_department_id()
    and (
      app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
      or subject_type = 'card'
      or subject_user_id = app.current_user_id()
    )
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and (
      app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
      or subject_type = 'card'
      or subject_user_id = app.current_user_id()
    )
    and not app.is_view_as()
  );

-- ---------------------------------------------------------------------------------------------
-- Fill requests ("notify to fill")
-- ---------------------------------------------------------------------------------------------

create table if not exists app.field_requests (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  def_id uuid not null references app.field_defs (id),
  user_id uuid not null references app.users (id),
  requested_by_user_id uuid not null references app.users (id),
  requested_at timestamptz not null default now(),
  reminded_at timestamptz,
  resolved_at timestamptz
);

create index if not exists field_requests_department_idx
  on app.field_requests (department_id, def_id);

create index if not exists field_requests_user_idx
  on app.field_requests (department_id, user_id) where resolved_at is null;

-- One open request per (definition, person): asking twice is a nudge, not a second row.
create unique index if not exists field_requests_open_key
  on app.field_requests (def_id, user_id) where resolved_at is null;

alter table app.field_requests enable row level security;
alter table app.field_requests force row level security;

drop policy if exists field_requests_read on app.field_requests;
create policy field_requests_read on app.field_requests for select
  using (
    app.current_actor_role() = 'super_admin'
    or (
      department_id = app.current_department_id()
      and (
        user_id = app.current_user_id()
        or app.current_department_role() = 'head'
      )
    )
  );

-- The head creates and nudges; the person being asked resolves their own row by answering.
drop policy if exists field_requests_write on app.field_requests;
create policy field_requests_write on app.field_requests for all
  using (
    department_id = app.current_department_id()
    and (
      user_id = app.current_user_id()
      or app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
    )
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and (
      user_id = app.current_user_id()
      or app.current_department_role() = 'head'
      or app.current_actor_role() = 'super_admin'
    )
    and not app.is_view_as()
  );

-- ---------------------------------------------------------------------------------------------
-- The inbox reason a fill request lands under (SPEC §5, §11).
-- ---------------------------------------------------------------------------------------------

-- Plain statement, deliberately not wrapped in `do $$ ... $$`: Postgres refuses
-- `ALTER TYPE ... ADD VALUE` inside a function body. `if not exists` is what makes it idempotent,
-- and since v12 it is legal inside a transaction block as long as the new label is not *used* before
-- that transaction commits -- which it is not: the first row carrying it is written by a running API,
-- long after this file has committed.
alter type app.notification_reason add value if not exists 'field_request';

reset role;
