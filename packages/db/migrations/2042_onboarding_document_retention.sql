set role devon_migrator;

-- Head-scoped retention/deletion, including an explicitly requested demo reset. Published and
-- referenced documents still cannot be removed until their referencing rows are cleared.
create policy onboarding_documents_delete on app.onboarding_documents for delete
  using (department_id = app.current_department_id() and app.current_department_role() = 'head' and not app.is_view_as());

reset role;
