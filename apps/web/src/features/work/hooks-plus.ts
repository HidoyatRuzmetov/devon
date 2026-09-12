// v1.1 SPEC §7 -- React Query hooks for everything v1.1 added to a card. Same contract as `hooks.ts`:
// a screen reads and writes through these, never `api-plus.ts` directly, so cache invalidation lives
// in one place and an optimistic write always has a matching rollback.
//
// Where a mutation's effect is visible on a *card* (an estimate, a focus pin, a repeat rule), it
// invalidates the board and card caches `hooks.ts` owns too -- the chips on the tile are computed
// server-side (`blockedByOpenCount`, `focusPinned`, `estimateMin`), so the tile is only correct
// again once those queries refetch.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import * as api from './api-plus.js'
import { useCsrfToken } from './hooks.js'

// Key prefixes. `['work', ...]` throughout, so `hooks.ts`'s own invalidations and these never
// collide but can still be cleared together when a department switch invalidates everything.
const DEPENDENCIES_KEY = (cardId: string) => ['work', 'dependencies', cardId] as const
const DEPENDENCY_GRAPH_KEY = ['work', 'dependency-graph'] as const
const TIME_LOG_KEY = (cardId: string) => ['work', 'time-log', cardId] as const
const REMINDERS_KEY = (cardId: string) => ['work', 'reminders', cardId] as const
const TEMPLATES_KEY = (kind?: string) => ['work', 'templates', kind ?? 'all'] as const
const FOCUS_KEY = ['work', 'focus'] as const
const CAPACITY_KEY = ['work', 'capacity'] as const
const WORKLOAD_KEY = (query: api.WorkloadQuery) => ['work', 'workload', query] as const
const MY_WORKLOAD_KEY = (query: api.WorkloadQuery) => ['work', 'workload-mine', query] as const
const GOALS_KEY = ['work', 'goals'] as const

const BOARD_KEY = ['work', 'board'] as const
const CARDS_KEY = ['work', 'cards'] as const
const CARD_KEY = (id: string) => ['work', 'card', id] as const

/** A card's chips (blocked / repeat / estimate / focus) are server-computed, so any write that can
 * change one has to let the board and the card re-read. */
function invalidateCardSurfaces(qc: QueryClient, cardId?: string): void {
  void qc.invalidateQueries({ queryKey: BOARD_KEY })
  void qc.invalidateQueries({ queryKey: CARDS_KEY })
  if (cardId) void qc.invalidateQueries({ queryKey: CARD_KEY(cardId) })
}

// --- A10 dependencies -----------------------------------------------------------------------------

export function useCardDependenciesQuery(
  cardId: string | null,
): UseQueryResult<api.CardDependencies, Error> {
  return useQuery({
    queryKey: DEPENDENCIES_KEY(cardId ?? ''),
    queryFn: () => api.fetchCardDependencies(cardId!),
    enabled: cardId !== null,
  })
}

/** Every edge in the department -- the dependency picker runs `wouldCreateDependencyCycle` over this
 * so a card that would close a loop is greyed out *before* the click, not refused after it. */
export function useDependencyGraphQuery(
  enabled = true,
): UseQueryResult<api.DependencyEdgeRow[], Error> {
  return useQuery({
    queryKey: DEPENDENCY_GRAPH_KEY,
    queryFn: api.fetchDependencyGraph,
    enabled,
  })
}

export function useAddDependencyMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (blockedByCardId: string) => api.addCardDependency(cardId, blockedByCardId, csrf),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DEPENDENCIES_KEY(cardId) })
      void qc.invalidateQueries({ queryKey: DEPENDENCY_GRAPH_KEY })
      invalidateCardSurfaces(qc, cardId)
    },
  })
}

export function useRemoveDependencyMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (depId: string) => api.removeCardDependency(cardId, depId, csrf),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DEPENDENCIES_KEY(cardId) })
      void qc.invalidateQueries({ queryKey: DEPENDENCY_GRAPH_KEY })
      invalidateCardSurfaces(qc, cardId)
    },
  })
}

