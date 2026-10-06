-- Keep deleted cards and their children for the immutable audit trail. The deleting
-- actor alone may undo a recent deletion; no tenant or personal RLS policy changes.
set role devon_migrator;
alter table app.cards add column if not exists deleted_by_user_id uuid references app.users (id);
reset role;
