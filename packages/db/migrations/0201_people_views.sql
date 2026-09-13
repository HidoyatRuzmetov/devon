-- Saved views for the people table (v1.1 SPEC §4.3: "Saved views as a tab strip (private + shared,
-- one department default set by the head)"). MODULE-GUIDE.md reserves the 0200 prefix for structure,
-- which is where the people surfaces live.
--
-- Expand-only (I-15), idempotent, same department-owned RLS shape as `0700_analytics_pages.sql`:
-- every policy compares a column on the row being checked against the `app.current_*` GUC functions,
-- never a sub-select against another table (`packages/db/test/unit/migration-lint.test.ts`).
--
-- Head-only by policy, not only by route: SPEC §2.2 puts the whole people table behind
-- `{kind:'department_managed'}`, so a member has no reason to read even the *name* of a view over
-- numbers they may not see. The per-department role is the check -- `app.current_actor_role()` is the
-- instance role and is 'member' for every real boshqarma boshligʻi (I-8b), so it is deliberately not
-- used here.
--
-- The role is read straight off the GUC rather than through `app.current_department_role()`, whose
-- body this expression is character for character. That helper is created by
-- `0904_department_role_guc.sql`, and migrations apply in *filename* order: 0201 runs long before
-- 0904, so on a fresh database the helper does not exist yet and `create policy` -- which resolves
-- function names at creation time -- would fail. `packages/db/src/context.ts`'s `withContext()` sets
-- `app.department_role` transaction-locally from `RequestContext.departmentRole`, the same source the
-- helper reads, so the two checks can never disagree.
set role devon_migrator;

create table if not exists app.people_views (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  owner_user_id uuid not null references app.users (id),
  name text not null,
  -- `PeopleViewConfig` from `packages/contracts/src/people-views.ts`: columns, widths, sort,
  -- filters, group-by, density, search. Validated by Zod on the way in; stored whole so a view a
  -- newer client saved still opens on an older one (unknown keys are dropped by the parser, not by
  -- the column).
  config jsonb not null default '{}'::jsonb,
  -- Visible to the department's other heads. Never to members: the table itself is head-only.
  shared boolean not null default false,
  -- The one view the department starts on. Enforced unique below.
  is_department_default boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists people_views_department_owner_idx
  on app.people_views (department_id, owner_user_id, sort) where deleted_at is null;

-- One department default, ever. A second "make this the default" clears the first in the same
-- transaction (see `apps/api/src/modules/people/views-repo.ts`), and this index is what makes that a
-- guarantee rather than an intention.
create unique index if not exists people_views_department_default_key
  on app.people_views (department_id) where is_department_default and deleted_at is null;

-- A head may not fill the table with a thousand views: the cap is enforced in the service
-- (`PEOPLE_VIEW_CAPS.maxViewsPerHead`), and this index makes counting them cheap.
create index if not exists people_views_department_shared_idx
  on app.people_views (department_id) where shared and deleted_at is null;

alter table app.people_views enable row level security;
alter table app.people_views force row level security;

drop policy if exists people_views_read on app.people_views;
create policy people_views_read on app.people_views for select
  using (
    department_id = app.current_department_id()
    and nullif(current_setting('app.department_role', true), '') = 'head'
    and (shared = true or is_department_default = true or owner_user_id = app.current_user_id())
  );

-- Writes are department-head-wide rather than owner-narrow, on purpose and with the ownership rule
-- kept one layer up: making view X the department default has to *clear* whichever view currently
-- holds the flag, and that row may belong to a different head. An owner-narrow policy would make the
-- unique index above unsatisfiable for the second head. So RLS says "a head of this department, not
-- under view-as" (no sub-select, per the migration lint), and
-- `apps/api/src/modules/people/views-repo.ts` refuses to touch another head's *private* view with a
-- 404 -- the same 404 a foreign id gets, so the two cases stay indistinguishable (H1.2).
drop policy if exists people_views_write on app.people_views;
create policy people_views_write on app.people_views for all
  using (
    department_id = app.current_department_id()
    and nullif(current_setting('app.department_role', true), '') = 'head'
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and nullif(current_setting('app.department_role', true), '') = 'head'
    and not app.is_view_as()
  );

reset role;
