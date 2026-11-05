import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { toast } from '@devon/ui'
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import { useIsLive } from '../../lib/realtime/index.js'
import { checklistItemSchema, commentSchema } from './api.js'
import { useCsrfToken } from './hooks.js'

function commentPath(cardId: string, itemId: string) {
  return `/api/v1/cards/${encodeURIComponent(cardId)}/checklist/${encodeURIComponent(itemId)}/comments`
}

export function useChecklistComments(cardId: string, itemId: string, enabled: boolean) {
  const live = useIsLive()
  return useQuery({
    queryKey: ['work', 'checklist-comments', cardId, itemId],
    queryFn: () => apiClient.get(commentPath(cardId, itemId), z.array(commentSchema)),
    enabled,
    refetchInterval: enabled && !live ? 4000 : false,
  })
}

type CommentChange =
  | { kind: 'add'; text: string; mentions?: string[] }
  | { kind: 'edit'; id: string; text: string; editedAt: string | null; mentions?: string[] }
  | { kind: 'delete'; id: string }

export function useChecklistCommentChange(cardId: string, itemId: string) {
  const csrf = useCsrfToken()
  const qc = useQueryClient()
  const t = useT()
  return useMutation({
    mutationKey: ['work', 'checklist-comment-write', cardId, itemId],
    mutationFn: async (change: CommentChange): Promise<void> => {
      const path = commentPath(cardId, itemId)
      if (change.kind === 'add') {
        await apiClient.post(
          path,
          { text: change.text, mentions: change.mentions ?? [] },
          z.object({ id: z.string() }),
          csrf,
        )
        return
      }
      if (change.kind === 'edit') {
        await apiClient.patch(
          `${path}/${encodeURIComponent(change.id)}`,
          {
            text: change.text,
            editedAt: change.editedAt,
            mentions: change.mentions ?? [],
          },
          z.void(),
          csrf,
        )
        return
      }
      await apiClient.delete(`${path}/${encodeURIComponent(change.id)}`, csrf)
    },
    onError: () => toast.error(t('checklistDiscussion.saveError')),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['work'] }),
        qc.invalidateQueries({ queryKey: ['checkins'] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  })
}

/** Project tasks display their children together; fetch those children in one request. */
export function useChecklistBatch(cardIds: string[]) {
  const ids = [...cardIds].sort()
  const live = useIsLive()
  const writes = useIsMutating({ mutationKey: ['work', 'checklist'] })
  return useQuery({
    queryKey: ['work', 'checklist-batch', ids],
    queryFn: async () => {
      const chunks: string[][] = []
      for (let offset = 0; offset < ids.length; offset += 100)
        chunks.push(ids.slice(offset, offset + 100))
      const results = await Promise.all(
        chunks.map((chunk) =>
          apiClient.get(
            `/api/v1/cards/checklists?${new URLSearchParams({ cardIds: chunk.join(',') })}`,
            z.array(checklistItemSchema),
          ),
        ),
      )
      return results.flat()
    },
    enabled: ids.length > 0,
    refetchInterval: !live && !writes && ids.length ? 4000 : false,
  })
}
