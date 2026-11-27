set role devon_migrator;

-- Old reading sessions do not grant access to outdated publications. Only the uploader
-- can read them through the API; unfinished sessions follow the current approved edition.
alter policy onboarding_documents_read on app.onboarding_documents using (
  department_id = app.current_department_id() and (
    exists(select 1 from app.onboarding_publications p
      where p.department_id = onboarding_documents.department_id and p.document_id = onboarding_documents.id)
    or (not app.is_view_as() and uploaded_by = app.current_user_id())
    -- PostgreSQL must keep the row visible during review updates. API reads restrict heads
    -- to undecided submissions and never expose other people's outdated or declined editions.
    or (not app.is_view_as() and app.current_department_role() = 'head')
  )
);

reset role;
