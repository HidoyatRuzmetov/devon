// AI L2 (EPIC-016, v1.1 SPEC §8): the retrieval layer behind the palette's semantic search, the Ask
// box and `duplicate_check`. One table (`app.ai_search_documents`, migration 0810), two backends.
//
// Why two: `docs/03-plan/integrations/glm-api-instruction.md` documents a *chat* deployment at
// `api-llm.gpu.uz`. Whether that deployment also serves `/v1/embeddings` is not knowable from a
// document -- `@devon/ai`'s `probeEmbeddings()` finds out at runtime, with the configured key. So
// this file implements the same query surface twice: `searchVector` when the probe says yes,
// `searchText` (Postgres full-text with a pg_trgm similarity fallback) when it says no. Nothing above
// this file branches on which one ran except to say so in the UI.
//
// Every statement here is set-based. There is no "for each card, run a query" anywhere in this file
// (I-9) -- the indexer is four `insert ... select ... on conflict do update` statements, and the
// embedding sidecar reads a whole batch, embeds it in one provider call, and writes it back with one
// `update ... from (values ...)`.
import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '@devon/db'

export type SearchSubjectKind = 'card' | 'comment' | 'page' | 'event'

export type SearchHitRow = {
  subject_type: SearchSubjectKind
  subject_id: string
  title: string
  snippet: string
  score: number
  via: 'embeddings' | 'fts' | 'trigram'
}

/**
 * Pulls plain text out of a ProseMirror/TipTap `jsonb` document *in Postgres*, so the indexer never
 * has to ship a card's whole rich-text body to Node just to strip its markup. `$.**.text` walks the
 * document at any depth and collects every text node; `#>> '{}'` unwraps each `jsonb` string to
 * `text`. A `null` column, or a document with no text at all, yields `''` rather than `null`.
 */
function docText(column: SQL): SQL {
  return sql`coalesce((
    select string_agg(t.value #>> '{}', ' ')
    from jsonb_array_elements(jsonb_path_query_array(${column}, '$.**.text')) as t(value)
  ), '')`
}

/** Bound on how much text one row contributes: a 40-page meeting note is not a better search result
 * for having all of it in the index, and `tsvector` has a 1 MB limit per value. */
const BODY_CHARS = 4000

/**
 * Rebuilds this department's slice of the index from the live tables. Idempotent and cheap to repeat:
 * `on conflict ... do update` only touches rows whose text actually changed, so a no-op refresh
 * writes nothing and the embedding sidecar's staleness test stays meaningful.
 *
 * Returns how many rows were inserted or updated.
 */
