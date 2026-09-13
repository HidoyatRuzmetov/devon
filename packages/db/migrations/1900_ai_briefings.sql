-- The head's AI briefing, cached per department per day (v1.1 recapture report §1a #23).
--
-- Why this table exists. `catch_up` at `scope: 'department'` is the most expensive call this product
-- makes: measured against the ministry's GLM deployment it took 78.8 s, 112 s and 276 s on the same
-- instance in one afternoon. It was run synchronously from the head's dashboard tile, and the fix
-- round put a 75 s budget on it -- below the feature's own floor -- which turned a slow success into
-- a guaranteed failure: "AI did not answer in time. Try again.", every time.
--
-- Neither number is the answer. A reasoning model that thinks for four minutes cannot be waited on
-- by a browser at all: no budget makes that a good experience, and a longer one only makes the
-- spinner longer. So the briefing stops being a request and becomes a *result*: a pg-boss job
-- computes it (server-side timeout up to 300 s, retries with backoff), writes exactly one row per
-- department per Tashkent day here, and the tile reads this row. A head opening Home sees last
-- night's briefing immediately, with the time it was generated; "Yangilash" enqueues a new run and
-- the tile says `tayyorlanmoqda` until it lands.
--
-- Expand-only (I-15), idempotent, department-owned with `department_id` and RLS like every other
-- department table (I-1). `output` holds the same validated `catch_up` payload the synchronous path
-- returned -- including its citations, which the grounding validator still checks before this row is
-- written; nothing here is model text that has not been through that gate.
set role devon_migrator;

create table if not exists app.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  -- The Tashkent calendar day the briefing is *about*, `YYYY-MM-DD`, the same key
  -- `analytics_daily` uses. One briefing per department per day: a second refresh on the same day
  -- replaces the row rather than accumulating history nobody reads.
  day date not null,
  locale text not null default 'uz-Latn',
  -- 'queued'   -- a job is enqueued and has not started
  -- 'running'  -- a worker picked it up
  -- 'ready'    -- `output` holds a validated briefing
  -- 'failed'   -- every retry is spent; `error` says why, and the tile offers Yangilash again
  -- Text, not an enum: this set is the job lifecycle, and the API maps it to one of four words in
  -- four locales. An enum would make adding a state a migration for no gain in the database.
  status text not null default 'queued',
  -- The validated `catch_up` output, exactly as `@devon/ai`'s `runFeature()` returned it (headline,
  -- wins, risks, overloaded, lookingAhead, citations). Null until the first successful run.
  output jsonb,
  -- What the tile prints beside the briefing so a head can see how old it is. Set only when
  -- `status` becomes 'ready', so it can never describe a run that failed.
  generated_at timestamptz,
  -- The retryable message from the last failure, for the tile's error state. Cleared on success.
  error text,
  -- Milliseconds the successful run took, so /admin's AI console can show what the briefing costs
  -- in time as well as in soʻm without joining `ai_traces`.
  latency_ms integer,
  -- Who asked for this run: a user id for a Yangilash, null for the nightly precompute. Deliberately
  -- nullable and deliberately not a foreign key at `app.users`: the row outlives the account (a head
  -- can leave), and a briefing is department data, not a fact about a person (I-2).
  requested_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_briefings_department_day_key
  on app.ai_briefings (department_id, day);

-- The tile's own query: the newest briefing for this department, whatever day it is about.
create index if not exists ai_briefings_department_recent_idx
  on app.ai_briefings (department_id, day desc);

alter table app.ai_briefings enable row level security;
alter table app.ai_briefings force row level security;

-- Read is department-wide at the database boundary; the *route* is head-only (`can()` with
-- `{kind:'department_managed'}`), which is where I-6 says authorisation belongs. Keeping the policy
-- at department scope means the super admin's audited view-as and the department's own background
-- jobs can both read it without a carve-out per caller.
drop policy if exists ai_briefings_read on app.ai_briefings;
create policy ai_briefings_read on app.ai_briefings for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');

-- Written by the briefing job inside its own transaction, never by a person typing -- the same shape
-- and the same reasoning as `ai_search_documents_write` (0810) and `card_activity_write` (0302). A
-- view-as session may not write: an impersonated session must not be able to spend the department's
-- AI budget or change what its head reads tomorrow.
drop policy if exists ai_briefings_write on app.ai_briefings;
create policy ai_briefings_write on app.ai_briefings for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

reset role;
