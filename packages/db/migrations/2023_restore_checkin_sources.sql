-- One-time recovery of soft-deleted sources still referenced by retained check-in results.
-- No rows are fabricated; hard-deleted sources cannot be reconstructed reliably.
reset role;
update app.cards c set deleted_at=null,updated_at=now(),version=version+1
where c.deleted_at is not null and exists(select 1 from app.checkin_entries e where e.card_id=c.id and e.removed_at is null);
with recursive required_items as (
  select i.id,i.parent_item_id from app.card_checklist_items i
    where exists(select 1 from app.checkin_entries e where e.checklist_item_id=i.id and e.removed_at is null)
  union
  select p.id,p.parent_item_id from app.card_checklist_items p join required_items child on child.parent_item_id=p.id
)
update app.card_checklist_items set deleted_at=null,updated_at=now(),version=version+1
where deleted_at is not null and id in(select id from required_items);

-- A completed standalone task used to be archived directly by the completion control. Recover
-- only rows with completion evidence; a deliberate archive without completion remains archived.
update app.cards set status='done',archived_at=null,updated_at=now(),version=version+1
where status='archived' and done_at is not null and deleted_at is null
  and not exists(select 1 from app.card_activity a where a.card_id=app.cards.id
    and a.kind='status' and a.data->>'to'='archived');

-- Priority was not previously snapshotted. Populate still-open results only.
update app.checkin_entries e set card_priority=c.priority
from app.cards c,app.checkin_cycles cycle
where e.card_id=c.id and e.cycle_id=cycle.id and cycle.checkout_locked_at is null
  and cycle.checkout_deadline>now() and not exists(select 1 from app.checkin_member_locks l
    where l.cycle_id=cycle.id and l.member_user_id=e.member_user_id and l.checkout_locked_at is not null);

update app.cards c set work_stage='in_progress',updated_at=now(),version=version+1
where c.status='active' and c.work_stage='todo' and c.deleted_at is null
  and exists(select 1 from app.card_checklist_items i where i.card_id=c.id and i.done_at is not null and i.deleted_at is null);
