-- CONTRACT: safe because the retired résumé field is removed from the application, and deployment
-- stops old writers and verifies the backup before this one-time removal.
reset role;
do $$
declare
  saved record;
begin
  for saved in
    select id, professional_profile_updated_at from app.users
    where jsonb_typeof(professional_profile) = 'object' and professional_profile ? 'headline'
    order by id for update
  loop
    update app.users
      set professional_profile = professional_profile - 'headline'
      where id = saved.id;
    -- The normal résumé-update trigger dated the JSON change. Restore the employee's actual
    -- save date while this transaction still owns the row. No résumé version is incremented.
    update app.users
      set professional_profile_updated_at = saved.professional_profile_updated_at
      where id = saved.id;
  end loop;
end;
$$;
