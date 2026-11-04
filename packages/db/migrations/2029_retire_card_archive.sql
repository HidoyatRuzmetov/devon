-- User-approved one-time retirement: preserve every archived task as Done.
-- Historical activity and archive timestamps remain evidence; no task is deleted by this migration.
reset role;
update app.cards set status='done', done_at=coalesce(done_at,archived_at,updated_at),
  updated_at=now(),version=version+1
where status='archived';
-- The old enum value is retained for historical migration compatibility, but cannot be written.
alter table app.cards add constraint cards_supported_status check(status in ('active','done'));
