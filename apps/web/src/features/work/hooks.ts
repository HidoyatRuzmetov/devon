// React Query hooks for the work module (MODULE-GUIDE.md "Web features"): every screen in this
// feature reads/writes through these, never `api.ts` directly, so optimistic updates and cache
// invalidation live in exactly one place. Every mutation is optimistic-with-rollback (EPIC-004's own
// outcome: "every write is optimistic with rollback") -- `onMutate` patches every cache the changed
// card could appear in (the board, any cached `/cards` list, the card detail), `onError` restores the
// snapshot `onMutate` returned as `context`, and `onSettled` refetches so a concurrent edit from
// another tab/person is never permanently masked by a stale optimistic value.
import * as React from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'
import type { Board, Card, CardDetail, CardStatus, Label, SavedView } from './api.js'

/** Every mutation needs the session's CSRF token (`Me.csrfToken`, ADR-003) -- reading it here means
 * no component reaches into `useMeQuery()` just to pass a token through. Mutating with no session
 * yet loaded is a caller bug (every screen that renders a mutation trigger already required a signed
 * -in `Me`), so this throws rather than silently sending an empty header. */
export function useCsrfToken(): string {
  const me = useMeQuery().data
  if (!me) throw new Error('useCsrfToken: called with no signed-in session')
  return me.csrfToken
}

const BOARD_KEY = ['work', 'board'] as const
const CARDS_KEY = ['work', 'cards'] as const
const CARD_KEY = (id: string) => ['work', 'card', id] as const
const LABELS_KEY = ['work', 'labels'] as const
const VIEWS_KEY = ['work', 'views'] as const
const ARCHIVE_KEY = (userId: string) => ['work', 'archive', userId] as const

// Polling stands in for real-time push (TECH-SPEC's outbox worker has no client-facing WS/SSE
// transport yet -- `packages/db/src/events-worker.ts` only drives server-side subscribers). A short
// interval keeps the board's "a second browser sees it within a second" outcome true in spirit
// without inventing a transport this build doesn't have; swapping this for a subscription later
// changes nothing else in this file.
const BOARD_POLL_MS = 4000

export function useBoardQuery(): UseQueryResult<Board, Error> {
  return useQuery({ queryKey: BOARD_KEY, queryFn: api.fetchBoard, refetchInterval: BOARD_POLL_MS })
}

export function useCardsQuery(query: api.CardListQuery): UseQueryResult<Card[], Error> {
  return useQuery({
    queryKey: [...CARDS_KEY, query],
    queryFn: async () => (await api.fetchCards(query)).items,
    refetchInterval: BOARD_POLL_MS,
  })
}

export function useCardQuery(id: string | null): UseQueryResult<CardDetail, Error> {
  return useQuery({
    queryKey: CARD_KEY(id ?? ''),
    queryFn: () => api.fetchCard(id!),
    enabled: id !== null,
  })
}

export function useLabelsQuery(): UseQueryResult<Label[], Error> {
  return useQuery({ queryKey: LABELS_KEY, queryFn: api.fetchLabels })
}

export function useSavedViewsQuery(): UseQueryResult<SavedView[], Error> {
  return useQuery({ queryKey: VIEWS_KEY, queryFn: api.fetchSavedViews })
}

export function useArchiveQuery(userId: string | null) {
  return useQuery({
    queryKey: ARCHIVE_KEY(userId ?? ''),
    queryFn: () => api.fetchArchive(userId!),
    enabled: userId !== null,
  })
}

// --- shared cache-patching helpers --------------------------------------------------------------

function mapCard(card: Card, patch: Partial<Card>): Card {
  return { ...card, ...patch }
}

/** Applies `patch` to every cached copy of card `id` -- the board's columns/unassigned array, every
 * cached `/cards` list (table/timeline/calendar/mine all key off the same `CARDS_KEY` prefix with
 * different query params), and the card-detail cache if it happens to be open. Returns a snapshot
 * `rollback()` that restores exactly what was there before, for `onError`. */
function patchCardInCaches(
  qc: QueryClient,
  id: string,
  patch: Partial<Card>,
): { rollback: () => void } {
  const prevBoard = qc.getQueryData<Board>(BOARD_KEY)
  const prevCards = qc.getQueriesData<Card[]>({ queryKey: CARDS_KEY })
  const prevDetail = qc.getQueryData<CardDetail>(CARD_KEY(id))

  if (prevBoard) {
    qc.setQueryData<Board>(BOARD_KEY, {
      ...prevBoard,
      columns: prevBoard.columns.map((col) => ({
        ...col,
        cards: col.cards.map((c) => (c.id === id ? mapCard(c, patch) : c)),
      })),
      unassigned: prevBoard.unassigned.map((c) => (c.id === id ? mapCard(c, patch) : c)),
    })
  }
  qc.setQueriesData<Card[]>({ queryKey: CARDS_KEY }, (list) =>
    list ? list.map((c) => (c.id === id ? mapCard(c, patch) : c)) : list,
  )
  if (prevDetail && prevDetail.id === id) {
    qc.setQueryData<CardDetail>(CARD_KEY(id), { ...prevDetail, ...patch })
  }

  return {
    rollback: () => {
      if (prevBoard) qc.setQueryData(BOARD_KEY, prevBoard)
      for (const [key, data] of prevCards) qc.setQueryData(key, data)
      if (prevDetail) qc.setQueryData(CARD_KEY(id), prevDetail)
    },
  }
}

