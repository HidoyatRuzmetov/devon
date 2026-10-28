set role devon_migrator;
create table app.project_comments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments(id),
  project_id uuid not null references app.projects(id),
  author_user_id uuid not null references app.users(id),
  body jsonb not null,
  mentions uuid[] not null default '{}',
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index project_comments_thread on app.project_comments(department_id,project_id,created_at,id) where deleted_at is null;
alter table app.project_comments enable row level security;
alter table app.project_comments force row level security;
create policy project_comments_read on app.project_comments for select
  using(department_id=app.current_department_id());
create policy project_comments_write on app.project_comments for all
  using(department_id=app.current_department_id() and not app.is_view_as())
  with check(department_id=app.current_department_id() and not app.is_view_as());
create trigger ai_project_comments_changed after insert or update or delete on app.project_comments
  for each row execute function app.ai_record_changed('context');
-- The same live-parent authorization used by downloads surrounds cached file extraction.
-- This additive policy extends the existing card/page/conversation policy only to projects.
create policy ai_file_text_project_access on app.ai_file_text for all using (
  department_id=app.current_department_id() and exists (
    select 1 from app.attachments a join app.projects p on p.id=a.subject_id
    where a.id=attachment_id and a.subject_type='project' and a.department_id=app.current_department_id()
      and a.deleted_at is null and a.scan_status='clean' and p.deleted_at is null
  )
) with check (
  department_id=app.current_department_id() and exists (
    select 1 from app.attachments a join app.projects p on p.id=a.subject_id
    where a.id=attachment_id and a.subject_type='project' and a.department_id=app.current_department_id()
      and a.deleted_at is null and a.scan_status='clean' and p.deleted_at is null
  )
);
alter table app.file_upload_approvals drop constraint file_upload_approvals_subject_type_check;
alter table app.file_upload_approvals add constraint file_upload_approvals_subject_type_check
  check(subject_type in ('card','page','ai_conversation','project'));
reset role;
