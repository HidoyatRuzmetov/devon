-- A resume's revision date must not change when unrelated account settings change.
reset role;
alter table app.users add column professional_profile_updated_at timestamptz;
update app.users u set professional_profile_updated_at = (
  select max(e.at) from audit.events e
  where e.subject_id = u.id::text and e.action = 'accounts.professional_profile_updated'
);
set role devon_migrator;
create function app.track_professional_profile_update() returns trigger
language plpgsql set search_path = pg_catalog, app as $$
begin
  if (new.professional_profile, new.given_name, new.family_name, new.patronymic, new.title, new.email, new.avatar_key)
    is distinct from
    (old.professional_profile, old.given_name, old.family_name, old.patronymic, old.title, old.email, old.avatar_key) then
    new.professional_profile_updated_at := now();
  end if;
  return new;
end;
$$;
create trigger users_professional_profile_date before update on app.users
for each row execute function app.track_professional_profile_update();
reset role;
