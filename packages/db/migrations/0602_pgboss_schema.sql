-- pg-boss schema (TECH-SPEC §6 "jobs (pg-boss)"; MODULE-GUIDE.md reserved prefix 0600 -- notifications).
-- Expand-only (I-15). Idempotent: `create schema if not exists`; grants are naturally idempotent.
--
-- Pre-creates the `pgboss` schema, owned by `devon_migrator` like every other schema in this database
-- (0000_extensions.sql's `app`/`audit`), and gives `devon_app` USAGE + CREATE on it. Superseded by
-- 0603_pgboss_database_create.sql -- see that file for why schema-level CREATE alone is not enough for
-- pg-boss to self-provision its tables, and left unedited here per "never edit an applied migration"
-- once a database has recorded this file as applied.
create schema if not exists pgboss;
alter schema pgboss owner to devon_migrator;

set role devon_migrator;
grant usage, create on schema pgboss to devon_app;
reset role;
