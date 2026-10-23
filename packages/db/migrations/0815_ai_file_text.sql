SET ROLE devon_migrator;
CREATE TABLE IF NOT EXISTS app.ai_file_text (
  attachment_id uuid PRIMARY KEY REFERENCES app.attachments(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES app.departments(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  parser_version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('read','truncated','unsupported','unavailable')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_file_text_department_idx ON app.ai_file_text(department_id);
ALTER TABLE app.ai_file_text ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_file_text FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_file_text_access ON app.ai_file_text;
CREATE POLICY ai_file_text_access ON app.ai_file_text FOR ALL USING (
  department_id = app.current_department_id()
  AND EXISTS (SELECT 1 FROM app.attachments a
    WHERE a.id=attachment_id AND a.department_id=app.current_department_id()
      AND a.deleted_at IS NULL AND a.scan_status='clean' AND (
        (a.subject_type='card' AND EXISTS (SELECT 1 FROM app.cards c WHERE c.id=a.subject_id AND c.deleted_at IS NULL))
        OR (a.subject_type='page' AND EXISTS (SELECT 1 FROM app.pages p WHERE p.id=a.subject_id AND p.deleted_at IS NULL))
        OR (a.subject_type='ai_conversation' AND EXISTS (SELECT 1 FROM app.ai_conversations c WHERE c.id=a.subject_id AND c.owner_user_id=app.current_user_id()))
      ))
) WITH CHECK (
  department_id = app.current_department_id()
  AND EXISTS (SELECT 1 FROM app.attachments a
    WHERE a.id=attachment_id AND a.department_id=app.current_department_id()
      AND a.deleted_at IS NULL AND a.scan_status='clean' AND (
        (a.subject_type='card' AND EXISTS (SELECT 1 FROM app.cards c WHERE c.id=a.subject_id AND c.deleted_at IS NULL))
        OR (a.subject_type='page' AND EXISTS (SELECT 1 FROM app.pages p WHERE p.id=a.subject_id AND p.deleted_at IS NULL))
        OR (a.subject_type='ai_conversation' AND EXISTS (SELECT 1 FROM app.ai_conversations c WHERE c.id=a.subject_id AND c.owner_user_id=app.current_user_id()))
      ))
);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.ai_file_text TO devon_app;
RESET ROLE;
