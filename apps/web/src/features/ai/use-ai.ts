// React Query hooks over `api.ts` (MODULE-GUIDE.md "Web features"). Every mutation reads the CSRF
// token off the cached `/me` response, same convention as `personal`'s `use-personal.ts`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'
import type { AiFeatureId, PatchAiSettingsInput } from './types.js'

const KEYS = {
  settings: ['ai', 'settings'] as const,
  usage: ['ai', 'usage'] as const,
  briefing: ['ai', 'briefing'] as const,
}

function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

function useAiScope() {
  const { data: me } = useMeQuery()
  const departmentId = me?.activeDepartmentId ?? me?.memberships[0]?.departmentId ?? null
  return {
    key: [me?.user.id ?? null, departmentId, me?.actingForUserId ?? null] as const,
    enabled: Boolean(me && departmentId),
  }
}

export function useAiSettingsQuery() {
  const scope = useAiScope()
  return useQuery({
    queryKey: [...KEYS.settings, ...scope.key],
    queryFn: api.fetchAiSettings,
    enabled: scope.enabled,
  })
}

export function usePatchAiSettingsMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const scope = useAiScope()
  return useMutation({
    mutationFn: (input: PatchAiSettingsInput) => api.patchAiSettings(input, csrf),
    onSuccess: (settings) => qc.setQueryData([...KEYS.settings, ...scope.key], settings),
  })
}

export function useAiUsageQuery() {
  const scope = useAiScope()
  return useQuery({
    queryKey: [...KEYS.usage, ...scope.key],
    queryFn: () => api.fetchAiUsage(50),
    enabled: scope.enabled,
  })
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
  const scope = useAiScope()
  return useQuery({
    queryKey: ['ai', 'search', ...scope.key, query, limit] as const,
    queryFn: () => api.searchDepartment(query, limit),
    enabled: scope.enabled && query.trim().length >= 2,
    staleTime: 30_000,
  })
}

export function useSearchBackendQuery() {
  const scope = useAiScope()
  return useQuery({
    queryKey: ['ai', 'search', 'backend', ...scope.key] as const,
    queryFn: api.fetchSearchBackend,
    enabled: scope.enabled,
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

// --- the head's cached department briefing (v1.1 recapture #23) --------------------------------

/**
 * The cached briefing. Cheap enough to fetch on every Home render -- it reads one row -- and it
 * polls only while a run is actually in flight: `refetchInterval` is a function, so a `ready` row
 * costs nothing and a `queued` one is checked every ten seconds until it lands. A briefing takes
 * one to five minutes, so a tighter interval would be noise on the network panel and no faster to
 * the reader.
 */
export function useBriefingQuery(enabled: boolean) {
  const scope = useAiScope()
  return useQuery({
    queryKey: [...KEYS.briefing, ...scope.key],
    queryFn: api.fetchBriefing,
    enabled: enabled && scope.enabled,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const status = query.state.data?.briefing?.status
      return status === 'queued' || status === 'running' ? 10_000 : false
    },
  })
}

/** "Yangilash". Invalidates the cached row on settle so the tile switches to `tayyorlanmoqda`
 * immediately, and the poll above takes over from there. */
export function useRefreshBriefingMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en') => api.refreshBriefing(locale, csrf),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEYS.briefing })
      void qc.invalidateQueries({ queryKey: KEYS.settings })
    },
  })
}
