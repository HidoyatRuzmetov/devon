set role devon_migrator;
-- Operational roster: only Telegram identities observed in an explicitly connected group.
create table app.telegram_group_members (
  group_id uuid not null references app.telegram_groups(id) on delete cascade,
  telegram_user_id bigint not null,
  first_name text not null,last_name text,username text,
  seen_at timestamptz not null default now(),
  primary key(group_id,telegram_user_id)
);
-- A message can notify its group only once, including after process restart or webhook replay.
-- No message body is retained here.
create table app.telegram_group_mentions (
  group_id uuid not null references app.telegram_groups(id) on delete cascade,
  message_id bigint not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,status text not null default 'sending' check(status in ('sending','sent','failed')),
  recipients integer not null default 0,
  primary key(group_id,message_id)
);
reset role;
