// Queries and mutations for the head's people surfaces (v1.1 SPEC §4.3, §6).
//
// Every query key starts with `['people', …]` so the person page, the table and the head dashboard
// share one cache: opening a person from a row does not refetch what the row already knows.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PeopleView, PeopleViewConfig } from '@devon/contracts'
import type { Me } from '../../lib/api-schemas.js'
import { useDepartment } from '../../lib/session.js'
import * as api from './api.js'

/** The double-submit token, read from the cached `/me` the shell already loaded. Empty string when
 * there is no session, which every mutation here is guarded against by its own `enabled` gate. */
export function useCsrfToken(): string {
  const queryClient = useQueryClient()
  return queryClient.getQueryData<Me | null>(['me'])?.csrfToken ?? ''
}

export const peopleKeys = {
  indicators: (departmentId: string | null, keys: readonly string[]) =>
    ['people', 'indicators', departmentId, [...keys].sort().join(',')] as const,
  views: (departmentId: string | null) => ['people', 'views', departmentId] as const,
  overview: (userId: string) => ['people', 'person', userId, 'overview'] as const,
  cards: (userId: string, role: string, status: string) =>
    ['people', 'person', userId, 'cards', role, status] as const,
  activity: (userId: string) => ['people', 'person', userId, 'activity'] as const,
}

export function useIndicatorsQuery(keys: readonly string[], enabled: boolean) {
  const { departmentId } = useDepartment()
  return useQuery({
    queryKey: peopleKeys.indicators(departmentId, keys),
    queryFn: () => api.fetchIndicators(keys),
    enabled: enabled && departmentId !== null && keys.length > 0,
  })
}

export function usePeopleViewsQuery(enabled: boolean) {
  const { departmentId } = useDepartment()
  return useQuery({
    queryKey: peopleKeys.views(departmentId),
    queryFn: api.fetchPeopleViews,
    enabled: enabled && departmentId !== null,
  })
}

export function useCreateViewMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const { departmentId } = useDepartment()
  return useMutation({
    mutationFn: (input: api.CreateViewInput) => api.createPeopleView(input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: peopleKeys.views(departmentId) }),
  })
}

export function usePatchViewMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const { departmentId } = useDepartment()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.PatchViewInput }) =>
      api.patchPeopleView(id, input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: peopleKeys.views(departmentId) }),
  })
}

export function useDeleteViewMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const { departmentId } = useDepartment()
  return useMutation({
    mutationFn: (id: string) => api.deletePeopleView(id, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: peopleKeys.views(departmentId) }),
  })
}

export function usePersonOverviewQuery(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: peopleKeys.overview(userId ?? ''),
    queryFn: () => api.fetchPersonOverview(userId!),
    enabled: enabled && Boolean(userId),
  })
}

export function usePersonCardsQuery(
  userId: string | null,
  role: 'assignee' | 'giver',
  status: 'active' | 'done' | 'all',
  enabled = true,
) {
  return useQuery({
    queryKey: peopleKeys.cards(userId ?? '', role, status),
    queryFn: () => api.fetchPersonCards(userId!, { role, status }),
    enabled: enabled && Boolean(userId),
  })
}

export function usePersonActivityQuery(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: peopleKeys.activity(userId ?? ''),
    queryFn: () => api.fetchPersonActivity(userId!),
    enabled: enabled && Boolean(userId),
  })
}

/** The view the table opens on: the department default when one is set, otherwise the head's first
 * own view, otherwise `null` (which the screen reads as "the built-in default columns"). */
export function pickInitialView(views: readonly PeopleView[]): PeopleView | null {
  return views.find((v) => v.isDepartmentDefault) ?? views[0] ?? null
}

export type ViewConfigPatch = Partial<PeopleViewConfig>
