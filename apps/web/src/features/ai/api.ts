// Typed endpoint functions for the AI module (MODULE-GUIDE.md "Web features"), built on the shared
// `apiClient` exactly like every other feature's `api.ts`.
import { apiClient } from '../../lib/api-client.js'
import {
  aiSettingsSchema,
  askResponseSchema,
  reindexResponseSchema,
  runFeatureResponseSchema,
  searchBackendSchema,
  searchResponseSchema,
  usageListSchema,
  type AiFeatureId,
  type AiSettings,
  type AskResponse,
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
