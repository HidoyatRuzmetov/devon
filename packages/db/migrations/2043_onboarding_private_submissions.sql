set role devon_migrator;

alter table app.onboarding_documents add column approved_at timestamptz;

-- The migration owner alone can backfill publication history inside this transaction.
-- Normal application sessions retain their existing tenant boundaries throughout.
create policy onboarding_documents_migration_history on app.onboarding_documents
  for all to devon_migrator using (true) with check (true);
create policy onboarding_publications_migration_history on app.onboarding_publications
  for select to devon_migrator using (true);

update app.onboarding_documents d set approved_at = history.at
from (
  select subject_id, min(at) as at from audit.events
  where action = 'onboarding.document_published' and subject_type = 'onboarding_document'
  group by subject_id
) history where d.id::text = history.subject_id;
update app.onboarding_documents d set approved_at = p.published_at
from app.onboarding_publications p where p.document_id = d.id and d.approved_at is null;

drop policy onboarding_documents_migration_history on app.onboarding_documents;
drop policy onboarding_publications_migration_history on app.onboarding_publications;

alter policy onboarding_documents_read on app.onboarding_documents using (
  department_id = app.current_department_id() and (
    exists(select 1 from app.onboarding_publications p
      where p.department_id = onboarding_documents.department_id and p.document_id = onboarding_documents.id)
    or (not app.is_view_as() and uploaded_by = app.current_user_id())
    -- Reviewers need the row to remain visible to PostgreSQL during approval/rejection updates.
    -- HTTP read routes additionally restrict reviewers to undecided submissions.
    or (not app.is_view_as() and app.current_department_role() = 'head')
    -- A newcomer already reading an approved edition can finish that private session.
    or (not app.is_view_as() and approved_at is not null and rejected_at is null
      and exists(select 1 from app.portal_onboarding r where r.user_id = app.current_user_id()
        and r.document_id = onboarding_documents.id))
  )
);

reset role;