// --- A3 the light time log -------------------------------------------------------------------------

export function useCardTimeLogQuery(cardId: string | null): UseQueryResult<api.CardTimeLog, Error> {
  return useQuery({
    queryKey: TIME_LOG_KEY(cardId ?? ''),
    queryFn: () => api.fetchCardTimeLog(cardId!),
    enabled: cardId !== null,
  })
}

export function useAddTimeLogMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: { minutes: number; spentOn?: string; note?: string }) =>
      api.addTimeLog(cardId, input, csrf),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TIME_LOG_KEY(cardId) })
      invalidateCardSurfaces(qc, cardId)
    },
  })
}

export function useDeleteTimeLogMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (logId: string) => api.deleteTimeLog(cardId, logId, csrf),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TIME_LOG_KEY(cardId) })
      invalidateCardSurfaces(qc, cardId)
    },
  })
}

// --- 7.4 reminders ----------------------------------------------------------------------------------

export function useCardRemindersQuery(
  cardId: string | null,
): UseQueryResult<api.CardReminder[], Error> {
  return useQuery({
    queryKey: REMINDERS_KEY(cardId ?? ''),
    queryFn: () => api.fetchCardReminders(cardId!),
    enabled: cardId !== null,
  })
}

export function useAddReminderMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: { remindAt: string; note?: string }) =>
      api.addCardReminder(cardId, input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: REMINDERS_KEY(cardId) }),
  })
}

export function useDeleteReminderMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (reminderId: string) => api.deleteCardReminder(cardId, reminderId, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: REMINDERS_KEY(cardId) }),
  })
}

// --- A8 the bulk bar ----------------------------------------------------------------------------------

/** The whole selection in one request. The result carries the *previous* values of every card it
 * touched, which is what the undo toast sends back -- undo over confirm (DESIGN.md), so the bar acts
 * immediately and offers the way back rather than asking first. */
export function useBulkPatchMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: api.BulkCardPatch }) =>
      api.bulkPatchCards(ids, patch, csrf),
    onSuccess: () => invalidateCardSurfaces(qc),
  })
}

export function useBulkUndoMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (entries: api.BulkUndoEntry[]) => api.undoBulkPatch(entries, csrf),
    onSuccess: () => invalidateCardSurfaces(qc),
  })
}

// --- 7.2 templates -------------------------------------------------------------------------------------

export function useWorkTemplatesQuery(
  kind?: 'card' | 'project',
): UseQueryResult<api.WorkTemplate[], Error> {
  return useQuery({ queryKey: TEMPLATES_KEY(kind), queryFn: () => api.fetchWorkTemplates(kind) })
}

function invalidateTemplates(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['work', 'templates'] })
}

export function useCreateTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createWorkTemplate>[0]) =>
      api.createWorkTemplate(input, csrf),
    onSuccess: () => invalidateTemplates(qc),
  })
}

export function usePatchTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Parameters<typeof api.patchWorkTemplate>[1]
    }) => api.patchWorkTemplate(id, patch, csrf),
    onSuccess: () => invalidateTemplates(qc),
  })
}

export function useDeleteTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkTemplate(id, csrf),
    onSuccess: () => invalidateTemplates(qc),
  })
}

export function useCreateCardFromTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: Parameters<typeof api.createCardFromTemplate>[1]
    }) => api.createCardFromTemplate(id, input, csrf),
    onSuccess: () => {
      invalidateCardSurfaces(qc)
      // `useCount` moved, so the gallery's "used N times" line is now stale.
      invalidateTemplates(qc)
    },
  })
}

// --- A9 the focus list ("Diqqat markazi") -----------------------------------------------------------------

export function useFocusListQuery(): UseQueryResult<api.FocusList, Error> {
  return useQuery({ queryKey: FOCUS_KEY, queryFn: api.fetchFocusList })
}

