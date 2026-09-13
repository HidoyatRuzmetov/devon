// Typed endpoint functions for the AI module (MODULE-GUIDE.md "Web features"), built on the shared
// `apiClient` exactly like every other feature's `api.ts`.
import { apiClient } from '../../lib/api-client.js'
import {
  aiSettingsSchema,
  briefingResponseSchema,
  refreshBriefingResponseSchema,
  askResponseSchema,
  reindexResponseSchema,
  runFeatureResponseSchema,
  searchBackendSchema,
  searchResponseSchema,
  usageListSchema,
  type AiFeatureId,
  type AiSettings,
  type AskResponse,
  type BriefingResponse,
  type RefreshBriefingResponse,
  type PatchAiSettingsInput,
  type RunFeatureResponse,
  type SearchBackend,
  type SearchHit,
  type Trace,
} from './types.js'

const BASE = '/api/v1/ai'

export function fetchAiSettings(): Promise<AiSettings> {
  return apiClient.get(`${BASE}/settings`, aiSettingsSchema)
}

export function patchAiSettings(
  input: PatchAiSettingsInput,
  csrfToken: string,
): Promise<AiSettings> {
  return apiClient.patch(`${BASE}/settings`, input, aiSettingsSchema, csrfToken)
}

export async function fetchAiUsage(limit = 50): Promise<Trace[]> {
  const result = await apiClient.get(`${BASE}/usage?limit=${limit}`, usageListSchema)
  return result.traces
}

export function runAiFeature(
  feature: AiFeatureId,
  input: Record<string, unknown>,
  csrfToken: string,
): Promise<RunFeatureResponse> {
  return apiClient.post(
    `${BASE}/features/${feature}/run`,
    { input },
    runFeatureResponseSchema,
    csrfToken,
  )
}

// --- EPIC-016: semantic search + the Ask box ---------------------------------------------------

export function searchDepartment(
  query: string,
  limit = 12,
  kind?: SearchHit['subjectType'],
): Promise<{ hits: SearchHit[]; backend: 'embeddings' | 'fts' }> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  if (kind) params.set('kind', kind)
  return apiClient.get(`${BASE}/search?${params.toString()}`, searchResponseSchema)
}

export function fetchSearchBackend(): Promise<SearchBackend> {
  return apiClient.get(`${BASE}/search/backend`, searchBackendSchema)
}

export function askDepartment(
  question: string,
  locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en',
  csrfToken: string,
): Promise<AskResponse> {
  return apiClient.post(`${BASE}/ask`, { question, locale }, askResponseSchema, csrfToken)
}

export function rebuildSearchIndex(
  csrfToken: string,
): Promise<{ indexed: number; embedded: number; backend: 'embeddings' | 'fts' }> {
  return apiClient.post(`${BASE}/search/reindex`, {}, reindexResponseSchema, csrfToken)
}

// --- the head's cached department briefing (v1.1 recapture #23) --------------------------------

/** A plain GET that never calls a model: it returns whatever the nightly job last produced. */
export function fetchBriefing(): Promise<BriefingResponse> {
  return apiClient.get(`${BASE}/briefing`, briefingResponseSchema)
}

/** "Yangilash" -- enqueues a run and returns at once. The tile polls `fetchBriefing` until the
 * status turns `ready`; nothing here ever waits on the model. */
export function refreshBriefing(
  locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en',
  csrfToken: string,
): Promise<RefreshBriefingResponse> {
  return apiClient.post(
    `${BASE}/briefing/refresh`,
    { locale },
    refreshBriefingResponseSchema,
    csrfToken,
  )
}
