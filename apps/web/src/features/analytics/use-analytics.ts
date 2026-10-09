// React Query hooks over `api.ts` (MODULE-GUIDE.md "Web features"), same shape as `personal/
// use-personal.ts`: every mutation reads the CSRF token off the cached `/me` response and
// invalidates this feature's own query keys on success.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'
import type {
  CreatePinInput,
  CreateSavedFilterInput,
  PatchSavedFilterInput,
  SummaryQuery,
} from './types.js'

const KEYS = {
  summary: (q: SummaryQuery) =>
    ['analytics', 'summary', q.filter ?? '', q.since ?? '', q.until ?? ''] as const,
  personal: ['analytics', 'personal'] as const,
  savedFilters: ['analytics', 'savedFilters'] as const,
  pins: ['analytics', 'pins'] as const,
}

function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

export function useSummaryQuery(query: SummaryQuery, enabled = true) {
  return useQuery({
    queryKey: KEYS.summary(query),
    queryFn: () => api.fetchSummary(query),
    enabled,
  })
}

export function usePersonalOverviewQuery() {
  return useQuery({ queryKey: KEYS.personal, queryFn: api.fetchPersonalOverview })
}

export function useSavedFiltersQuery() {
  return useQuery({ queryKey: KEYS.savedFilters, queryFn: api.fetchSavedFilters })
}

export function useCreateSavedFilterMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreateSavedFilterInput) => api.createSavedFilter(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.savedFilters }),
  })
}

export function usePatchSavedFilterMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchSavedFilterInput }) =>
      api.patchSavedFilter(id, input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.savedFilters }),
  })
}

export function useDeleteSavedFilterMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deleteSavedFilter(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.savedFilters }),
  })
}

export function usePinnedChartsQuery(enabled = true) {
  return useQuery({ queryKey: KEYS.pins, queryFn: api.fetchPinnedCharts, enabled })
}

export function usePinChartMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreatePinInput) => api.pinChart(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.pins }),
  })
}

export function useUnpinChartMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.unpinChart(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.pins }),
  })
}
