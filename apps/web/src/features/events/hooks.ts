// React Query hooks wrapping `api.ts` (MODULE-GUIDE.md "Web features"). One cache key family per
// resource so a mutation's `invalidateQueries` stays precise -- a new comment never refetches the
// whole event list, a new RSVP never refetches every event's comments.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api-schemas.js'
import * as api from './api.js'
import type { EventDto, RsvpStatus } from './schemas.js'

/** Every mutation below needs the signed-in user's CSRF token, read from the same cached `/me`
 * response the shell already holds (never a second network call) -- the identical pattern
 * `useLocaleMutation` uses in `lib/session.ts`. */
export function useCsrfToken(): string {
  const queryClient = useQueryClient()
  const me = queryClient.getQueryData<Me | null>(['me'])
  return me?.csrfToken ?? ''
}

const keys = {
  list: (range: api.EventRange) =>
    ['events', 'list', range.from?.toISOString(), range.to?.toISOString()] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  rsvps: (id: string) => ['events', 'rsvps', id] as const,
  comments: (id: string) => ['events', 'comments', id] as const,
  carpools: (id: string) => ['events', 'carpools', id] as const,
  items: (id: string) => ['events', 'items', id] as const,
  polls: (id: string) => ['events', 'polls', id] as const,
  photos: (id: string) => ['events', 'photos', id] as const,
  feedback: (id: string) => ['events', 'feedback', id] as const,
}

export function useEventsQuery(range: api.EventRange = {}) {
  return useQuery({ queryKey: keys.list(range), queryFn: () => api.fetchEvents(range) })
}

/** H5.2 "prefetch on hover/focus" -- `nav.ts` calls this on the "Tadbirlar" sidebar entry's hover/
 * focus, matching `useEventsQuery()`'s own default (empty) range exactly so the warmed cache entry
 * is the same one `events-screen.tsx` reads on mount, not a near-miss under a different key. */
export function prefetchEvents(qc: QueryClient): Promise<unknown> {
  const range: api.EventRange = {}
  return qc.prefetchQuery({ queryKey: keys.list(range), queryFn: () => api.fetchEvents(range) })
}

export function useEventQuery(eventId: string | null) {
  return useQuery({
    queryKey: keys.detail(eventId ?? ''),
    queryFn: () => api.fetchEvent(eventId!),
    enabled: eventId !== null,
  })
}

function useInvalidateEvent(eventId: string) {
  const queryClient = useQueryClient()
  return React.useCallback(
    (...extra: (readonly unknown[])[]) => {
      void queryClient.invalidateQueries({ queryKey: ['events', 'list'] })
      void queryClient.invalidateQueries({ queryKey: keys.detail(eventId) })
      for (const key of extra) void queryClient.invalidateQueries({ queryKey: key })
    },
    [queryClient, eventId],
  )
}

export function useCreateEventMutation() {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: api.CreateEventInput) => api.createEvent(input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['events', 'list'] }),
  })
}

export function useUpdateEventMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const invalidate = useInvalidateEvent(eventId)
  return useMutation({
    mutationFn: (input: api.UpdateEventInput) => api.updateEvent(eventId, input, csrfToken),
    onSuccess: () => invalidate(),
  })
}

export function useCancelEventMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const invalidate = useInvalidateEvent(eventId)
  return useMutation({
    mutationFn: (reason: string) => api.cancelEvent(eventId, reason, csrfToken),
    onSuccess: () => invalidate(),
  })
}

/** Patches `myRsvp` on every cached copy of this event -- the single `keys.detail(eventId)` entry
 * `event-detail-dialog.tsx`/`RsvpPanel` read, and every `keys.list(range)` array `events-screen.tsx`
 * (and any calendar-range query) holds, since `event-card.tsx` reads `event.myRsvp` straight off the
 * list item. Returns the previous values so the caller can restore them on failure -- the same
 * snapshot-then-restore shape `work/hooks.ts`'s `patchCardInCaches` already established for cards. */
function patchMyRsvpInCaches(
  qc: ReturnType<typeof useQueryClient>,
  eventId: string,
  myRsvp: EventDto['myRsvp'],
) {
  const detailKey = keys.detail(eventId)
  const prevDetail = qc.getQueryData<EventDto>(detailKey)
  if (prevDetail) qc.setQueryData<EventDto>(detailKey, { ...prevDetail, myRsvp })

  const prevLists = qc.getQueriesData<{ items: EventDto[] }>({ queryKey: ['events', 'list'] })
  for (const [key, data] of prevLists) {
    if (!data) continue
    qc.setQueryData(key, {
      ...data,
      items: data.items.map((e) => (e.id === eventId ? { ...e, myRsvp } : e)),
    })
  }
  return { prevDetail, prevLists }
}

