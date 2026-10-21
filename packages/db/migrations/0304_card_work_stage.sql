set role devon_migrator;
alter table app.cards add column if not exists work_stage text not null default 'todo'
  check (work_stage in ('todo', 'in_progress'));
reset role;
