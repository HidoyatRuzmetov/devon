-- AI L2 search index (EPIC-016, v1.1 SPEC §8, AI-AUDIT §4 N-5). Expand-only (I-15); idempotent per
-- the same conventions as every prior migration.
--
-- ONE table backs BOTH retrieval backends, deliberately:
--
--   * `tsv` is a generated column and is therefore always populated, for every row, with no job and
--     no external service. Postgres full-text search over it, with a pg_trgm similarity fallback for
--     the short/misspelt queries FTS is bad at, is the backend this product ships with — because
--     `docs/03-plan/integrations/glm-api-instruction.md` documents a chat deployment only, and we do
--     not know until runtime whether this ministry's GLM endpoint offers embeddings at all.
--   * `embedding` is nullable and is filled by a sidecar job ONLY if `@devon/ai`'s `probeEmbeddings()`
--     — which actually calls `/v1/models` and `/v1/embeddings` with the configured key — comes back
--     available. A deployment without embeddings simply never writes this column, every index below
--     still works, and `/ai` says in plain words which backend is in use.
--
-- That is why this is one table and not two: the same row, the same freshness rules, the same RLS,
-- and a backend switch that is a WHERE clause rather than a migration.
--
-- No column here matches birth/dob/passport/pinfl/address/salary/nationality/religio (I-2). `body`
-- carries department work text (card titles, comment bodies, page text) that the department's own
-- members can already read; it is never prompt or response text from a model (TECH-SPEC §8), and it
-- is wiped with the department like every other department-owned table.
set role devon_migrator;

create table if not exists app.ai_search_documents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.departments (id),
  -- 'card' | 'comment' | 'page' | 'event'. Plain text rather than an enum: this set grows with the
  -- product (canvas, projects) and an enum would make each addition a migration for no gain --
  -- nothing in the database branches on the value.
  subject_type text not null,
  subject_id uuid not null,
  title text not null default '',
  body text not null default '',
  -- 'simple' rather than 'english': three of this product's four locales are not English, and no
  -- Postgres dictionary covers Uzbek. 'simple' does no stemming and no stop-word removal, which is
  -- exactly right for uz-Latn/uz-Cyrl and merely unremarkable for ru/en -- and it is what makes the
  -- same index usable for all four without a per-locale column.
  tsv tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  -- 1024 dimensions, matching `@devon/ai`'s DEFAULT_EMBEDDINGS_DIMENSIONS. A probe that reports a
  -- different width makes the embeddings backend *unavailable* rather than silently writing vectors
  -- of the wrong size (see `probeEmbeddings`'s `dimension_mismatch`).
  embedding vector(1024),
  embedding_model text,
  -- sha256 of title+body at the time the embedding was written: the sidecar re-embeds a row only
  -- when this differs from the current content, so an edit that did not change the text costs
  -- nothing and a restart does not re-embed the whole department.
  content_hash text not null default '',
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_search_documents_subject_key
  on app.ai_search_documents (department_id, subject_type, subject_id);

create index if not exists ai_search_documents_tsv_idx
  on app.ai_search_documents using gin (tsv);

-- The trigram fallback: what answers "EGDl" when the user meant "EGDI", and what `duplicate_check`'s
-- prefilter uses to shortlist candidates by title similarity.
create index if not exists ai_search_documents_title_trgm_idx
  on app.ai_search_documents using gin (title gin_trgm_ops);

-- HNSW over cosine distance. Rows with a null embedding are simply not in this index, which is the
-- whole reason the embeddings backend can be absent without anything else changing.
create index if not exists ai_search_documents_embedding_idx
  on app.ai_search_documents using hnsw (embedding vector_cosine_ops);

-- The sidecar's work queue in one index: everything whose text changed since it was last embedded.
create index if not exists ai_search_documents_stale_idx
  on app.ai_search_documents (department_id, updated_at)
  where embedded_at is null;

alter table app.ai_search_documents enable row level security;
alter table app.ai_search_documents force row level security;

drop policy if exists ai_search_documents_read on app.ai_search_documents;
create policy ai_search_documents_read on app.ai_search_documents for select
  using (department_id = app.current_department_id() or app.current_actor_role() = 'super_admin');

-- Written by the indexer inside an ordinary request/job transaction, never by a person; `for all` is
-- required so `insert`/`update` are permitted at all under `force row level security`, same
-- reasoning `0302_work_rls.sql` gives for `card_activity_write`. A view-as session may not write:
-- an impersonated session must not be able to change what search returns for the real user.
drop policy if exists ai_search_documents_write on app.ai_search_documents;
create policy ai_search_documents_write on app.ai_search_documents for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

reset role;
