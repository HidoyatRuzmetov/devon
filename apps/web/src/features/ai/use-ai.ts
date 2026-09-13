// React Query hooks over `api.ts` (MODULE-GUIDE.md "Web features"). Every mutation reads the CSRF
// token off the cached `/me` response, same convention as `personal`'s `use-personal.ts`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'
import type { AiFeatureId, PatchAiSettingsInput } from './types.js'

const KEYS = {
  settings: ['ai', 'settings'] as const,
  usage: ['ai', 'usage'] as const,
}

function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

export function useAiSettingsQuery() {
  return useQuery({ queryKey: KEYS.settings, queryFn: api.fetchAiSettings })
}

export function usePatchAiSettingsMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: PatchAiSettingsInput) => api.patchAiSettings(input, csrf),
    onSuccess: (settings) => qc.setQueryData(KEYS.settings, settings),
  })
}

export function useAiUsageQuery() {
  return useQuery({ queryKey: KEYS.usage, queryFn: () => api.fetchAiUsage(50) })
}

/**
 * `useMutation` with `feature` fixed per call site rather than passed at call time -- every use site
 * in this feature (the assistant panel's tabs) already knows which feature it is running, and keeping
 * it out of the mutation's variables means `mutate(input)` never needs a wrapper object.
 */
export function useRunAiFeatureMutation(feature: AiFeatureId) {
  const csrf = useCsrfToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => api.runAiFeature(feature, input, csrf),
    // A successful (or even a failed-but-costly) call changes this month's spend -- refetch settings
    // next time the budget gauge is visible instead of leaving it stale until a manual reload.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEYS.settings })
      void qc.invalidateQueries({ queryKey: KEYS.usage })
    },
  })
}

// --- EPIC-016: semantic search + the Ask box ---------------------------------------------------

/**
 * Department-wide search behind the palette. `enabled` on a non-empty query so typing one character
 * does not fire a request per keystroke -- the caller debounces the string it passes in.
 */
export function useDepartmentSearchQuery(query: string, limit = 12) {
  return useQuery({
    queryKey: ['ai', 'search', query, limit] as const,
    queryFn: () => api.searchDepartment(query, limit),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  })
}

export function useSearchBackendQuery() {
  return useQuery({
    queryKey: ['ai', 'search', 'backend'] as const,
    queryFn: api.fetchSearchBackend,
  })
}

export function useAskMutation() {
  const csrf = useCsrfToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { question: string; locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en' }) =>
      api.askDepartment(vars.question, vars.locale, csrf),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEYS.settings })
      void qc.invalidateQueries({ queryKey: KEYS.usage })
    },
  })
}

export function useRebuildIndexMutation() {
  const csrf = useCsrfToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.rebuildSearchIndex(csrf),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEYS.settings })
      void qc.invalidateQueries({ queryKey: ['ai', 'search'] })
    },
  })
}
