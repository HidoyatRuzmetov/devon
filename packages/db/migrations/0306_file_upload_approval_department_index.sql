-- Owner/subject lookups and department cleanup must not scan other departments' approval requests.
set role devon_migrator;
create index if not exists file_upload_approvals_owner_subject_idx
  on app.file_upload_approvals(department_id,user_id,subject_type,subject_id,status,created_at desc);
reset role;
