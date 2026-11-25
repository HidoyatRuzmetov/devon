set role devon_migrator;

-- Credential bootstrap, like calendar_feeds: no tenant exists until the secret is resolved.
-- Only hashes are stored. Management always verifies an active head in the same transaction;
-- public reads recheck this row and its publisher before projecting tenant-scoped data.
create table app.public_dashboard_links (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments(id),
  created_by uuid not null references app.users(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references app.users(id)
);
create index public_dashboard_links_department on app.public_dashboard_links(department_id, created_at desc);

reset role;
