import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { aiConversationSchema, aiConversationsSchema, type AiConversation } from '@devon/contracts'
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
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 3_000 : false),
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
    mutationFn: (input: { conversationId: string; id: string; content: string }) =>
      apiClient.post(
        `${BASE}/${input.conversationId}/messages`,
        {
          id: input.id,
          content: input.content,
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