export function useAddFocusMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (cardId: string) => api.addFocusPin(cardId, csrf),
    onSuccess: (_data, cardId) => {
      void qc.invalidateQueries({ queryKey: FOCUS_KEY })
      invalidateCardSurfaces(qc, cardId)
    },
  })
}

export function useRemoveFocusMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (cardId: string) => api.removeFocusPin(cardId, csrf),
    onSuccess: (_data, cardId) => {
      void qc.invalidateQueries({ queryKey: FOCUS_KEY })
      invalidateCardSurfaces(qc, cardId)
    },
  })
}

/** Reordering is optimistic: the pin moves under the pointer and stays there, because a list of five
 * that snaps back after a round trip feels broken even when the write succeeded. */
export function useReorderFocusMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (cardIds: string[]) => api.reorderFocusList(cardIds, csrf),
    onMutate: (cardIds) => {
      const previous = qc.getQueryData<api.FocusList>(FOCUS_KEY)
      if (previous) {
        const byId = new Map(previous.items.map((pin) => [pin.cardId, pin]))
        const reordered = cardIds
          .map((id, index) => {
            const pin = byId.get(id)
            return pin ? { ...pin, position: index } : null
          })
          .filter((pin): pin is api.FocusPin => pin !== null)
        qc.setQueryData<api.FocusList>(FOCUS_KEY, { ...previous, items: reordered })
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(FOCUS_KEY, context.previous)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: FOCUS_KEY }),
  })
}

// --- A4 capacity and workload -------------------------------------------------------------------------------

export function useCapacityQuery(enabled = true): UseQueryResult<api.CapacityRow[], Error> {
  return useQuery({ queryKey: CAPACITY_KEY, queryFn: api.fetchCapacity, enabled })
}

export function usePutCapacityMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ userId, weeklyHours }: { userId: string; weeklyHours: number }) =>
      api.putCapacity(userId, weeklyHours, csrf),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CAPACITY_KEY })
      void qc.invalidateQueries({ queryKey: ['work', 'workload'] })
      void qc.invalidateQueries({ queryKey: ['work', 'workload-mine'] })
    },
  })
}

export function useWorkloadQuery(
  query: api.WorkloadQuery,
  enabled = true,
): UseQueryResult<api.Workload, Error> {
  return useQuery({
    queryKey: WORKLOAD_KEY(query),
    queryFn: () => api.fetchWorkload(query),
    enabled,
  })
}

/** SPEC §2.2: a member has no workload *grid*, but does get their own row -- this endpoint is the
 * one they are allowed to call, and the server refuses any other user id for them. */
export function useMyWorkloadQuery(
  query: api.WorkloadQuery = {},
  enabled = true,
): UseQueryResult<api.Workload, Error> {
  return useQuery({
    queryKey: MY_WORKLOAD_KEY(query),
    queryFn: () => api.fetchMyWorkload(query),
    enabled,
  })
}

export function useMoveWorkloadMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: { cardId: string; toUserId: string | null; toWeekStart: string }) =>
      api.moveWorkloadCard(input, csrf),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['work', 'workload'] })
      void qc.invalidateQueries({ queryKey: ['work', 'workload-mine'] })
      invalidateCardSurfaces(qc, input.cardId)
    },
  })
}

// --- A11 goals -------------------------------------------------------------------------------------------

export function useGoalsQuery(enabled = true): UseQueryResult<api.Goal[], Error> {
  return useQuery({ queryKey: GOALS_KEY, queryFn: api.fetchGoals, enabled })
}

export function useCreateGoalMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: api.CreateGoalInput) => api.createGoal(input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: GOALS_KEY }),
  })
}

export function usePatchGoalMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.patchGoal>[1] }) =>
      api.patchGoal(id, patch, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: GOALS_KEY }),
  })
}

export function useDeleteGoalMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deleteGoal(id, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: GOALS_KEY }),
  })
}
