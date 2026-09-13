// EPIC-017 -- React Query hooks for the automations module.
//
// Every rule write invalidates the run log too: a rule that was just enabled, disabled or edited
// changes what the log is *about*, and a stale log beside a fresh rule is how a head convinces
// themselves an automation is broken when it is not.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { AutomationRuleBody } from '@devon/contracts'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'

const RULES_KEY = ['automations', 'rules'] as const
const RUNS_KEY = (query: api.RunsQuery) => ['automations', 'runs', query] as const

function useCsrfToken(): string {
  const me = useMeQuery().data
  if (!me) throw new Error('automations: called with no signed-in session')
  return me.csrfToken
}

/** The run log is the only part of this module that changes without anybody clicking: the engine
 * writes to it whenever a card moves. A slow poll keeps "did my rule fire?" answerable without a
 * transport this build does not have. */
const RUNS_POLL_MS = 15000

export function useAutomationRulesQuery(
  enabled = true,
): UseQueryResult<api.AutomationRule[], Error> {
  return useQuery({ queryKey: RULES_KEY, queryFn: api.fetchAutomationRules, enabled })
}

export function useAutomationRunsQuery(
  query: api.RunsQuery = {},
  enabled = true,
): UseQueryResult<api.AutomationRunList, Error> {
  return useQuery({
    queryKey: RUNS_KEY(query),
    queryFn: () => api.fetchAutomationRuns(query),
    enabled,
    refetchInterval: RUNS_POLL_MS,
  })
}

function useInvalidateAutomations() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: RULES_KEY })
    void qc.invalidateQueries({ queryKey: ['automations', 'runs'] })
  }
}

export function useCreateRuleMutation() {
  const csrf = useCsrfToken()
  const invalidate = useInvalidateAutomations()
  return useMutation({
    mutationFn: (body: AutomationRuleBody) => api.createAutomationRule(body, csrf),
    onSuccess: invalidate,
  })
}

export function usePatchRuleMutation() {
  const csrf = useCsrfToken()
  const invalidate = useInvalidateAutomations()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Parameters<typeof api.patchAutomationRule>[1]
    }) => api.patchAutomationRule(id, patch, csrf),
    onSuccess: invalidate,
  })
}

export function useDeleteRuleMutation() {
  const csrf = useCsrfToken()
  const invalidate = useInvalidateAutomations()
  return useMutation({
    mutationFn: (id: string) => api.deleteAutomationRule(id, csrf),
    onSuccess: invalidate,
  })
}

export function usePauseAllMutation() {
  const csrf = useCsrfToken()
  const invalidate = useInvalidateAutomations()
  return useMutation({
    mutationFn: () => api.pauseAllAutomations(csrf),
    onSuccess: invalidate,
  })
}
