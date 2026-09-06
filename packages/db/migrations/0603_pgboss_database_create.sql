-- pg-boss database privilege (TECH-SPEC §6 "jobs (pg-boss): reminders, digests, AI jobs, scans,
-- thumbnails, audit anchor, retention"; MODULE-GUIDE.md reserved prefix 0600 -- notifications).
-- Expand-only (I-15). Idempotent: `grant` is naturally idempotent (re-applying does not error).
--
-- pg-boss (apps/api/src/modules/notifications/jobs.ts, `new PgBoss(databaseUrl)`) connects as
-- `devon_app` and self-provisions its own `pgboss` schema/tables/types/functions on `boss.start()`,
-- and again on every future pg-boss version bump whose schema version is newer than what is installed
-- (`Contractor.start()` -> `create()`/`migrate()`). That is pg-boss's documented deployment contract:
-- the role it connects as must be able to manage its own schema, because there is no separate
-- "pg-boss migrator" role/step in this stack the way `devon_migrator` is for `app`/`audit`.
--
-- 0602_pgboss_schema.sql's schema-level `USAGE, CREATE` grant was not enough: confirmed by running
-- this stack, `devon_app`'s own `CREATE SCHEMA IF NOT EXISTS pgboss` (issued by pg-boss itself, not by
-- us) still raised "permission denied for database <name>" even with the schema pre-created and
-- schema-level CREATE granted -- Postgres checks database-level CREATE privilege for that statement
-- unconditionally, before it checks whether the schema already exists. Least-privilege alternative
-- considered: embed pg-boss's own construction SQL
-- (`import('pg-boss').then(m => m.getConstructionPlans('pgboss'))`) into a devon_migrator-owned
-- migration and grant only DML. Rejected -- it would silently drift out of idempotence on every future
-- pg-boss dependency bump (a new schema version needs its own migration SQL pulled the same way), and
-- `pgboss.*` holds no tenant data and no RLS surface (I-1/I-5 govern the `app` schema's tenant tables;
-- this is job-queue plumbing only), so the narrower fix's ongoing cost is not worth it here.
--
-- `GRANT CREATE ON DATABASE` (not `ALTER ROLE ... CREATEDB`, which would let `devon_app` create whole
-- new *databases*) only lets `devon_app` create schemas inside the current database -- exactly what
-- pg-boss's self-managed schema needs and nothing more. `current_database()` via `format(%I)`, not a
-- literal database name, because `migrate:verify` (test/harness.ts) applies this same file to a
-- Testcontainers database whose name is not `devon`.
do $$
begin
  execute format('grant create on database %I to devon_app', current_database());
end
$$;
