-- EPIC-003 Structure: bo'limlar (units) with unlimited nesting, unit roles (self-assignable),
-- department-scoped like every other `department_owned` table (MODULE-GUIDE.md, ADR-002).
-- Expand-only (I-15). Idempotent: `create table if not exists`, `create index if not exists`,
-- `do $$ ... exception when duplicate_object then null; end $$` for the enum.
set role devon_migrator;

do $$ begin
  create type app.unit_role as enum ('head', 'deputy', 'member');
exception when duplicate_object then null;
end $$;

-- Unlimited nesting via a materialised path (design.md §3.1 says "ltree or closure" -- this is the
-- closure-table-flavoured alternative: `path` is `/`-joined ancestor ids, self included, e.g.
-- `/<root-id>/<child-id>/`, maintained by the application layer, never by a trigger reading
-- `current_setting` (RLS-scoped selects inside a trigger body are exactly the staleness risk
-- 0005_rls.sql's header warns about for policies; this path is plain data, not a security boundary,
-- so it is simpler and safer to keep it in `src/modules/structure/repo.ts`, one transaction, same as
-- the row it describes). A leading-anchor pattern index makes "every descendant of X"
-- (`path like '/X/%'`) and "every ancestor of X" cheap without the `ltree` extension.
create table if not exists app.units (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  parent_unit_id uuid references app.units (id),
  name text not null,
  -- One of `@devon/ui`'s 8 categorical unit hues (`packages/ui/src/styles/tokens.css`'s
  -- `--color-unit-1..8`, DESIGN.md §2.1) -- tokens only (CLAUDE.md), never a raw colour value. `null`
  -- means "auto": the client derives a stable hue from the unit's own id
  -- (`@devon/ui`'s `unitHueClass`), so an unset colour still renders consistently everywhere without
  -- ever needing a lookup table; setting one here overrides that default.
  colour smallint check (colour between 1 and 8),
  sort integer not null default 0,
  path text not null default '',
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists units_department_id_idx on app.units (department_id);
create index if not exists units_parent_unit_id_idx on app.units (parent_unit_id);
create index if not exists units_path_idx on app.units (path text_pattern_ops);

alter table app.units enable row level security;
alter table app.units force row level security;

drop policy if exists units_scope on app.units;
create policy units_scope on app.units for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

-- `department_id` is denormalised onto every row (CLAUDE.md "Every department table has
-- department_id and an RLS policy") even though design.md's own column list for `unit_roles` omits
-- it -- without it this table could not carry the same `department_owned` RLS shape as every sibling
-- table, and a per-row join back through `units` to find the department would be exactly the
-- subquery-in-policy risk 0005_rls.sql's header avoids.
create table if not exists app.unit_roles (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  unit_id uuid not null references app.units (id),
  user_id uuid not null references app.users (id),
  role app.unit_role not null default 'member',
  assigned_by uuid not null references app.users (id),
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

-- One active unit assignment per person per department (design.md §2.3: a member self-assigns to
-- *a* unit and *a* role, singular) -- self-assigning to a different unit replaces the row rather than
-- adding a second one, so "grouped by unit" on the People page never has to pick a "primary" unit
-- out of several.
create unique index if not exists unit_roles_department_user_key
  on app.unit_roles (department_id, user_id) where deleted_at is null;
create index if not exists unit_roles_unit_id_idx on app.unit_roles (unit_id) where deleted_at is null;
create index if not exists unit_roles_department_id_idx on app.unit_roles (department_id);

alter table app.unit_roles enable row level security;
alter table app.unit_roles force row level security;

drop policy if exists unit_roles_scope on app.unit_roles;
create policy unit_roles_scope on app.unit_roles for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

-- Bootstrap problem (documented in full in this item's report to the human): `app.memberships`'s and
-- `app.departments`' existing `_read` policies (0005_rls.sql) both require `app.department_id` to
-- already be set to the very department being asked about -- correct for every department-scoped
-- read once a request is *inside* a department, but it leaves no way for a signed-in user to ever
-- discover *which* department(s) they belong to in the first place (the same gap `apps/api/src/lib/
-- actor.ts`'s "EPIC-002 populates this" comment names, and `apps/api/src/modules/me/index.ts`'s
-- hard-coded `memberships: []`). EPIC-002 (accounts/departments, prefix 0100) owns fixing `/me`
-- itself; structure needs the underlying membership list *today* (to resolve "my department" for the
-- People/Structure screens, and to populate `Actor.memberships` so `can()`'s `department_child` check
-- -- which every route below relies on -- is not permanently `not_a_member` for every real request).
-- These two policies are purely additive (a new, separate, permissive policy; Postgres ORs multiple
-- permissive policies for the same command together, so nothing existing is loosened or replaced) and
-- self-scoped only: a row is visible under it if and only if it is the requesting user's own
-- membership, or a department that membership belongs to. No subquery risk of the kind 0005_rls.sql's
-- header warns about (that risk is a *write* policy referencing another table's current state, not a
-- plain self-scoped read).
drop policy if exists memberships_self_read on app.memberships;
create policy memberships_self_read on app.memberships for select
  using (user_id = app.current_user_id());

drop policy if exists departments_self_read on app.departments;
create policy departments_self_read on app.departments for select
  using (
    exists (
      select 1 from app.memberships m
      where m.department_id = departments.id
        and m.user_id = app.current_user_id()
        and m.status = 'active'
    )
  );

reset role;
