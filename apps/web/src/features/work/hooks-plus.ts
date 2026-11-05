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
import type { Board, Card, CardDetail } from './api.js'
import { fetchDependencyCandidates } from './dependency-candidates.js'
import { finishWorkWrite, patchCardInCaches, useCsrfToken } from './hooks.js'
import { useMeQuery } from '../../lib/session.js'

// Key prefixes. `['work', ...]` throughout, so `hooks.ts`'s own invalidations and these never
// collide but can still be cleared together when a department switch invalidates everything.
const DEPENDENCIES_KEY = (cardId: string) => ['work', 'dependencies', cardId] as const
const DEPENDENCY_GRAPH_KEY = ['work', 'dependency-graph'] as const
const DEPENDENCY_CANDIDATES_KEY = ['work', 'dependency-candidates'] as const
const TIME_LOG_KEY = (cardId: string) => ['work', 'time-log', cardId] as const
const REMINDERS_KEY = (cardId: string) => ['work', 'reminders', cardId] as const
const TEMPLATES_KEY = (kind?: string) => ['work', 'templates', kind ?? 'all'] as const
const FOCUS_KEY = ['work', 'focus'] as const

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
    staleTime: 0,
  })
}

/** Local title matching requires every page. Refetch on each open, without polling closed pickers. */
export function useDependencyCandidatesQuery(enabled: boolean): UseQueryResult<Card[], Error> {
  return useQuery({
    queryKey: DEPENDENCY_CANDIDATES_KEY,
    queryFn: fetchDependencyCandidates,
    enabled,
    staleTime: 0,
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

// --- 7.2 templates -------------------------------------------------------------------------------------

export function useWorkTemplatesQuery(
  kind?: 'card' | 'project',
): UseQueryResult<api.WorkTemplate[], Error> {
  return useQuery({
    queryKey: TEMPLATES_KEY(kind),
    queryFn: () => api.fetchWorkTemplates(kind),
  })
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
  return useQuery({ queryKey: FOCUS_KEY, queryFn: () => api.fetchFocusList() })
}

function cachedCard(qc: QueryClient, cardId: string): api.FocusPin['card'] | undefined {
  const board = qc.getQueryData<Board>(BOARD_KEY)
  return (
    qc.getQueryData<CardDetail>(CARD_KEY(cardId)) ??
    [...(board?.columns.flatMap((col) => col.cards) ?? []), ...(board?.unassigned ?? [])].find(
      (card) => card.id === cardId,
    ) ??
    qc
      .getQueriesData<Card[]>({ queryKey: CARDS_KEY })
      .flatMap(([, cards]) => cards ?? [])
      .find((card) => card.id === cardId) ??
    qc.getQueryData<api.FocusList>(FOCUS_KEY)?.items.find((pin) => pin.cardId === cardId)?.card
  )
}

/** The viewer's pin and the assignee's pin are the same row only for their own task. */
function selfPinPatch(
  qc: QueryClient,
  cardId: string,
  viewerId: string | undefined,
  pinned: boolean,
): Partial<Card> {
  return {
    focusPinned: pinned,
    focusPosition: pinned ? -1 : null,
    ...(viewerId && cachedCard(qc, cardId)?.assigneeUserId === viewerId
      ? { assigneePinned: pinned, assigneePinPosition: pinned ? -1 : null }
      : {}),
  }
}

/** Head assignment of a pin uses the same domain operation and cache invalidation as self pinning. */
export function usePersonPinMutation(userId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const viewerId = useMeQuery().data?.user.id
  return useMutation({
    mutationKey: ['work', 'card-write', 'person-pin', userId],
    scope: { id: `work-focus-${userId}` },
    mutationFn: ({ cardId, pinned }: { cardId: string; pinned: boolean }) =>
      pinned ? api.addFocusPin(cardId, csrf, userId) : api.removeFocusPin(cardId, csrf, userId),
    onMutate: async ({ cardId, pinned }) => {
      await qc.cancelQueries({ queryKey: ['work'] })
      return patchCardInCaches(qc, cardId, {
        assigneePinned: pinned,
        assigneePinPosition: pinned ? -1 : null,
        ...(userId === viewerId ? { focusPinned: pinned, focusPosition: pinned ? -1 : null } : {}),
      })
    },
    onError: (_error, _variables, context) => context?.rollback(),
    onSettled: () => finishWorkWrite(qc),
  })
}

export function useAddFocusMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const viewerId = useMeQuery().data?.user.id
  return useMutation({
    mutationKey: ['work', 'card-write', 'focus'],
    scope: { id: 'work-focus' },
    mutationFn: (cardId: string) => api.addFocusPin(cardId, csrf),
    onMutate: async (cardId) => {
      await qc.cancelQueries({ queryKey: ['work'] })
      const previous = qc.getQueryData<api.FocusList>(FOCUS_KEY)
      const already = previous?.items.some((pin) => pin.cardId === cardId) ?? false
      const card = cachedCard(qc, cardId)
      if (previous && card && !already) {
        qc.setQueryData<api.FocusList>(FOCUS_KEY, {
          ...previous,
          items: [
            { cardId, position: 0, card },
            ...previous.items.map((pin) => ({
              ...pin,
              position: pin.position + 1,
            })),
          ],
        })
      }
      const context = patchCardInCaches(qc, cardId, selfPinPatch(qc, cardId, viewerId, true))
      return { ...context, already }
    },
    onError: (_err, cardId, context) => {
      context?.rollback()
      if (!context?.already)
        qc.setQueryData<api.FocusList>(FOCUS_KEY, (current) =>
          current
            ? {
                ...current,
                items: current.items.filter((pin) => pin.cardId !== cardId),
              }
            : current,
        )
    },
    onSettled: () => finishWorkWrite(qc),
  })
}

export function useRemoveFocusMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  const viewerId = useMeQuery().data?.user.id
  return useMutation({
    mutationKey: ['work', 'card-write', 'focus'],
    scope: { id: 'work-focus' },
    mutationFn: (cardId: string) => api.removeFocusPin(cardId, csrf),
    onMutate: async (cardId) => {
      await qc.cancelQueries({ queryKey: ['work'] })
      const previous = qc
        .getQueryData<api.FocusList>(FOCUS_KEY)
        ?.items.find((pin) => pin.cardId === cardId)
      qc.setQueryData<api.FocusList>(FOCUS_KEY, (current) =>
        current
          ? {
              ...current,
              items: current.items.filter((pin) => pin.cardId !== cardId),
            }
          : current,
      )
      return {
        ...patchCardInCaches(qc, cardId, selfPinPatch(qc, cardId, viewerId, false)),
        previous,
      }
    },
    onError: (_err, _cardId, context) => {
      context?.rollback()
      if (context?.previous)
        qc.setQueryData<api.FocusList>(FOCUS_KEY, (current) =>
          current
            ? {
                ...current,
                items: [...current.items, context.previous!].sort(
                  (a, b) => a.position - b.position,
                ),
              }
            : current,
        )
    },
    onSettled: () => finishWorkWrite(qc),
  })
}

/** Reordering is optimistic: the pin moves under the pointer and stays there, because a list
 * that snaps back after a round trip feels broken even when the write succeeded. */
export function useReorderFocusMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationKey: ['work', 'card-write', 'focus'],
    scope: { id: 'work-focus' },
    mutationFn: (cardIds: string[]) => api.reorderFocusList(cardIds, csrf),
    onMutate: async (cardIds) => {
      await qc.cancelQueries({ queryKey: ['work'] })
      const previous = qc.getQueryData<api.FocusList>(FOCUS_KEY)
      if (previous) {
        const byId = new Map(previous.items.map((pin) => [pin.cardId, pin]))
        const reordered = cardIds
          .map((id, index) => {
            const pin = byId.get(id)
            return pin ? { ...pin, position: index } : null
          })
          .filter((pin): pin is api.FocusPin => pin !== null)
        qc.setQueryData<api.FocusList>(FOCUS_KEY, {
          ...previous,
          items: reordered,
        })
        for (const pin of reordered)
          patchCardInCaches(qc, pin.cardId, { focusPosition: pin.position })
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(FOCUS_KEY, context.previous)
      for (const pin of context?.previous?.items ?? [])
        patchCardInCaches(qc, pin.cardId, { focusPosition: pin.position })
    },
    onSettled: () => finishWorkWrite(qc),
  })
}
