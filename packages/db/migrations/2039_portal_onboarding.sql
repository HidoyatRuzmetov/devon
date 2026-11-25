set role devon_migrator;

-- Grandfather existing accounts. New accounts carry the obligation before they have a department.
alter table app.users add column onboarding_required boolean not null default false;
alter table app.users alter column onboarding_required set default true;

create table app.onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments(id),
  uploaded_by uuid not null references app.users(id),
  title text not null check (char_length(title) between 1 and 120),
  filename text not null,
  html text not null check (octet_length(html) between 1 and 2097152),
  created_at timestamptz not null default now(),
  rejected_at timestamptz,
  rejected_by uuid references app.users(id),
  unique (department_id, id)
);
create index onboarding_documents_department on app.onboarding_documents(department_id, created_at desc);

create table app.onboarding_publications (
  department_id uuid primary key references app.departments(id),
  document_id uuid not null,
  revision integer not null default 1,
  published_by uuid not null references app.users(id),
  published_at timestamptz not null default now(),
  foreign key (department_id, document_id) references app.onboarding_documents(department_id, id)
);

create table app.portal_onboarding (
  user_id uuid primary key references app.users(id),
  department_id uuid not null references app.departments(id),
  card_id uuid references app.cards(id),
  document_id uuid references app.onboarding_documents(id),
  html_done boolean not null default false,
  tour_step integer not null default 0 check (tour_step between 0 and 50),
  tour_completed boolean not null default false,
  paused boolean not null default false,
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app.card_checklist_items add column onboarding_key text;
create unique index card_onboarding_checklist_key on app.card_checklist_items(card_id, onboarding_key)
  where onboarding_key is not null;

alter table app.onboarding_documents enable row level security;
alter table app.onboarding_documents force row level security;
create policy onboarding_documents_read on app.onboarding_documents for select
  using (department_id = app.current_department_id());
create policy onboarding_documents_insert on app.onboarding_documents for insert
  with check (department_id = app.current_department_id() and uploaded_by = app.current_user_id() and not app.is_view_as());
create policy onboarding_documents_update on app.onboarding_documents for update
  using (department_id = app.current_department_id() and app.current_department_role() = 'head' and not app.is_view_as())
  with check (department_id = app.current_department_id() and app.current_department_role() = 'head' and not app.is_view_as());

alter table app.onboarding_publications enable row level security;
alter table app.onboarding_publications force row level security;
create policy onboarding_publications_read on app.onboarding_publications for select
  using (department_id = app.current_department_id());
create policy onboarding_publications_write on app.onboarding_publications for all
  using (department_id = app.current_department_id() and app.current_department_role() = 'head' and not app.is_view_as())
  with check (department_id = app.current_department_id() and app.current_department_role() = 'head' and not app.is_view_as());

alter table app.portal_onboarding enable row level security;
alter table app.portal_onboarding force row level security;
create policy portal_onboarding_self on app.portal_onboarding for all
  using (user_id = app.current_user_id() and not app.is_view_as())
  with check (user_id = app.current_user_id() and department_id = app.current_department_id() and not app.is_view_as());

reset role;
