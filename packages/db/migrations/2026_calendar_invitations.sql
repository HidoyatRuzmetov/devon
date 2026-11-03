set role devon_migrator;
alter table app.personal_calendar_entries add column participant_user_ids uuid[] not null default '{}';
create index personal_calendar_participants on app.personal_calendar_entries using gin(participant_user_ids) where deleted_at is null;
-- Attendees can read only entries explicitly shared with them; editing stays owner-only.
create policy personal_calendar_attendee_read on app.personal_calendar_entries for select
  using(app.current_user_id()=any(participant_user_ids) and not app.is_view_as());
alter table app.notifications add column dedupe_key text;
create unique index notifications_dedupe on app.notifications(user_id,dedupe_key) where dedupe_key is not null;
reset role;
