import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  aiChatAttachmentSchema,
  aiConversationSchema,
  aiConversationsSchema,
  type AiChatAttachment,
  type AiConversation,
} from '@devon/contracts'
import { z } from 'zod'
import type { Locale } from '@devon/i18n'
import { apiClient } from '../../lib/api-client.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'

const BASE = '/api/v1/ai/conversations'

function useConversationScope() {
  const { data: me } = useMeQuery()
  const { departmentId: department } = useDepartment()
  return {
    key: ['ai', 'conversations', me?.user.id, department, me?.actingForUserId] as const,
    enabled: Boolean(me && department),
    csrf: me?.csrfToken ?? '',
  }
}

export function useConversationsQuery(enabled: boolean) {
  const scope = useConversationScope()
  return useInfiniteQuery({
    queryKey: [...scope.key, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiClient.get(
        pageParam ? `${BASE}?before=${encodeURIComponent(pageParam)}` : BASE,
        aiConversationsSchema,
      ),
    getNextPageParam: (page) => page.nextCursor,
    enabled: enabled && scope.enabled,
    staleTime: 15_000,
  })
}

export function useConversationQuery(id: string | null) {
  const scope = useConversationScope()
  return useQuery({
    queryKey: [...scope.key, id],
    queryFn: () => apiClient.get(`${BASE}/${id}`, aiConversationSchema),
    enabled: scope.enabled && Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ||
      query.state.data?.messages.some((message) =>
        message.proposals?.some((proposal) => proposal.status === 'executing'),
      )
        ? 3_000
        : false,
  })
}

export function useCreateConversationMutation() {
  const scope = useConversationScope()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; locale: Locale; seedBriefing: boolean }) =>
      apiClient.post(BASE, input, aiConversationSchema, scope.csrf),
    onSuccess: (conversation) => {
      qc.setQueryData([...scope.key, conversation.id], conversation)
      void qc.invalidateQueries({ queryKey: [...scope.key, 'list'] })
    },
  })
}

export function useSendConversationMessageMutation() {
  const scope = useConversationScope()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      conversationId: string
      id: string
      content: string
      attachmentIds?: string[]
      attachments?: AiChatAttachment[]
    }) =>
      apiClient.post(
        `${BASE}/${input.conversationId}/messages`,
        {
          id: input.id,
          content: input.content,
          attachmentIds: input.attachmentIds ?? [],
        },
        aiConversationSchema,
        scope.csrf,
      ),
    onMutate: async (input) => {
      const key = [...scope.key, input.conversationId]
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<AiConversation>(key, (current) =>
        current
          ? {
              ...current,
              status: 'running',
              messages: [
                ...current.messages.filter((message) => message.id !== input.id),
                {
                  id: input.id,
                  role: 'user',
                  content: input.content,
                  status: 'pending',
                  createdAt: new Date().toISOString(),
                  error: null,
                  sources: [],
                  context: null,
                  attachments: input.attachments ?? [],
                },
              ],
            }
          : current,
      )
    },
    onSuccess: (conversation) => qc.setQueryData([...scope.key, conversation.id], conversation),
    onSettled: (_data, _error, input) => {
      // If a transport fails after the server accepted the turn, this GET resumes the saved run.
      void qc.invalidateQueries({ queryKey: [...scope.key, input.conversationId] })
      void qc.invalidateQueries({ queryKey: [...scope.key, 'list'] })
      void qc.invalidateQueries({ queryKey: ['ai', 'settings'] })
    },
  })
}

/** A proposal is a saved, server-authorized operation. The browser never executes model-supplied
 * URLs or JavaScript; it can only confirm or discard the opaque proposal ID. */
export function useConversationProposalMutation(action: 'execute' | 'discard') {
  const scope = useConversationScope()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { conversationId: string; proposalId: string }) =>
      apiClient.post(
        `${BASE}/${encodeURIComponent(input.conversationId)}/proposals/${encodeURIComponent(input.proposalId)}/${action}`,
        {},
        aiConversationSchema,
        scope.csrf,
      ),
    onSuccess: (conversation) => {
      qc.setQueryData([...scope.key, conversation.id], conversation)
      void qc.invalidateQueries({ queryKey: [...scope.key, 'list'] })
      if (action === 'execute') {
        for (const key of [
          'work',
          'projects',
          'pages',
          'events',
          'analytics',
          'personal',
          'structure',
          'inbox',
        ])
          void qc.invalidateQueries({ queryKey: [key] })
      }
    },
    onSettled: (_data, _error, input) => {
      // A lost acknowledgement must be reconciled before another click; the server owns the
      // idempotency guard and only the persisted executed state is shown as success.
      void qc.invalidateQueries({ queryKey: [...scope.key, input.conversationId] })
    },
  })
}

const chatUploadSchema = z.object({
  uploadId: z.string(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
})
export type ChatUploadTransfer = { file: File; signed: z.infer<typeof chatUploadSchema> }
export function useConversationUploadMutation() {
  const scope = useConversationScope()
  return useMutation({
    mutationFn: async (input: {
      conversationId: string
      file: File
      signal: AbortSignal
      transfer?: ChatUploadTransfer
      finalizeId?: string
      onTransfer: (transfer: ChatUploadTransfer) => void
      onScanning: (id: string) => void
    }): Promise<AiChatAttachment | 'approval'> => {
      const base = `${BASE}/${encodeURIComponent(input.conversationId)}/attachments`
      input.signal.throwIfAborted()
      if (input.finalizeId) {
        input.onScanning(input.finalizeId)
        return apiClient.post(
          `${base}/${encodeURIComponent(input.finalizeId)}/finalize`,
          {},
          aiChatAttachmentSchema,
          scope.csrf,
        )
      }
      let transfer = input.transfer
      if (!transfer) {
        const signed = await apiClient.post(
          `${base}/upload-url`,
          { name: input.file.name, size: input.file.size },
          z.union([chatUploadSchema, z.object({ approvalRequired: z.literal(true) })]),
          scope.csrf,
        )
        if ('approvalRequired' in signed) return 'approval'
        transfer = { file: input.file, signed }
        input.onTransfer(transfer)
      }
      input.signal.throwIfAborted()
      await apiClient.uploadFile(transfer.signed.url, {
        method: transfer.signed.method,
        headers: transfer.signed.headers,
        body: transfer.file,
        signal: input.signal,
      })
      input.signal.throwIfAborted()
      input.onScanning(transfer.signed.uploadId)
      return apiClient.post(
        `${base}/${encodeURIComponent(transfer.signed.uploadId)}/finalize`,
        {},
        aiChatAttachmentSchema,
        scope.csrf,
      )
    },
  })
}

export function useCancelConversationMessageMutation() {
  const scope = useConversationScope()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { conversationId: string; messageId: string }) =>
      apiClient.post(
        `${BASE}/${input.conversationId}/cancel`,
        {
          messageId: input.messageId,
        },
        aiConversationSchema,
        scope.csrf,
      ),
    onSuccess: (conversation) => {
      qc.setQueryData([...scope.key, conversation.id], conversation)
      void qc.invalidateQueries({ queryKey: [...scope.key, 'list'] })
    },
  })
}
