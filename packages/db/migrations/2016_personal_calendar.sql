set role devon_migrator;
create table app.personal_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users(id),
  title text not null check(length(title) between 1 and 160),
  notes text not null default '' check(length(notes)<=4000),
  starts_at timestamptz not null,ends_at timestamptz not null,
  all_day boolean not null default false,remind_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check(ends_at>=starts_at),check(remind_at is null or remind_at<=starts_at)
);
create index personal_calendar_owner_time on app.personal_calendar_entries(user_id,starts_at) where deleted_at is null;
alter table app.personal_calendar_entries enable row level security;
alter table app.personal_calendar_entries force row level security;
create policy personal_calendar_owner on app.personal_calendar_entries for all
  using(user_id=app.current_user_id() and not app.is_view_as())
  with check(user_id=app.current_user_id() and not app.is_view_as());

-- Scheduler pointers only. No private content or chat address is stored in this cross-owner queue.
create table app.personal_calendar_reminders (
  entry_id uuid primary key references app.personal_calendar_entries(id) on delete cascade,
  user_id uuid not null references app.users(id),fire_at timestamptz not null,
  entry_version integer not null,lease_token uuid,lease_until timestamptz,
  attempts integer not null default 0,sent_at timestamptz
);
create index personal_calendar_reminders_due on app.personal_calendar_reminders(fire_at) where sent_at is null;
create function app.schedule_personal_calendar_reminder() returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null or new.remind_at is null then
    update app.personal_calendar_reminders set sent_at=coalesce(sent_at,clock_timestamp()),
      lease_token=null,lease_until=null where entry_id=new.id;
  elsif tg_op='INSERT' or new.remind_at is distinct from old.remind_at then
    insert into app.personal_calendar_reminders(entry_id,user_id,fire_at,entry_version)
      values(new.id,new.user_id,new.remind_at,new.version)
      on conflict(entry_id) do update set fire_at=excluded.fire_at,entry_version=excluded.entry_version,
        lease_token=null,lease_until=null,attempts=0,sent_at=null;
  else
    update app.personal_calendar_reminders set entry_version=new.version where entry_id=new.id;
  end if;
  return new;
end $$;
create trigger schedule_personal_calendar_reminder after insert or update on app.personal_calendar_entries
  for each row execute function app.schedule_personal_calendar_reminder();
reset role;