export async function refreshIndex(tx: Tx, departmentId: string): Promise<number> {
  const statements: SQL[] = [
    sql`
      insert into app.ai_search_documents (department_id, subject_type, subject_id, title, body)
      select c.department_id, 'card', c.id, c.title, left(${docText(sql`c.description`)}, ${BODY_CHARS})
      from app.cards c
      where c.department_id = ${departmentId} and c.deleted_at is null
      on conflict (department_id, subject_type, subject_id) do update
        set title = excluded.title, body = excluded.body, updated_at = now()
        where app.ai_search_documents.title is distinct from excluded.title
           or app.ai_search_documents.body is distinct from excluded.body
    `,
    sql`
      insert into app.ai_search_documents (department_id, subject_type, subject_id, title, body)
      select cm.department_id, 'comment', cm.id, coalesce(c.title, ''),
             left(${docText(sql`cm.body`)}, ${BODY_CHARS})
      from app.card_comments cm
      join app.cards c on c.id = cm.card_id
      where cm.department_id = ${departmentId} and cm.deleted_at is null
      on conflict (department_id, subject_type, subject_id) do update
        set title = excluded.title, body = excluded.body, updated_at = now()
        where app.ai_search_documents.title is distinct from excluded.title
           or app.ai_search_documents.body is distinct from excluded.body
    `,
    sql`
      insert into app.ai_search_documents (department_id, subject_type, subject_id, title, body)
      select p.department_id, 'page', p.id, p.title, left(${docText(sql`p.blocks`)}, ${BODY_CHARS})
      from app.pages p
      where p.department_id = ${departmentId} and p.deleted_at is null
      on conflict (department_id, subject_type, subject_id) do update
        set title = excluded.title, body = excluded.body, updated_at = now()
        where app.ai_search_documents.title is distinct from excluded.title
           or app.ai_search_documents.body is distinct from excluded.body
    `,
    sql`
      insert into app.ai_search_documents (department_id, subject_type, subject_id, title, body)
      select e.department_id, 'event', e.id, e.title,
             left(concat_ws(' ', coalesce(e.description, ''), coalesce(e.place, '')), ${BODY_CHARS})
      from app.events e
      where e.department_id = ${departmentId} and e.deleted_at is null
      on conflict (department_id, subject_type, subject_id) do update
        set title = excluded.title, body = excluded.body, updated_at = now()
        where app.ai_search_documents.title is distinct from excluded.title
           or app.ai_search_documents.body is distinct from excluded.body
    `,
  ]

  let touched = 0
  for (const statement of statements) {
    const rows = await tx.raw<{ id: string }>(sql`${statement} returning id`)
    touched += rows.length
  }

  // A card that was deleted (or archived out of existence) must stop being findable. One delete per
  // subject kind, anti-joined against the live table -- not a per-row existence check.
  await tx.raw(sql`
    delete from app.ai_search_documents d
    where d.department_id = ${departmentId}
      and (
        (d.subject_type = 'card'
          and not exists (select 1 from app.cards c where c.id = d.subject_id and c.deleted_at is null))
        or (d.subject_type = 'comment'
          and not exists (select 1 from app.card_comments cm where cm.id = d.subject_id and cm.deleted_at is null))
        or (d.subject_type = 'page'
          and not exists (select 1 from app.pages p where p.id = d.subject_id and p.deleted_at is null))
        or (d.subject_type = 'event'
          and not exists (select 1 from app.events e where e.id = d.subject_id and e.deleted_at is null))
      )
  `)

  return touched
}

export type IndexStats = { indexedCount: number; pendingEmbeddingCount: number }

export async function indexStats(tx: Tx, departmentId: string): Promise<IndexStats> {
  const rows = await tx.raw<{ indexed: number; pending: number }>(sql`
    select count(*)::int as indexed,
           count(*) filter (
             where embedded_at is null or content_hash is distinct from encode(sha256(convert_to(title || ' ' || body, 'UTF8')), 'hex')
           )::int as pending
    from app.ai_search_documents
    where department_id = ${departmentId}
  `)
  return {
    indexedCount: rows[0]?.indexed ?? 0,
    pendingEmbeddingCount: rows[0]?.pending ?? 0,
  }
}

export type StaleRow = { id: string; title: string; body: string; content_hash: string }

/** The embedding sidecar's work queue: rows whose text differs from what was embedded last time. */
export async function listRowsNeedingEmbedding(
  tx: Tx,
  departmentId: string,
  limit: number,
): Promise<StaleRow[]> {
  return tx.raw<StaleRow>(sql`
    select id, title, body,
           encode(sha256(convert_to(title || ' ' || body, 'UTF8')), 'hex') as content_hash
    from app.ai_search_documents
    where department_id = ${departmentId}
      and (embedded_at is null
           or content_hash is distinct from encode(sha256(convert_to(title || ' ' || body, 'UTF8')), 'hex'))
    order by updated_at desc
    limit ${limit}
  `)
}

