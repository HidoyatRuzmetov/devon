// Typed endpoint functions for analytics (MODULE-GUIDE.md "Web features": "the typed API client every
// `src/features/<name>` module builds its own endpoint functions on"). `apiClient.delete` already
// covers this feature's DELETE routes (no extra local helper needed, unlike `personal/api.ts`).
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import {
  analyticsSummarySchema,
  personalOverviewSchema,
  pinnedChartListSchema,
  pinnedChartSchema,
  savedFilterListSchema,
  savedFilterSchema,
  type AnalyticsSummary,
  type CreatePinInput,
  type CreateSavedFilterInput,
  type PatchSavedFilterInput,
  type PersonalOverview,
  type PinnedChart,
  type SavedFilter,
  type SummaryQuery,
} from './types.js'

const BASE = '/api/v1/analytics'

function queryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v)
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const fetchSummary = (query: SummaryQuery = {}): Promise<AnalyticsSummary> =>
  apiClient.get(`${BASE}/summary${queryString(query)}`, analyticsSummarySchema)

export const fetchPersonalOverview = (): Promise<PersonalOverview> =>
  apiClient.get(`${BASE}/personal`, personalOverviewSchema)

export function exportCsvUrl(chart: string, query: SummaryQuery = {}): string {
  return `${BASE}/export.csv${queryString({ ...query, chart })}`
}

export const fetchSavedFilters = (): Promise<SavedFilter[]> =>
  apiClient.get(`${BASE}/saved-filters`, savedFilterListSchema)

export const createSavedFilter = (
  input: CreateSavedFilterInput,
  csrf: string,
): Promise<SavedFilter> => apiClient.post(`${BASE}/saved-filters`, input, savedFilterSchema, csrf)

export const patchSavedFilter = (
  id: string,
  input: PatchSavedFilterInput,
  csrf: string,
): Promise<SavedFilter> =>
  apiClient.patch(`${BASE}/saved-filters/${id}`, input, savedFilterSchema, csrf)

export const deleteSavedFilter = (id: string, csrf: string): Promise<void> =>
  apiClient.delete(`${BASE}/saved-filters/${id}`, csrf)

export const fetchPinnedCharts = (): Promise<PinnedChart[]> =>
  apiClient.get(`${BASE}/pins`, pinnedChartListSchema)

export const pinChart = (input: CreatePinInput, csrf: string): Promise<PinnedChart> =>
  apiClient.post(`${BASE}/pins`, input, pinnedChartSchema, csrf)

export const unpinChart = (id: string, csrf: string): Promise<void> =>
  apiClient.delete(`${BASE}/pins/${id}`, csrf)

const reorderResultSchema = z.object({ updated: z.number().int() })

export const reorderPins = (ids: string[], csrf: string): Promise<{ updated: number }> =>
  apiClient.post(`${BASE}/pins/reorder`, { ids }, reorderResultSchema, csrf)
