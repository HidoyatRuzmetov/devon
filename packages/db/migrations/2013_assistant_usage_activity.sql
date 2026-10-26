set role devon_migrator;

-- NULL means the serving endpoint did not report cache use; it is not a zero cache hit rate.
alter table app.ai_traces add column if not exists cached_prompt_tokens integer
  check (cached_prompt_tokens >= 0 and cached_prompt_tokens <= prompt_tokens);
reset role;

-- Repair only checklist activities whose original actor is unambiguous in the immutable audit.
-- Run the data repair as the migration connection, since these tables FORCE row-level security.
-- All three rows were written in one transaction, hence the identical PostgreSQL now() value.
-- Never infer an actor from the current assignee, and never rewrite the audit chain.
with attributed as (
  select a.id, min(e.actor_user_id::text)::uuid as actor,
    bool_or(coalesce(e.user_agent, '') like '% ai-action/%') as assisted
  from app.card_activity a
  join app.card_checklist_items i on i.card_id=a.card_id and i.department_id=a.department_id
    and i.created_at=a.at
  join audit.events e on e.subject_id=i.id::text and e.department_id=a.department_id
    and e.action='work.checklist_item_added' and e.at=a.at
  where a.kind='checklist' and a.actor_user_id is null and e.actor_user_id is not null
  group by a.id having count(distinct e.actor_user_id)=1
)
update app.card_activity a set actor_user_id=r.actor,
  data=coalesce(a.data,'{}'::jsonb)||jsonb_build_object('via',case when r.assisted then 'ai' else 'manual' end)
from attributed r where a.id=r.id;

