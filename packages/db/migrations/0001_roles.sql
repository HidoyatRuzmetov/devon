-- Expand-only (I-15). Idempotent: `do $$ ... if not exists ... $$` for roles; grants/ownership are
-- naturally idempotent (re-applying the same grant or owner assignment does not error).
--
-- `${POSTGRES_MIGRATOR_PASSWORD}` / `${POSTGRES_APP_PASSWORD}` are substituted from the environment by
-- the migration harness before this file is sent to Postgres (see test/harness.ts). No literal secret
-- is ever committed here (I-17); `check-secrets.mjs` allows the dollar-brace variable form used above.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'devon_migrator') then
    create role devon_migrator with login password '${POSTGRES_MIGRATOR_PASSWORD}';
  else
    execute format('alter role devon_migrator with password %L', '${POSTGRES_MIGRATOR_PASSWORD}');
  end if;

  if not exists (select 1 from pg_roles where rolname = 'devon_app') then
    create role devon_app with login password '${POSTGRES_APP_PASSWORD}';
  else
    execute format('alter role devon_app with password %L', '${POSTGRES_APP_PASSWORD}');
  end if;
end
$$;

-- `devon_migrator` owns everything it creates from here on (design §2.4: the app role must never be
-- the table owner, or `FORCE ROW LEVEL SECURITY` would not bind it). Every migration from 0002 onward
-- opens with `set role devon_migrator;` and closes with `reset role;`.
grant usage, create on schema app to devon_migrator;
grant usage, create on schema audit to devon_migrator;
alter schema app owner to devon_migrator;
alter schema audit owner to devon_migrator;

grant usage on schema app to devon_app;

-- Future tables created by devon_migrator in `app` grant DML to devon_app automatically. Deliberately
-- scoped `for role devon_migrator` and to schema `app` only -- `audit` gets its own, narrower grants in
-- 0002 (INSERT, SELECT only; I-5a), never a blanket default.
alter default privileges for role devon_migrator in schema app
  grant select, insert, update, delete on tables to devon_app;
alter default privileges for role devon_migrator in schema app
  grant usage, select on sequences to devon_app;
