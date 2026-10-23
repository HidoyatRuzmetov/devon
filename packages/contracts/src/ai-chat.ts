import { z } from 'zod'

export const AI_CHAT_MESSAGE_MAX = 4000
export const aiChatAttachmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mime: z.string(),
  size: z.number().nonnegative(),
  downloadPath: z.string().startsWith('/').optional(),
})
export const aiChatProposalSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'executing', 'executed', 'discarded', 'failed', 'expired']),
  result: z.object({ href: z.string().startsWith('/'), label: z.string() }).optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
})
export const aiChatSourceSchema = z.object({
  ref: z.string(),
  title: z.string(),
  href: z.string().startsWith('/'),
})
export const aiChatContextSchema = z.object({
  generatedAt: z.string(),
  recordsIncluded: z.number().int().nonnegative(),
  recordsTotal: z.number().int().nonnegative(),
  historyMessages: z.number().int().nonnegative(),
  limited: z.boolean(),
})
export const aiChatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
  status: z.enum(['complete', 'pending', 'failed', 'cancelled']),
  error: z.string().nullable(),
  sources: z.array(aiChatSourceSchema),
  context: aiChatContextSchema.nullable(),
  attachments: z.array(aiChatAttachmentSchema).optional(),
  proposals: z.array(aiChatProposalSchema).optional(),
})
export const aiConversationSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  locale: z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number().int().nonnegative(),
  status: z.enum(['ready', 'running']),
})
export const aiConversationSchema = aiConversationSummarySchema.extend({
  messages: z.array(aiChatMessageSchema),
})
export const aiConversationsSchema = z.object({
  conversations: z.array(aiConversationSummarySchema),
  nextCursor: z.string().nullable(),
})
export const createAiConversationSchema = z
  .object({
    id: z.uuid(),
    locale: z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']),
    seedBriefing: z.boolean().default(true),
  })
  .strict()
export const sendAiChatMessageSchema = z
  .object({
    id: z.uuid(),
    content: z.string().trim().min(1).max(AI_CHAT_MESSAGE_MAX),
    attachmentIds: z.array(z.uuid()).max(10).default([]),
  })
  .strict()
export const cancelAiChatMessageSchema = z.object({ messageId: z.uuid() }).strict()
export type AiChatSource = z.infer<typeof aiChatSourceSchema>
export type AiChatContext = z.infer<typeof aiChatContextSchema>
export type AiChatMessage = z.infer<typeof aiChatMessageSchema>
export type AiConversationSummary = z.infer<typeof aiConversationSummarySchema>
export type AiConversation = z.infer<typeof aiConversationSchema>
export type AiChatProposal = z.infer<typeof aiChatProposalSchema>
export type AiChatAttachment = z.infer<typeof aiChatAttachmentSchema>
