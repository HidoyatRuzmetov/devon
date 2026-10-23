-- Durable change journal: only changed records need text extraction/re-indexing.
set role devon_migrator;
create table if not exists app.ai_index_dirty (
 department_id uuid not null references app.departments(id), subject_type text not null, subject_id uuid not null,
 primary key(department_id,subject_type,subject_id)
);
create table if not exists app.ai_context_revisions (
 department_id uuid primary key references app.departments(id), revision bigint not null default 1
);
alter table app.ai_index_dirty enable row level security;
alter table app.ai_index_dirty force row level security;
drop policy if exists ai_index_dirty_scope on app.ai_index_dirty;
create policy ai_index_dirty_scope on app.ai_index_dirty for all
 using(department_id=app.current_department_id() or app.current_actor_role()='super_admin' or current_user='devon_migrator')
 with check(department_id=app.current_department_id() or app.current_actor_role()='super_admin' or current_user='devon_migrator');
alter table app.ai_context_revisions enable row level security;
alter table app.ai_context_revisions force row level security;
drop policy if exists ai_context_revisions_scope on app.ai_context_revisions;
create policy ai_context_revisions_scope on app.ai_context_revisions for all
 using(department_id=app.current_department_id() or app.current_actor_role()='super_admin' or current_user='devon_migrator')
 with check(department_id=app.current_department_id() or app.current_actor_role()='super_admin' or current_user='devon_migrator');
grant select,insert,update,delete on app.ai_index_dirty,app.ai_context_revisions to devon_app;

-- Narrow trigger-only privilege: creation/join can write a membership before the caller has a
-- selected department. This function exposes no query API and can only journal its triggering row.
create or replace function app.ai_record_changed() returns trigger language plpgsql security definer
set search_path=pg_catalog,app as $$
declare r record;
begin
 if tg_op='DELETE' then r:=old; else r:=new; end if;
 if tg_argv[0] <> 'context' then
  insert into app.ai_index_dirty(department_id,subject_type,subject_id) values(r.department_id,tg_argv[0],r.id)
  on conflict do nothing;
 end if;
 if tg_argv[0]='card' then
  insert into app.ai_index_dirty(department_id,subject_type,subject_id)
  select r.department_id,'comment',id from app.card_comments where card_id=r.id
  on conflict do nothing;
 end if;
 insert into app.ai_context_revisions(department_id,revision) values(r.department_id,1)
 on conflict(department_id) do update set revision=app.ai_context_revisions.revision+1;
 return r;
end $$;
drop trigger if exists ai_cards_changed on app.cards;
create trigger ai_cards_changed after insert or update or delete on app.cards for each row execute function app.ai_record_changed('card');
drop trigger if exists ai_comments_changed on app.card_comments;
create trigger ai_comments_changed after insert or update or delete on app.card_comments for each row execute function app.ai_record_changed('comment');
drop trigger if exists ai_pages_changed on app.pages;
create trigger ai_pages_changed after insert or update or delete on app.pages for each row execute function app.ai_record_changed('page');
drop trigger if exists ai_events_changed on app.events;
create trigger ai_events_changed after insert or update or delete on app.events for each row execute function app.ai_record_changed('event');
drop trigger if exists ai_projects_changed on app.projects;
create trigger ai_projects_changed after insert or update or delete on app.projects for each row execute function app.ai_record_changed('project');
drop trigger if exists ai_units_changed on app.units;
create trigger ai_units_changed after insert or update or delete on app.units for each row execute function app.ai_record_changed('context');
drop trigger if exists ai_memberships_changed on app.memberships;
create trigger ai_memberships_changed after insert or update or delete on app.memberships for each row execute function app.ai_record_changed('context');
drop trigger if exists ai_unit_roles_changed on app.unit_roles;
create trigger ai_unit_roles_changed after insert or update or delete on app.unit_roles for each row execute function app.ai_record_changed('context');
drop trigger if exists ai_checklist_changed on app.card_checklist_items;
create trigger ai_checklist_changed after insert or update or delete on app.card_checklist_items for each row execute function app.ai_record_changed('context');
drop trigger if exists ai_attachments_changed on app.attachments;
create trigger ai_attachments_changed after insert or update or delete on app.attachments for each row execute function app.ai_record_changed('context');
drop trigger if exists ai_event_comments_changed on app.event_comments;
create trigger ai_event_comments_changed after insert or update or delete on app.event_comments for each row execute function app.ai_record_changed('context');

set local app.actor_role='super_admin';
insert into app.ai_index_dirty(department_id,subject_type,subject_id)
 select department_id,'card',id from app.cards union all select department_id,'comment',id from app.card_comments
 union all select department_id,'page',id from app.pages union all select department_id,'event',id from app.events
 union all select department_id,'project',id from app.projects
 on conflict do nothing;
insert into app.ai_context_revisions(department_id) select id from app.departments on conflict do nothing;
reset role;
