// AI L2 (EPIC-016, v1.1 SPEC §8): the orchestration half of semantic search and the Ask box.
//
// The one decision this file owns is *which retrieval backend is in use*, and it takes that decision
// at runtime, from a real probe against the configured key -- `@devon/ai`'s `probeEmbeddings()` calls
// `/v1/models` and then actually asks `/v1/embeddings` for a vector, and only a vector of the width
// migration 0810 created counts as a yes. The brief required exactly this: not an assumption, not a
// build flag, a probe, with the answer written on the `/ai` screen in words.
//
// The probe is cached in-process for `PROBE_TTL_MS` (a deployment does not grow an embeddings
// endpoint between two requests) and is never allowed to block or fail a search: every failure mode
// resolves to `{ backend: 'fts' }`, which is a complete, shipped product on its own -- Postgres
// full-text search over a generated `tsvector`, with a pg_trgm arm for the misspelt queries FTS is
// bad at. Embeddings make it better; their absence does not make it broken.
import { withContext, type RequestContext, type Tx } from '@devon/db'
import {
  embed,
  loadAiConfig,
  probeEmbeddings,
  MAX_EMBED_BATCH,
  PROBE_TTL_MS,
  type EmbeddingsProbe,
} from '@devon/ai'
import * as searchRepo from './search-repo.js'
import type { SearchBackendDto, SearchHitDto, SearchSubjectKind } from './schemas.js'

const aiConfig = loadAiConfig()

type CachedProbe = { probe: EmbeddingsProbe; expiresAt: number }
let cachedProbe: CachedProbe | null = null
let inFlight: Promise<EmbeddingsProbe> | null = null

/** Test seam, same precedent as `service.ts`'s `__setProviderForTests`. */
export function __setProbeForTests(probe: EmbeddingsProbe | null): void {
  cachedProbe = probe ? { probe, expiresAt: Date.now() + PROBE_TTL_MS } : null
  inFlight = null
}

/**
 * The cached runtime probe. Concurrent callers share one in-flight request (`inFlight`) so a cold
 * cache under load makes one probe, not one per request.
 */
export async function getEmbeddingsProbe(): Promise<EmbeddingsProbe> {
  const now = Date.now()
  if (cachedProbe && cachedProbe.expiresAt > now) return cachedProbe.probe
  if (inFlight) return inFlight
  inFlight = probeEmbeddings({ config: aiConfig })
    .then((probe) => {
      cachedProbe = { probe, expiresAt: Date.now() + PROBE_TTL_MS }
      return probe
    })
    .catch(
      (): EmbeddingsProbe => ({
        available: false,
        model: null,
        dimensions: null,
        reason: 'models_endpoint_unreachable',
        checkedAt: new Date().toISOString(),
        listedEmbeddingModels: [],
      }),
    )
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export type Backend = 'embeddings' | 'fts'

export async function currentBackend(): Promise<Backend> {
  const probe = await getEmbeddingsProbe()
  return probe.available ? 'embeddings' : 'fts'
}

/** What `GET /ai/settings` and `/ai`'s settings screen report about retrieval. */
export async function describeBackend(
  ctx: RequestContext,
  departmentId: string,
): Promise<SearchBackendDto> {
  const probe = await getEmbeddingsProbe()
  const stats = await withContext(ctx, (tx) => searchRepo.indexStats(tx, departmentId))
  return {
    backend: probe.available ? 'embeddings' : 'fts',
    model: probe.model,
    dimensions: probe.dimensions,
    reason: probe.reason,
    checkedAt: probe.checkedAt,
    indexedCount: stats.indexedCount,
    pendingEmbeddingCount: probe.available ? stats.pendingEmbeddingCount : 0,
  }
}

function toDto(row: searchRepo.SearchHitRow): SearchHitDto {
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    title: row.title,
    snippet: row.snippet,
    // `ts_rank` is unbounded-ish and cosine similarity is already 0..1; clamp both so one wire
    // contract holds whichever backend answered and a client can render a bar without branching.
    score: Math.max(0, Math.min(1, row.score)),
    via: row.via,
  }
}

/**
 * One search, whichever backend is live. Refreshes this department's index first: the index is
 * derived data, rebuilding it is four set-based upserts that write nothing when nothing changed
 * (see `search-repo.ts`), and a search that can return a card created ten seconds ago is worth far
 * more than a background job that is "eventually" right. The embedding sidecar is the part that
 * genuinely cannot run inline, and it does not.
 */
