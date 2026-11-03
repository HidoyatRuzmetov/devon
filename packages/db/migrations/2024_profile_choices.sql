-- One-time replacement of the two former free-text fields. Other biography data stays intact.
reset role;
update app.users set title=null,
  professional_profile=jsonb_set(jsonb_set(professional_profile,'{position}','""'::jsonb),'{education}',
    coalesce((select jsonb_agg(item || '{"degree":""}'::jsonb order by ordinal)
      from jsonb_array_elements(coalesce(professional_profile->'education','[]'::jsonb)) with ordinality e(item,ordinal)),'[]'::jsonb)),
  professional_profile_version=professional_profile_version+1,updated_at=now()
where deleted_at is null;
