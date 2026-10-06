-- Reuse the existing quarantined upload lifecycle for task attachments.
set role devon_migrator;
alter table app.uploads drop constraint if exists uploads_purpose_check;
alter table app.uploads add constraint uploads_purpose_check check (purpose in ('avatar', 'card_attachment'));
alter table app.attachments add column if not exists deleted_by_user_id uuid references app.users(id);
reset role;
