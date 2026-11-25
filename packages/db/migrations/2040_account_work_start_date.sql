ALTER TABLE app.users ADD COLUMN work_start_date date;
ALTER TABLE app.users ADD CONSTRAINT users_work_start_date_valid
  CHECK (work_start_date IS NULL OR work_start_date >= DATE '1900-01-01');
