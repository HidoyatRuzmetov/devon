<!-- file: docs/adr/ADR-002-tenancy-department-id.md -->
# ADR-002: Tenancy is `department_id` + Postgres RLS, with a four-class table registry

- **Date:** 2026-09-06   **Status:** accepted
- **Deciders:** wp-architect + wp-security   **Epic:** EPIC-000

## Context
`CLAUDE.md` says "every table has `tenant_id`". `agentic/INVARIANTS.md` I-1 and TECH-SPEC §3 say `department_id`. Decision 3 says there is no ministry layer: one instance = super admin + departments, and departments never see each other (I-8a). `backend-architecture-and-multitenancy.md` §4 recommends shared-schema + RLS with per-tenant deployment as the political escape valve, and §2 warns about two RLS foot-guns (sub-select races under READ COMMITTED, and global unique constraints leaking cross-tenant existence). §A8 warns that a session-scoped `SET` under PgBouncer transaction pooling leaks tenant context across requests. AC-10 requires that a table without `department_id` and a policy fails the migrate gate — which means "which tables are department-owned" must be machine-readable.

## Decision
The tenant column is **`department_id`** and there is no `tenant_id` anywhere. Per-ministry isolation is a deployment topology (one Compose stack per ministry, same schema, same policies), never a code fork. Every table is classified in `packages/db/src/tenancy.ts` as one of `tenant_root` (`app.departments`, policy on `id`), `department_owned` (`department_id not null` + RLS + a policy referencing `app.current_department_id()` + an index leading with `department_id`), `user_owned` (`user_id` + RLS + owner-only policy, with **no** role escape for head or super admin — I-1), `global` (explicitly allow-listed with a written justification), or `audit`. The migrate gate asserts that every base table in `app` and `audit` is classified and that each class's invariants hold; an unclassified table fails. Context is set with transaction-local `set_config('app.<k>', $v, true)` as the first statement of every transaction, issued only by `withContext()` in `@devon/db`; the `Pool` is not exported and the raw-query escape hatch asserts the GUCs are set. `devon_app` is **not** the table owner (`devon_migrator` is) and `FORCE ROW LEVEL SECURITY` is set anyway. Policies compare a column to a GUC and contain no sub-selects. Every uniqueness constraint on a department-owned table is scoped `(department_id, …)`. Super-admin cross-department reads go through `view_as`, which sets the same `app.department_id` and additionally sets `app.view_as=true`, which every write policy denies — there is no bypass role and no policy exemption.

## Consequences
- Positive: cross-department isolation is enforced by the database even if application code is wrong; adding a table forces an explicit tenancy decision; an unset context returns zero rows rather than everything; PgBouncer transaction pooling is safe.
- Negative / debt accepted: `global` is a real category and will be argued about; classifying `app.departments` as `tenant_root` rather than `department_owned` is a fourth concept the reader must learn; the advisory that policies contain no sub-selects will eventually be inconvenient (the escape is a `SECURITY DEFINER` helper, permitted by the migration linter only with that marker).
- Migration / rollback path: purely additive. If a future ministry demands physical separation, the answer is a second Compose stack with the same migrations, not a schema change.

## Alternatives considered
- Schema-per-department: rejected — N migrations and drift past ~30 tenants (`backend-architecture-and-multitenancy.md` §4), and this instance is expected to hold 200.
- Application-layer filtering only: rejected — one forgotten `where` leaks personal data; RLS is the backstop that survives a wrong query.
- A `tenant_id` column aliasing `department_id`: rejected — two names for one thing is exactly the confusion this ADR exists to remove.
