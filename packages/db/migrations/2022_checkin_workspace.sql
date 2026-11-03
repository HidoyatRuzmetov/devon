set role devon_migrator;

alter table app.checkin_entries add column card_priority text not null default 'none'
  check(card_priority in ('none','low','medium','high','urgent'));

create table app.checkin_layouts (
  department_id uuid not null references app.departments(id),
  cycle_id uuid not null,
  member_user_id uuid not null,
  mode text not null default 'priority' check(mode in ('priority','manual')),
  card_ids uuid[] not null default '{}',
  version integer not null default 1,
  primary key(cycle_id,member_user_id),
  foreign key(cycle_id,department_id) references app.checkin_cycles(id,department_id) on delete cascade
);
create index checkin_layouts_department_idx on app.checkin_layouts(department_id);
alter table app.checkin_layouts enable row level security;
alter table app.checkin_layouts force row level security;
create policy checkin_layouts_scope on app.checkin_layouts for all
  using(department_id=app.current_department_id() and not app.is_view_as())
  with check(department_id=app.current_department_id() and not app.is_view_as());

create function app.checkin_item_locked(item_id uuid) returns boolean language sql stable as $$
  select exists(select 1 from app.checkin_entries e join app.checkin_cycles c on c.id=e.cycle_id
    left join app.checkin_member_locks l on l.cycle_id=c.id and l.member_user_id=e.member_user_id
    where e.checklist_item_id=item_id and e.removed_at is null
      and (coalesce(l.checkin_locked_at,c.checkin_locked_at) is not null or c.checkin_deadline<=now()))
$$;

-- Preserve the source of every retained check-in. Lock cycles in the same order as snapshot
-- synchronization so an agreement racing with a source edit has a single, deterministic winner.
create or replace function app.guard_checkin_source() returns trigger language plpgsql as $$
declare referenced boolean; locked boolean;
begin
  if tg_table_name='cards' then
    select exists(select 1 from app.checkin_entries e where e.card_id=old.id and e.removed_at is null) into referenced;
    if referenced and (tg_op='DELETE' or (old.deleted_at is null and new.deleted_at is not null)) then
      raise exception 'checkin_reference_protected' using errcode='P0001';
    end if;
    if tg_op='DELETE' then return old; end if;
    if old.assignee_user_id is distinct from new.assignee_user_id
      or old.project_id is distinct from new.project_id then
      perform 1 from app.checkin_cycles c where exists(select 1 from app.checkin_entries e
        where e.cycle_id=c.id and e.card_id=old.id and e.removed_at is null)
        order by c.starts_on for update;
      select exists(select 1 from app.checkin_entries e join app.checkin_cycles c on c.id=e.cycle_id
        left join app.checkin_member_locks l on l.cycle_id=c.id and l.member_user_id=e.member_user_id
        where e.card_id=old.id and e.removed_at is null and c.checkout_locked_at is null
          and l.checkout_locked_at is null and c.checkout_deadline>clock_timestamp()
          and (coalesce(l.checkin_locked_at,c.checkin_locked_at) is not null or c.checkin_deadline<=clock_timestamp())) into locked;
      if locked then raise exception 'checkin_assignment_locked' using errcode='P0001'; end if;
    end if;
  else
    select exists(select 1 from app.checkin_entries e where e.checklist_item_id=old.id and e.removed_at is null) into referenced;
    if referenced and (tg_op='DELETE' or (old.deleted_at is null and new.deleted_at is not null)) then
      raise exception 'checkin_reference_protected' using errcode='P0001';
    end if;
    if tg_op='DELETE' then return old; end if;
    if referenced and (old.text is distinct from new.text or old.card_id is distinct from new.card_id
      or old.parent_item_id is distinct from new.parent_item_id or old.assignee_user_id is distinct from new.assignee_user_id) then
      perform 1 from app.checkin_cycles c where exists(select 1 from app.checkin_entries e
        where e.cycle_id=c.id and e.checklist_item_id=old.id and e.removed_at is null)
        order by c.starts_on for update;
      select exists(select 1 from app.checkin_entries e join app.checkin_cycles c on c.id=e.cycle_id
        left join app.checkin_member_locks l on l.cycle_id=c.id and l.member_user_id=e.member_user_id
        where e.checklist_item_id=old.id and e.removed_at is null
          and (coalesce(l.checkin_locked_at,c.checkin_locked_at) is not null or c.checkin_deadline<=clock_timestamp())) into locked;
      if locked then raise exception 'checkin_text_locked' using errcode='P0001'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger guard_checkin_card_source before update or delete on app.cards
  for each row execute function app.guard_checkin_source();
create trigger guard_checkin_item_source before update or delete on app.card_checklist_items
  for each row execute function app.guard_checkin_source();

create function app.guard_checkin_wording() returns trigger language plpgsql as $$
begin
  if old.text is distinct from new.text and old.removed_at is null then
    perform 1 from app.checkin_cycles where id=old.cycle_id for update;
    if app.checkin_item_locked(old.checklist_item_id) then
      raise exception 'checkin_text_locked' using errcode='P0001';
    end if;
  end if;
  return new;
end $$;
create trigger guard_checkin_wording before update of text on app.checkin_entries
  for each row execute function app.guard_checkin_wording();

create or replace function app.advance_card_after_checklist() returns trigger language plpgsql as $$
begin
  if new.done_at is not null and (tg_op='INSERT' or old.done_at is null) then
    update app.cards set work_stage='in_progress',updated_at=now(),version=version+1
      where id=new.card_id and status='active' and work_stage='todo' and deleted_at is null;
  end if;
  return new;
end $$;
create trigger advance_card_after_checklist after insert or update of done_at on app.card_checklist_items
  for each row execute function app.advance_card_after_checklist();

create or replace function app.snapshot_checkin_priority() returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    new.card_priority=coalesce((select priority::text from app.cards where id=new.card_id),new.card_priority);
  end if;
  return new;
end $$;
create trigger snapshot_checkin_priority before insert on app.checkin_entries
  for each row execute function app.snapshot_checkin_priority();

create or replace function app.sync_checkin_priority() returns trigger language plpgsql as $$
begin
  perform 1 from app.checkin_cycles c where c.department_id=new.department_id
    and c.checkout_locked_at is null and c.checkout_deadline>clock_timestamp() order by c.starts_on for update;
  update app.checkin_entries e set card_priority=new.priority,updated_at=now(),version=e.version+1
    from app.checkin_cycles c where e.cycle_id=c.id and e.card_id=new.id and e.removed_at is null
      and c.checkout_locked_at is null and c.checkout_deadline>clock_timestamp()
      and not exists(select 1 from app.checkin_member_locks l where l.cycle_id=c.id
        and l.member_user_id=e.member_user_id and l.checkout_locked_at is not null);
  return new;
end $$;
create trigger sync_checkin_priority after update of priority on app.cards
  for each row execute function app.sync_checkin_priority();
reset role;