/** Writes a whole batch of vectors back in ONE statement (I-9). */
export async function writeEmbeddings(
  tx: Tx,
  rows: readonly { id: string; contentHash: string; vector: readonly number[] }[],
  model: string,
): Promise<void> {
  if (rows.length === 0) return
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(${row.id}::uuid, ${row.contentHash}::text, ${`[${row.vector.join(',')}]`}::vector)`,
    ),
    sql`, `,
  )
  await tx.raw(sql`
    update app.ai_search_documents d
    set embedding = v.embedding,
        embedding_model = ${model},
        content_hash = v.content_hash,
        embedded_at = now()
    from (values ${values}) as v(id, content_hash, embedding)
    where d.id = v.id
  `)
}

function kindFilter(kind: SearchSubjectKind | undefined): SQL {
  return kind ? sql`and d.subject_type = ${kind}` : sql``
}

/**
 * Full-text search with a trigram fallback, in one statement.
 *
 * `websearch_to_tsquery('simple', …)` handles the phrase/negation syntax people already know from
 * every search box, and `'simple'` (no stemming, no stop words) is the only dictionary that treats
 * uz-Latn, uz-Cyrl, ru and en alike -- Postgres ships no Uzbek dictionary, and stemming Russian while
 * leaving Uzbek raw would make the index quietly better in one of four locales.
 *
 * The trigram arm is not a nicety: it is what answers a misspelt or truncated query ("hisobt",
 * "EGDl"), which is most of what a real person types into a palette. Rows found by both arms keep the
 * FTS score, which is the stronger signal.
 */
export async function searchText(
  tx: Tx,
  departmentId: string,
  query: string,
  limit: number,
  kind?: SearchSubjectKind,
): Promise<SearchHitRow[]> {
  return tx.raw<SearchHitRow>(sql`
    with q as (select websearch_to_tsquery('simple', ${query}) as tsq, ${query}::text as raw)
    select subject_type, subject_id, title, snippet, score, via
    from (
      select d.subject_type, d.subject_id, d.title,
             left(d.body, 240) as snippet,
             ts_rank(d.tsv, q.tsq)::float8 as score,
             'fts' as via
      from app.ai_search_documents d, q
      where d.department_id = ${departmentId}
        and q.tsq is not null
        and d.tsv @@ q.tsq
        ${kindFilter(kind)}
      union all
      select d.subject_type, d.subject_id, d.title,
             left(d.body, 240) as snippet,
             (similarity(d.title, q.raw) * 0.5)::float8 as score,
             'trigram' as via
      from app.ai_search_documents d, q
      where d.department_id = ${departmentId}
        and similarity(d.title, q.raw) > 0.25
        ${kindFilter(kind)}
    ) hits
    order by score desc, title asc
    limit ${limit}
  `)
}

/** Cosine-distance nearest neighbours over the HNSW index. Rows with no embedding are simply not in
 * that index, so a half-embedded department degrades to "fewer semantic hits", never to an error. */
export async function searchVector(
  tx: Tx,
  departmentId: string,
  vector: readonly number[],
  limit: number,
  kind?: SearchSubjectKind,
): Promise<SearchHitRow[]> {
  const literal = `[${vector.join(',')}]`
  return tx.raw<SearchHitRow>(sql`
    select d.subject_type, d.subject_id, d.title,
           left(d.body, 240) as snippet,
           (1 - (d.embedding <=> ${literal}::vector))::float8 as score,
           'embeddings' as via
    from app.ai_search_documents d
    where d.department_id = ${departmentId}
      and d.embedding is not null
      ${kindFilter(kind)}
    order by d.embedding <=> ${literal}::vector
    limit ${limit}
  `)
}

/**
 * `duplicate_check`'s prefilter (AI-AUDIT §4, N-5): the cheapest possible shortlist of cards whose
 * *title* looks like the one being typed, so exactly one confirmation call goes to the model instead
 * of a semantic search over the whole department on every keystroke.
 */
export async function similarCardTitles(
  tx: Tx,
  departmentId: string,
  title: string,
  limit: number,
  excludeCardId?: string,
): Promise<{ subject_id: string; title: string; score: number }[]> {
  return tx.raw<{ subject_id: string; title: string; score: number }>(sql`
    select d.subject_id, d.title, similarity(d.title, ${title})::float8 as score
    from app.ai_search_documents d
    where d.department_id = ${departmentId}
      and d.subject_type = 'card'
      and (${excludeCardId ?? null}::uuid is null or d.subject_id <> ${excludeCardId ?? null}::uuid)
      and similarity(d.title, ${title}) > 0.3
    order by score desc
    limit ${limit}
  `)
}
