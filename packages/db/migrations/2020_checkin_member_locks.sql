set role devon_migrator;

-- Cycle locks remain the shared automatic deadline/legacy baseline. Manual locks are per member.
create table app.checkin_member_locks (
  department_id uuid not null references app.departments(id),
  cycle_id uuid not null,
  member_user_id uuid not null,
  checkin_locked_at timestamptz,
  checkout_locked_at timestamptz,
  primary key(cycle_id,member_user_id),
  foreign key(cycle_id,department_id) references app.checkin_cycles(id,department_id) on delete cascade,
  check (checkout_locked_at is null or checkin_locked_at is not null)
);
create index checkin_member_locks_department_idx on app.checkin_member_locks(department_id);
alter table app.checkin_member_locks enable row level security;
alter table app.checkin_member_locks force row level security;
create policy checkin_member_locks_scope on app.checkin_member_locks for all
  using (department_id=app.current_department_id() and not app.is_view_as())
  with check (department_id=app.current_department_id() and not app.is_view_as());

-- Source updates synchronise only live cycles. The time guard is intentional: a delayed worker
-- cannot let a Saturday completion rewrite Friday's result. This trigger runs under caller RLS.
create or replace function app.sync_checkin_checklist() returns trigger language plpgsql as $$
begin
  perform 1 from app.checkin_cycles c
    where c.department_id=new.department_id and c.checkout_locked_at is null
      and c.checkout_deadline > clock_timestamp()
    order by c.starts_on for update;
  update app.checkin_entries e set text=new.text,
    state=case when new.done_at is not null then 'done'
      when e.state='done' then 'pending' else e.state end,
    updated_at=now(), version=e.version+1
  from app.checkin_cycles c
  where e.cycle_id=c.id and e.checklist_item_id=new.id and e.removed_at is null
    and c.checkout_locked_at is null and c.checkout_deadline > clock_timestamp()
    and not exists(select 1 from app.checkin_member_locks l
      where l.cycle_id=e.cycle_id and l.member_user_id=e.member_user_id and l.checkout_locked_at is not null)
    and (e.text is distinct from new.text or (e.state='done') is distinct from (new.done_at is not null));
  return new;
end $$;
drop trigger if exists sync_checkin_checklist on app.card_checklist_items;
create trigger sync_checkin_checklist after update of text,done_at on app.card_checklist_items
  for each row execute function app.sync_checkin_checklist();

-- Metadata belongs to the snapshot too, so checkout never depends on mutable card/project titles.
create or replace function app.sync_checkin_card() returns trigger language plpgsql as $$
begin
  perform 1 from app.checkin_cycles c where c.department_id=new.department_id
    and c.checkout_locked_at is null and c.checkout_deadline > clock_timestamp()
    order by c.starts_on for update;
  update app.checkin_entries e set card_title=new.title, project_id=new.project_id,
    project_title=(select p.title from app.projects p where p.id=new.project_id),
    updated_at=now(),version=e.version+1
  from app.checkin_cycles c where e.cycle_id=c.id and e.card_id=new.id
    and e.removed_at is null and c.checkout_locked_at is null and c.checkout_deadline > clock_timestamp()
    and not exists(select 1 from app.checkin_member_locks l
      where l.cycle_id=e.cycle_id and l.member_user_id=e.member_user_id and l.checkout_locked_at is not null);
  return new;
end $$;
drop trigger if exists sync_checkin_card on app.cards;
create trigger sync_checkin_card after update of title,project_id on app.cards
  for each row execute function app.sync_checkin_card();
create or replace function app.sync_checkin_project() returns trigger language plpgsql as $$
begin
  perform 1 from app.checkin_cycles c where c.department_id=new.department_id
    and c.checkout_locked_at is null and c.checkout_deadline > clock_timestamp()
    order by c.starts_on for update;
  update app.checkin_entries e set project_title=new.title,updated_at=now(),version=e.version+1
    from app.checkin_cycles c where e.cycle_id=c.id and e.project_id=new.id
      and e.removed_at is null and c.checkout_locked_at is null and c.checkout_deadline > clock_timestamp()
    and not exists(select 1 from app.checkin_member_locks l
      where l.cycle_id=e.cycle_id and l.member_user_id=e.member_user_id and l.checkout_locked_at is not null);
  return new;
end $$;
drop trigger if exists sync_checkin_project on app.projects;
create trigger sync_checkin_project after update of title on app.projects
  for each row execute function app.sync_checkin_project();

-- Lock checks also live at the write boundary, including the instant a request crosses midnight.
-- A source-trigger update crossing that boundary keeps the old snapshot and lets the source save.
create or replace function app.guard_checkin_entry() returns trigger language plpgsql as $$
declare cycle app.checkin_cycles;
  member_lock app.checkin_member_locks;
begin
  select * into cycle from app.checkin_cycles where id=coalesce(new.cycle_id,old.cycle_id) for update;
  select * into member_lock from app.checkin_member_locks
    where cycle_id=cycle.id and member_user_id=coalesce(new.member_user_id,old.member_user_id);
  if member_lock.checkout_locked_at is not null or cycle.checkout_locked_at is not null or cycle.checkout_deadline<=clock_timestamp() then
    if pg_trigger_depth()>1 then return old; end if;
    -- Recovery may run on a normal page read as well as the scheduler. Its only permitted late
    -- insert is an exact copy of an unfinished entry from the previous frozen cycle. A closed
    -- target remains immutable, including to the scheduler.
    if not (tg_op='INSERT' and member_lock.checkout_locked_at is null and cycle.checkout_locked_at is null and exists (
      select 1 from app.checkin_entries e join app.checkin_cycles p on p.id=e.cycle_id
      where p.department_id=cycle.department_id and p.starts_on=cycle.starts_on-14
        and p.checkout_locked_at is not null and e.removed_at is null and e.state<>'done'
        and row(e.department_id,e.checklist_item_id,e.card_id,e.member_user_id,e.member_name,
          e.unit_id,e.unit_name,e.unit_colour,e.card_title,e.project_id,e.project_title,e.text,e.state)
          is not distinct from row(new.department_id,new.checklist_item_id,new.card_id,new.member_user_id,new.member_name,
          new.unit_id,new.unit_name,new.unit_colour,new.card_title,new.project_id,new.project_title,new.text,new.state)
    )) then
      raise exception 'checkout_locked' using errcode='P0001';
    end if;
  end if;
  if tg_op='UPDATE' and old.removed_at is null and new.removed_at is not null
    and (member_lock.checkin_locked_at is not null or cycle.checkin_locked_at is not null or cycle.checkin_deadline<=clock_timestamp()) then
    raise exception 'checkin_locked' using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_checkin_entry on app.checkin_entries;
create trigger guard_checkin_entry before insert or update on app.checkin_entries
  for each row execute function app.guard_checkin_entry();
reset role;