/** H5.1 "optimistic updates for ... RSVP; rollback on failure with toast" -- `myRsvp` updates the
 * instant "Going"/"Not going" is submitted, everywhere it is shown (the detail panel, the card grid,
 * the calendar), rather than only after the round trip; a failure restores every patched cache
 * exactly (`onError`), and `onSettled` re-syncs with the server regardless of outcome so a
 * concurrent RSVP change (a capacity limit flipping "yes" to "waitlist" server-side, say) is never
 * masked by a stale optimistic value -- same reasoning `work/hooks.ts`'s own mutations document. */
export function useRsvpMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const qc = useQueryClient()
  const invalidate = useInvalidateEvent(eventId)
  return useMutation({
    mutationFn: (input: { status: string; guests: number; note?: string | undefined }) =>
      api.submitRsvp(eventId, input, csrfToken),
    onMutate: (input) =>
      patchMyRsvpInCaches(qc, eventId, {
        status: input.status as RsvpStatus,
        guests: input.guests,
        note: input.note ?? null,
      }),
    onError: (_err, _input, context) => {
      if (context?.prevDetail) qc.setQueryData(keys.detail(eventId), context.prevDetail)
      if (context?.prevLists)
        for (const [key, data] of context.prevLists) qc.setQueryData(key, data)
    },
    onSettled: () => invalidate(keys.rsvps(eventId)),
  })
}

export function useRsvpsQuery(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.rsvps(eventId),
    queryFn: () => api.fetchRsvps(eventId),
    enabled,
  })
}

export function useCommentsQuery(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.comments(eventId),
    queryFn: () => api.fetchComments(eventId),
    enabled,
  })
}

export function useAddCommentMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => api.addComment(eventId, body, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.comments(eventId) }),
  })
}

export function useDeleteCommentMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => api.deleteComment(eventId, commentId, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.comments(eventId) }),
  })
}

export function useCarpoolsQuery(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.carpools(eventId),
    queryFn: () => api.fetchCarpools(eventId),
    enabled,
  })
}

export function useCreateCarpoolMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: api.CarpoolInput) => api.createCarpool(eventId, input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.carpools(eventId) }),
  })
}

export function useClaimCarpoolSeatMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ carpoolId, seats }: { carpoolId: string; seats: number }) =>
      api.claimCarpoolSeat(eventId, carpoolId, seats, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.carpools(eventId) }),
  })
}

export function useReleaseCarpoolSeatMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (carpoolId: string) => api.releaseCarpoolSeat(eventId, carpoolId, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.carpools(eventId) }),
  })
}

export function useItemsQuery(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.items(eventId),
    queryFn: () => api.fetchItems(eventId),
    enabled,
  })
}

export function useAddItemMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { label: string; quantity: number }) =>
      api.addItem(eventId, input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.items(eventId) }),
  })
}

export function useClaimItemMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) => api.claimItem(eventId, itemId, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.items(eventId) }),
  })
}

export function useReleaseItemMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) => api.releaseItem(eventId, itemId, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.items(eventId) }),
  })
}

export function usePollsQuery(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.polls(eventId),
    queryFn: () => api.fetchPolls(eventId),
    enabled,
  })
}

export function useCreatePollMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: api.PollInput) => api.createPoll(eventId, input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.polls(eventId) }),
  })
}

export function useVoteOnPollMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pollId, optionIds }: { pollId: string; optionIds: string[] }) =>
      api.voteOnPoll(eventId, pollId, optionIds, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.polls(eventId) }),
  })
}

export function usePhotosQuery(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.photos(eventId),
    queryFn: () => api.fetchPhotos(eventId),
    enabled,
  })
}

export function useAddPhotoMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { url: string; caption?: string | undefined }) =>
      api.addPhoto(eventId, input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.photos(eventId) }),
  })
}

export function useDeletePhotoMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (photoId: string) => api.deletePhoto(eventId, photoId, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.photos(eventId) }),
  })
}

export function useFeedbackQuery(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.feedback(eventId),
    queryFn: () => api.fetchFeedback(eventId),
    enabled,
  })
}

export function useSubmitFeedbackMutation(eventId: string) {
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { rating: number; comment?: string | undefined; anonymous: boolean }) =>
      api.submitFeedback(eventId, input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.feedback(eventId) }),
  })
}
