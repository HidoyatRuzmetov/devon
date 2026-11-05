set role devon_migrator;

-- A date of birth is account-private and never part of the People/public identity response.
create table app.account_birthdays (
  owner_user_id uuid primary key references app.users(id) on delete cascade,
  birth_date date not null check (birth_date >= date '1900-01-01'),
  updated_at timestamptz not null default now()
);
alter table app.account_birthdays enable row level security;
alter table app.account_birthdays force row level security;
create policy account_birthdays_owner on app.account_birthdays for all
  using (not app.is_view_as() and owner_user_id=app.current_user_id())
  with check (not app.is_view_as() and owner_user_id=app.current_user_id());
-- The scheduler may read only active members of its current tenant; it cannot change their DOB.
create policy account_birthdays_scheduler on app.account_birthdays for select
  using (not app.is_view_as() and app.current_actor_role()='super_admin' and exists (
    select 1 from app.memberships m where m.user_id=owner_user_id and m.department_id=app.current_department_id()
      and m.status='active' and m.deleted_at is null));

-- One greeting and one celebration receipt per person/year, even across departments/devices.
create table app.birthday_greetings (
  owner_user_id uuid not null references app.users(id) on delete cascade,
  birthday_year integer not null check (birthday_year between 2020 and 2200),
  celebration_date date not null,
  message text not null check (char_length(message) between 1 and 1000),
  source text not null check (source in ('ai','fallback')),
  created_at timestamptz not null default now(),
  generation_retry_at timestamptz not null default now()+interval '5 minutes',
  celebrated_at timestamptz,
  claim_token uuid,
  claim_until timestamptz,
  primary key(owner_user_id,birthday_year)
);
alter table app.birthday_greetings enable row level security;
alter table app.birthday_greetings force row level security;
create policy birthday_greetings_owner on app.birthday_greetings for all
  using (not app.is_view_as() and owner_user_id=app.current_user_id())
  with check (not app.is_view_as() and owner_user_id=app.current_user_id());
create policy birthday_greetings_scheduler on app.birthday_greetings for all
  using (not app.is_view_as() and app.current_actor_role()='super_admin' and exists (
    select 1 from app.memberships m where m.user_id=owner_user_id and m.department_id=app.current_department_id()
      and m.status='active' and m.deleted_at is null))
  with check (not app.is_view_as() and app.current_actor_role()='super_admin' and exists (
    select 1 from app.memberships m where m.user_id=owner_user_id and m.department_id=app.current_department_id()
      and m.status='active' and m.deleted_at is null));

create table app.birthday_reminders (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments(id),
  owner_user_id uuid not null references app.users(id),
  head_user_id uuid not null references app.users(id),
  celebration_date date not null,
  birthday_year integer generated always as (extract(year from celebration_date)::integer) stored,
  status text not null default 'pending' check(status in ('pending','preparing','sending','sent','uncertain','failed')),
  attempts integer not null default 0,
  retry_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  telegram_message_id bigint,
  unique(department_id,owner_user_id,head_user_id,birthday_year)
);
alter table app.birthday_reminders enable row level security;
alter table app.birthday_reminders force row level security;
create policy birthday_reminders_department on app.birthday_reminders for all
  using(department_id=app.current_department_id() and not app.is_view_as() and app.current_actor_role()='super_admin')
  with check(department_id=app.current_department_id() and not app.is_view_as() and app.current_actor_role()='super_admin');
reset role;
