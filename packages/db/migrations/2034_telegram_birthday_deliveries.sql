set role devon_migrator;

-- Delivery metadata only. Reconnecting the same Telegram chat keeps its original receipt.
create table app.telegram_birthday_deliveries (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments(id),
  owner_user_id uuid not null references app.users(id),
  chat_id bigint not null,
  celebration_date date not null,
  celebration_year integer generated always as (extract(year from celebration_date)::integer) stored,
  status text not null default 'pending' check(status in ('pending','preparing','sending','sent','uncertain','failed')),
  attempts integer not null default 0,
  retry_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  source text check(source in ('ai','fallback')),
  last_error text check(last_error in ('preparation_failed','recipient_changed','telegram_retry','delivery_failed','delivery_uncertain')),
  telegram_message_id bigint,
  sent_at timestamptz,
  unique(department_id,chat_id,owner_user_id,celebration_year)
);
create index telegram_birthday_deliveries_due_idx on app.telegram_birthday_deliveries
  (department_id,celebration_date,retry_at) where status in ('pending','preparing','sending');
alter table app.telegram_birthday_deliveries enable row level security;
alter table app.telegram_birthday_deliveries force row level security;
create policy telegram_birthday_deliveries_scheduler on app.telegram_birthday_deliveries for all
  using(department_id=app.current_department_id() and not app.is_view_as() and app.current_actor_role()='super_admin')
  with check(department_id=app.current_department_id() and not app.is_view_as() and app.current_actor_role()='super_admin');

reset role;