export async function search(
  ctx: RequestContext,
  departmentId: string,
  query: string,
  limit: number,
  kind?: SearchSubjectKind,
): Promise<{ hits: SearchHitDto[]; backend: Backend }> {
  const backend = await currentBackend()

  let vector: number[] | null = null
  if (backend === 'embeddings') {
    const probe = await getEmbeddingsProbe()
    try {
      const result = await embed({
        config: aiConfig,
        model: probe.model ?? aiConfig.embeddingsModel,
        inputs: [query],
      })
      vector = result.vectors[0] ?? null
    } catch {
      // The endpoint was there when we probed and is not now. Fall through to FTS rather than fail
      // the user's search -- this is precisely the degradation the two-backend design exists for.
      vector = null
    }
  }

  const rows = await withContext(ctx, async (tx) => {
    await searchRepo.refreshIndex(tx, departmentId)
    if (vector) {
      const semantic = await searchRepo.searchVector(tx, departmentId, vector, limit, kind)
      // A department whose sidecar has not caught up yet has rows with no embedding at all. Top the
      // semantic answer up from the text index rather than showing a short list -- the `via` field
      // keeps the result honest about which arm each hit came from.
      if (semantic.length >= limit) return semantic
      const textual = await searchRepo.searchText(tx, departmentId, query, limit, kind)
      const seen = new Set(semantic.map((row) => `${row.subject_type}:${row.subject_id}`))
      return [
        ...semantic,
        ...textual.filter((row) => !seen.has(`${row.subject_type}:${row.subject_id}`)),
      ].slice(0, limit)
    }
    return searchRepo.searchText(tx, departmentId, query, limit, kind)
  })

  return { hits: rows.map(toDto), backend }
}

/**
 * The embedding sidecar. Not a timer in this file: `index.ts` starts it on the Fastify plugin's
 * `onReady` hook and clears it on `onClose`, which is the only lifecycle this module actually owns
 * (H11.1 "timers cleared"). Returns how many rows it embedded so the head's "rebuild the index"
 * action can report a number.
 *
 * Bounded on every axis: at most `MAX_EMBED_BATCH` texts per provider call, at most `maxBatches`
 * calls per invocation. A department with 20 000 cards is indexed over several ticks, never in one
 * request that holds a connection for a minute.
 */
export async function embedPending(
  ctx: RequestContext,
  departmentId: string,
  maxBatches = 4,
): Promise<number> {
  const probe = await getEmbeddingsProbe()
  if (!probe.available || !probe.model) return 0

  let embedded = 0
  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await withContext(ctx, (tx) =>
      searchRepo.listRowsNeedingEmbedding(tx, departmentId, MAX_EMBED_BATCH),
    )
    if (rows.length === 0) break

    let vectors: number[][]
    try {
      const result = await embed({
        config: aiConfig,
        model: probe.model,
        inputs: rows.map((row) => `${row.title}\n${row.body}`.slice(0, 4000)),
      })
      vectors = result.vectors
    } catch {
      // One failed batch stops this tick, not the product: the rows stay stale and the next tick
      // retries them. Never a partial write of vectors we are not sure about.
      break
    }

    await withContext(ctx, (tx) =>
      searchRepo.writeEmbeddings(
        tx,
        rows.map((row, i) => ({
          id: row.id,
          contentHash: row.content_hash,
          vector: vectors[i] ?? [],
        })).filter((row) => row.vector.length === aiConfig.embeddingsDimensions),
        probe.model!,
      ),
    )
    embedded += rows.length
    if (rows.length < MAX_EMBED_BATCH) break
  }
  return embedded
}

/** Full refresh + embed for one department, behind the head's "rebuild" button on `/ai`. */
export async function rebuildIndex(
  ctx: RequestContext,
  departmentId: string,
): Promise<{ indexed: number; embedded: number; backend: Backend }> {
  const indexed = await withContext(ctx, (tx) => searchRepo.refreshIndex(tx, departmentId))
  const embedded = await embedPending(ctx, departmentId, 8)
  return { indexed, embedded, backend: await currentBackend() }
}

/** `duplicate_check`'s prefilter, exposed to `service.ts` without it importing `search-repo` too. */
export async function similarCards(
  tx: Tx,
  departmentId: string,
  title: string,
  limit: number,
  excludeCardId?: string,
): Promise<{ id: string; title: string; score: number }[]> {
  await searchRepo.refreshIndex(tx, departmentId)
  const rows = await searchRepo.similarCardTitles(tx, departmentId, title, limit, excludeCardId)
  return rows.map((row) => ({ id: row.subject_id, title: row.title, score: row.score }))
}
