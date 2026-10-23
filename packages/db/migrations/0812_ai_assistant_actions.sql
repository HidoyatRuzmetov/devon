-- Conversations remain private to their owner; members may now use the same assistant.
set role devon_migrator;
drop policy if exists ai_conversations_owner on app.ai_conversations;
create policy ai_conversations_owner on app.ai_conversations for all
  using (department_id = app.current_department_id() and owner_user_id = app.current_user_id()
    and current_setting('app.department_role', true) in ('head','member') and not app.is_view_as())
  with check (department_id = app.current_department_id() and owner_user_id = app.current_user_id()
    and current_setting('app.department_role', true) in ('head','member') and not app.is_view_as());

-- Chat uploads use the ordinary quarantine/approval pipeline but are private until attached.
drop policy if exists attachments_conversation_privacy on app.attachments;
create policy attachments_conversation_privacy on app.attachments as restrictive for all
  using (department_id = app.current_department_id() and (subject_type <> 'ai_conversation' or uploaded_by_user_id = app.current_user_id()))
  with check (department_id = app.current_department_id() and (subject_type <> 'ai_conversation' or uploaded_by_user_id = app.current_user_id()));
alter table app.file_upload_approvals drop constraint if exists file_upload_approvals_subject_type_check;
alter table app.file_upload_approvals add constraint file_upload_approvals_subject_type_check
  check (subject_type in ('card','page','ai_conversation'));
reset role;
