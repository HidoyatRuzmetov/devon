-- Event covers reuse the quarantined upload ledger and its expiry sweep.
set role devon_migrator;
alter table app.uploads drop constraint if exists uploads_purpose_check;
alter table app.uploads add constraint uploads_purpose_check
  check (purpose in ('avatar', 'card_attachment', 'event_thumbnail'));
alter table app.events add column if not exists thumbnail_upload_id uuid references app.uploads(id);
create unique index if not exists events_thumbnail_upload_unique
  on app.events(thumbnail_upload_id) where thumbnail_upload_id is not null;
reset role;
