set role devon_migrator;

-- Removing a shared photo hides it from the gallery and preserves its attribution and caption.
alter table app.event_photos add column deleted_at timestamptz;

reset role;
