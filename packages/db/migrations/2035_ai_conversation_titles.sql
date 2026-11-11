set role devon_migrator;

alter table app.ai_conversations add column title_status text not null default 'empty'
  check (title_status in ('empty','pending','ready')),
  add column title_from_briefing boolean not null default false;

-- Only routing and claim metadata may cross owner scopes. The conversation and its text
-- remain under the original owner-only RLS policy.
create table app.ai_conversation_title_jobs (
  conversation_id uuid primary key references app.ai_conversations(id) on delete cascade,
  department_id uuid not null references app.departments(id),
  owner_user_id uuid not null references app.users(id),
  backfill boolean not null default false,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  check ((lease_token is null) = (lease_until is null))
);
create index ai_conversation_title_jobs_due on app.ai_conversation_title_jobs(backfill,available_at,conversation_id);
alter table app.ai_conversation_title_jobs enable row level security;
alter table app.ai_conversation_title_jobs force row level security;
create policy ai_conversation_title_jobs_owner on app.ai_conversation_title_jobs for all
  using (department_id=app.current_department_id() and owner_user_id=app.current_user_id()
    and app.current_department_role() in ('member','head') and not app.is_view_as())
  with check (department_id=app.current_department_id() and owner_user_id=app.current_user_id()
    and app.current_department_role() in ('member','head') and not app.is_view_as());
create policy ai_conversation_title_jobs_worker on app.ai_conversation_title_jobs for all
  using (app.current_actor_role()='super_admin' and app.current_user_id() is null and not app.is_view_as())
  with check (app.current_actor_role()='super_admin' and app.current_user_id() is null and not app.is_view_as());

-- The migration connection can classify existing rows once without weakening conversation RLS.
-- The former title was firstPrompt.slice(0,120), measured in UTF-16 units. Match it exactly,
-- including an emoji cut by the old boundary, so a previously supplied custom title survives.
reset role;
with source as (
  select c.id,c.title,
    exists(select 1 from jsonb_array_elements(c.messages) msg
      where msg->>'role' in ('assistant','user') and btrim(msg->>'content')<>'') as has_text,
    (select msg->>'content' from jsonb_array_elements(c.messages) with ordinality m(msg,ord)
      where msg->>'role'='user' order by ord limit 1) as first_prompt
  from app.ai_conversations c
), classified as (
  select id,first_prompt is null as briefing_only,case
    when title<>'' and title is distinct from (
      select string_agg(case when units<=120 then ch when units=121 and ascii(ch)>65535 then chr(65533) else '' end,'' order by ord)
      from (select ch,ord,sum(case when ascii(ch)>65535 then 2 else 1 end) over(order by ord) as units
        from regexp_split_to_table(left(first_prompt,120),'') with ordinality chars(ch,ord)) utf16
    ) then 'ready'
    when has_text then 'pending' else 'empty' end as state
  from source
)
update app.ai_conversations c set title_status=s.state,title_from_briefing=s.state='pending' and s.briefing_only from classified s
where c.id=s.id and c.title_status<>s.state;
insert into app.ai_conversation_title_jobs(conversation_id,department_id,owner_user_id,backfill)
  select id,department_id,owner_user_id,true from app.ai_conversations where title_status='pending';

set role devon_migrator;
-- Classify and enqueue in the same transaction as the first message or saved briefing,
-- including messages submitted by the previous API during a rolling deployment.
create function app.classify_conversation_title() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and new.title_status=old.title_status and new.title<>old.title
    and old.messages=new.messages then
    new.title_status:='ready';
    new.title_from_briefing:=false;
  elsif tg_op='UPDATE' and old.title_from_briefing and
    exists(select 1 from jsonb_array_elements(new.messages) msg where msg->>'role'='user') then
    -- A head's chat may open on a prefilled briefing. The owner's first actual request
    -- supplies its real subject, even when a briefing-only generation is already in flight.
    new.title_status:='pending';
    new.title_from_briefing:=false;
  elsif new.title_status='empty' and exists(
    select 1 from jsonb_array_elements(new.messages) msg
    where msg->>'role' in ('user','assistant') and btrim(msg->>'content')<>''
  ) then
    new.title_status:='pending';
    new.title_from_briefing:=not exists(
      select 1 from jsonb_array_elements(new.messages) msg where msg->>'role'='user'
    );
  end if;
  return new;
end $$;
create trigger classify_conversation_title before insert or update of messages,title on app.ai_conversations
  for each row execute function app.classify_conversation_title();

create function app.queue_conversation_title() returns trigger language plpgsql as $$
begin
  if new.title_status='pending' and (tg_op='INSERT' or old.title_status='empty'
    or (old.title_from_briefing and not new.title_from_briefing)) then
    insert into app.ai_conversation_title_jobs(conversation_id,department_id,owner_user_id)
      values(new.id,new.department_id,new.owner_user_id)
      on conflict(conversation_id) do update set backfill=false,available_at=now(),
        lease_token=null,lease_until=null,attempts=0;
  end if;
  return null;
end $$;
create trigger queue_conversation_title after insert or update of messages,title on app.ai_conversations
  for each row execute function app.queue_conversation_title();
reset role;
