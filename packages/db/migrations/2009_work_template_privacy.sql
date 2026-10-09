-- Personal template contents belong only to their creator. The old permissive FOR ALL write
-- policy also participated in SELECT and let heads read other people's personal templates.
-- Keep the existing department-or-owner SELECT policy; write operations have their own rules.
drop policy if exists work_templates_write on app.work_templates;
drop policy if exists work_templates_insert on app.work_templates;
drop policy if exists work_templates_update on app.work_templates;
drop policy if exists work_templates_delete on app.work_templates;

create policy work_templates_insert on app.work_templates for insert
  with check (
    department_id = app.current_department_id()
    and owner_user_id = app.current_user_id()
    and (scope = 'personal' or app.current_department_role() = 'head')
    and not app.is_view_as()
  );

create policy work_templates_update on app.work_templates for update
  using (
    department_id = app.current_department_id()
    and ((scope = 'personal' and owner_user_id = app.current_user_id())
      or (scope = 'department' and app.current_department_role() = 'head'))
    and not app.is_view_as()
  )
  with check (
    department_id = app.current_department_id()
    and ((scope = 'personal' and owner_user_id = app.current_user_id())
      or (scope = 'department' and app.current_department_role() = 'head'))
    and not app.is_view_as()
  );

create policy work_templates_delete on app.work_templates for delete
  using (
    department_id = app.current_department_id()
    and ((scope = 'personal' and owner_user_id = app.current_user_id())
      or (scope = 'department' and app.current_department_role() = 'head'))
    and not app.is_view_as()
  );
