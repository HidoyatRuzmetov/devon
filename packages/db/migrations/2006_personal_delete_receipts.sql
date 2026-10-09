-- Persist operation-bound Undo receipts. Existing deleted rows remain deleted and have no receipt.
-- Owner-only RLS from 0500_personal.sql is unchanged; no department/admin visibility is added.
set role devon_migrator;

alter table app.personal_tasks add column if not exists deleted_operation_id uuid;
alter table app.personal_notes add column if not exists deleted_operation_id uuid;
alter table app.personal_canvases add column if not exists deleted_operation_id uuid;

create index if not exists personal_tasks_deleted_operation_idx
  on app.personal_tasks (user_id, deleted_operation_id)
  where deleted_at is not null;

reset role;
