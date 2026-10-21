set role devon_migrator;
alter table app.users add column if not exists professional_profile jsonb not null default '{}'::jsonb;
alter table app.users add column if not exists professional_profile_version integer not null default 1;
reset role;
