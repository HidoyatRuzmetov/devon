# Escalation: memberships-self-read-vs-I-1

- **Date:** 2026-09-06
- **Raised by:** integration session merging `blitz/accounts-departments`, `blitz/structure`,
  `blitz/work`, `blitz/events`, `blitz/personal`, `blitz/inbox-telegram` into `master`
- **Kind:** contradiction
- **Status:** ANSWERED

## The one question

`EPIC-002` (accounts-departments) and `EPIC-003` (structure) each independently added an additive
Postgres RLS policy on `app.memberships` (`memberships_read_own`, `memberships_self_read` --
`packages/db/migrations/0100_accounts_departments.sql`, `0200_structure.sql`) that permits `select
... where user_id = app.current_user_id()`, with **no department_id condition at all** -- needed so
a signed-in user can list every department they belong to (`GET /me`, `Actor.memberships`,
`buildActor()` in `apps/api/src/lib/actor.ts`, `apps/api/src/db/repo.ts`'s
`listActiveMembershipsForUser`) before any per-request department context exists to scope by. Is this
narrow, reviewed, user-scoped-only (never another user's row) carve-out an acceptable reading of
**I-1** ("every row of department-owned data carries `department_id`, and every query is scoped by
it"), or does I-1 need a literal, no-exceptions read that requires a different implementation (e.g. a
`SECURITY DEFINER` function, or reclassifying this one read path some other way)?

## Default we are proceeding with

Kept the shipped policies (removing them would revert working, already-gated functionality across
four merged modules: `GET /me`, every `{kind:'department_child'}` permission check across
`structure`/`work`/`events`, and `structure`'s People/org-chart screens all depend on
`Actor.memberships` actually being populated). Updated the one RLS integration check that encoded the
older, stricter assumption
(`packages/db/test/checks/rls.ts`'s `'unset department context returns zero rows, never all rows
(default-deny)'`) to assert the invariant that is actually still true and load-bearing: with
department context unset, `app.memberships` returns **only the calling user's own row(s), never
another user's** -- i.e. the self-read carve-out never crosses users, even though it does cross
departments for that one user. Every other department-owned table (`app.departments`, `app.cards`,
`app.events`, etc.) is untouched and still strictly zero-rows-with-no-department-context, per
`migrate:verify`'s `[rls.isolation]` and `[rls.tenancy]` sections (388/389 checks pass; the one
changed check is this one, now asserting the narrower-but-real guarantee).

This is safe and reversible: if the answer is "no, I-1 needs a literal read", the fix is contained to
`listActiveMembershipsForUser`'s implementation (`apps/api/src/db/repo.ts`) and the two migrations'
policies -- nothing in the four already-merged modules' own route/table/seed code needs to change,
only how that one read is authorized.

## Evidence

- `packages/db/migrations/0100_accounts_departments.sql:18-27` (`memberships_read_own`, with its own
  justification comment).
- `packages/db/migrations/0200_structure.sql:99-105` (`memberships_self_read`, independently added,
  identical shape, identical justification).
- `apps/api/src/db/repo.ts`'s `listActiveMembershipsForUser` (`selfCtx(userId)`: only `app.user_id`
  set, `app.department_id` left `null` -- by construction, since resolving "which departments am I
  in" is what establishes department context, not something that can already have it).
- `pnpm --filter @devon/db migrate:verify` before this fix:
  `[rls.isolation] FAIL unset department context returns zero rows, never all rows (default-deny)
  (rows=1)` -- 388/389 checks passed, this the only failure.
- `agentic/INVARIANTS.md:8`: "I-1 Every row of department-owned data carries `department_id`, and
  every query is scoped by it through Postgres row-level security ... and the repository layer."
  (file is hook-protected; this session did not and will not edit it).

## What changes if the answer is different

- If the carve-out is **accepted** (I-1 read as "no query bypasses department scoping to read another
  department's or another user's rows", not "every single query must additionally condition on
  department_id") → no further code change; consider recording it as an ADR so the next module author
  does not have to re-derive this reasoning.
- If I-1 needs a **literal** read → move `listActiveMembershipsForUser`'s query behind a `security
  definer` Postgres function (bypasses RLS deliberately and only for this one, already-authorized-by-
  `userId`-parameter read) instead of an RLS policy, drop `memberships_read_own`/
  `memberships_self_read`, and restore the original `'... returns zero rows ...'` check.

## Answer (filled by the human, or by wp-pm after a chat reply)

<open>


## Answer

2026-09-06 (CTO session): **Accepted.** The user-scoped self-read of one's own membership rows is the
correct reading; it is now written into INVARIANTS.md as I-1a. Keep the shipped policies and the narrowed
RLS check. No other table may get a self-read carve-out.

## Follow-up (2026-09-06, gate hardening after the answer)

- `migrate:verify` now proves the narrowed invariant rather than asserting it in prose: with no
  department context, every `department_owned` table other than `app.memberships` returns zero rows to
  a signed-in member (swept from the `TENANCY` registry, seeded rows on `app.units` and `app.cards` so
  the sweep is non-vacuous), a stranger with no memberships sees zero rows of `app.memberships` and
  `app.departments`, and no `department_owned`/`tenant_root` table carries a policy that keys on
  `current_user_id()` without `current_department_id()` beyond the allowlisted I-1a policies
  (`packages/db/test/checks/rls.ts`, `packages/db/test/checks/tenancy.ts`).
- **Wording gap to close in I-1a.** `0200_structure.sql` also ships `departments_self_read` on
  `app.departments` (`tenant_root`): a department row is readable with no context iff one of the
  caller's own *active* memberships points at it. It is load-bearing (`listActiveMembershipsForUser`
  joins `app.departments` for `GET /me`'s department names) and never exposes another department, so
  the gate treats it as the same carve-out one join away. I-1a's sentence "no other table gets a
  self-read carve-out" does not mention it; `agentic/INVARIANTS.md` should either name
  `app.departments` (own active departments only) alongside `memberships`, or the policy should be
  replaced. The gate encodes the former; the decision is the CTO's.