function invalidateCard(qc: QueryClient, id: string): void {
  void qc.invalidateQueries({ queryKey: BOARD_KEY })
  void qc.invalidateQueries({ queryKey: CARDS_KEY })
  void qc.invalidateQueries({ queryKey: CARD_KEY(id) })
}

// --- mutations -----------------------------------------------------------------------------------

export function useCreateCardMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: api.CreateCardInput) => api.createCard(input, csrf),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: BOARD_KEY })
      void qc.invalidateQueries({ queryKey: CARDS_KEY })
    },
  })
}

export function usePatchCardMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: api.PatchCardInput }) =>
      api.patchCard(id, patch, csrf),
    onMutate: ({ id, patch }) => patchCardInCaches(qc, id, patch as Partial<Card>),
    onError: (_err, _vars, context) => context?.rollback(),
    onSettled: (_data, _err, { id }) => invalidateCard(qc, id),
  })
}

/** Drag-and-drop move: reassigns a card to another member's column (or unassigned, `toUserId: null`)
 * at fractional position `orderKey`, computed by the caller (`lib/fractional.ts`) from the drop
 * target's neighbouring cards. One PATCH, optimistic exactly like `usePatchCardMutation` -- kept as
 * its own hook only because callers (the board's drop handler) never have a `version` to send and
 * always patch exactly these two fields together. */
export function useMoveCardMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({
      id,
      toUserId,
      orderKey,
    }: {
      id: string
      toUserId: string | null
      orderKey: string
    }) => api.patchCard(id, { assigneeUserId: toUserId, orderKey }, csrf),
    onMutate: ({ id, toUserId, orderKey }) =>
      patchCardInCaches(qc, id, { assigneeUserId: toUserId, orderKey }),
    onError: (_err, _vars, context) => context?.rollback(),
    onSettled: (_data, _err, { id }) => invalidateCard(qc, id),
  })
}

/** A card belonging to a project keeps `status: 'done'` (progress math on the project page counts
 * `status = 'done'` rows -- `apps/api/src/modules/projects/repo.ts`'s `getProgress`); a standalone
 * card goes straight to `'archived'` (People board and archive page both key off that exact status --
 * TECH-SPEC's "done cards leave the board into the person's archive"). Either way the card leaves the
 * active People board (`GET /board` only ever returns `status = 'active'` rows). */
export function nextDoneStatus(card: Pick<Card, 'projectScope'>): CardStatus {
  return card.projectScope === 'none' ? 'archived' : 'done'
}

export function useRestoreCardMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.restoreCard(id, csrf),
    onSuccess: (_data, id) => invalidateCard(qc, id),
  })
}

export function useToggleWatcherMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.toggleWatcher(id, csrf),
    onSuccess: (_data, id) => invalidateCard(qc, id),
  })
}

export function useAddChecklistItemMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: Parameters<typeof api.addChecklistItem>[1]) =>
      api.addChecklistItem(cardId, input, csrf),
    onSuccess: () => invalidateCard(qc, cardId),
  })
}

export function usePatchChecklistItemMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({
      itemId,
      patch,
    }: {
      itemId: string
      patch: Parameters<typeof api.patchChecklistItem>[2]
    }) => api.patchChecklistItem(cardId, itemId, patch, csrf),
    onMutate: ({ itemId, patch }) => {
      const prev = qc.getQueryData<CardDetail>(CARD_KEY(cardId))
      if (prev) {
        qc.setQueryData<CardDetail>(CARD_KEY(cardId), {
          ...prev,
          checklist: prev.checklist.map((it) =>
            it.id === itemId
              ? {
                  ...it,
                  ...patch,
                  doneAt:
                    patch.done === undefined
                      ? it.doneAt
                      : patch.done
                        ? new Date().toISOString()
                        : null,
                }
              : it,
          ),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) qc.setQueryData(CARD_KEY(cardId), context.prev)
    },
    onSettled: () => invalidateCard(qc, cardId),
  })
}

export function useDeleteChecklistItemMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (itemId: string) => api.deleteChecklistItem(cardId, itemId, csrf),
    onSuccess: () => invalidateCard(qc, cardId),
  })
}

export function useAddCommentMutation(cardId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: { text: string; mentions?: string[] }) =>
      api.addComment(cardId, input, csrf),
    onSuccess: () => invalidateCard(qc, cardId),
  })
}

export function useCreateLabelMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: { name: string; colour?: string }) => api.createLabel(input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: LABELS_KEY }),
  })
}

export function useCreateSavedViewMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createSavedView>[0]) =>
      api.createSavedView(input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: VIEWS_KEY }),
  })
}

export function useDeleteSavedViewMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deleteSavedView(id, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: VIEWS_KEY }),
  })
}

export function useUnfurlMutation() {
  const csrf = useCsrfToken()
  return useMutation({ mutationFn: (url: string) => api.unfurlLink(url, csrf) })
}

/** Every member of the current department, from the board's own roster -- the one source every
 * member-picker (assignee, giver, watcher, quick-add resolution) reads, so a screen that only needs
 * the roster never issues its own `/board` fetch. */
export function useMembers(): api.MemberSummary[] {
  const board = useBoardQuery().data
  return React.useMemo(() => board?.members ?? [], [board])
}
