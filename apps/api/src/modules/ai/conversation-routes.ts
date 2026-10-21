import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { subscribe, type RequestContext } from '@devon/db'
import { z } from 'zod'
import {
  aiConversationSchema,
  aiConversationsSchema,
  createAiConversationSchema,
  sendAiChatMessageSchema,
  cancelAiChatMessageSchema,
  type Subject,
} from '@devon/contracts'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextDepartmentRole } from '../../lib/actor.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import * as conversations from './conversations.js'
import { enqueueConversation, startConversationJobs } from './conversation-jobs.js'

const subject = (req: FastifyRequest): Subject => ({
  kind: 'department_managed',
  departmentId: req.actor?.departmentId ?? '',
})
const params = z.object({ id: z.uuid() })
function context(req: FastifyRequest): RequestContext {
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    departmentId: req.actor?.departmentId ?? null,
    departmentRole: contextDepartmentRole(req.actor, req.actor?.departmentId ?? null),
    actingForUserId: null,
    viewAs: req.actor?.viewAs != null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}
const routes: FastifyPluginAsyncZod = async (app) => {
  // The transactional outbox closes the save-before-enqueue crash window. A duplicate direct
  // enqueue is harmless: the saved turn and its worker token make processing idempotent.
  const unsubscribe = subscribe('ai.conversation.requested', async (event) => {
    const payload = z
      .object({ conversationId: z.uuid(), userId: z.uuid(), messageId: z.uuid() })
      .parse(event.payload)
    if (!event.departmentId) return
    await enqueueConversation({ ...payload, departmentId: event.departmentId })
  })
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof conversations.ConversationError)
      return sendProblem(reply, error.code, {
        errors: [{ path: 'conversation', code: error.reason }],
      })
    throw error
  })
  app.get(
    '/conversations',
    {
      config: { permission: { action: 'read', subject } },
      schema: {
        querystring: z.object({
          before: z.string().min(1).max(300).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(30),
        }),
        response: { 200: aiConversationsSchema },
      },
    },
    (req) => conversations.listConversations(context(req), req.query.before, req.query.limit),
  )
  app.post(
    '/conversations',
    {
      config: {
        permission: { action: 'create', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { body: createAiConversationSchema, response: { 200: aiConversationSchema } },
    },
    (req, reply) => {
      if (!checkCsrf(req, reply)) return
      return conversations.createConversation(context(req), req.body)
    },
  )
  app.get(
    '/conversations/:id',
    {
      config: { permission: { action: 'read', subject } },
      schema: { params, response: { 200: aiConversationSchema } },
    },
    (req) => conversations.getConversation(context(req), req.params.id),
  )
  app.post(
    '/conversations/:id/messages',
    {
      config: {
        permission: { action: 'create', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        params,
        body: sendAiChatMessageSchema,
        response: { 200: aiConversationSchema, 202: aiConversationSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ctx = context(req)
      const result = await conversations.submitConversationMessage(ctx, req.params.id, req.body)
      if (result.job) {
        try {
          await enqueueConversation(result.job)
        } catch {
          await conversations.failConversationEnqueue(ctx, req.params.id, req.body.id)
          return conversations.getConversation(ctx, req.params.id)
        }
      }
      if (result.conversation.status === 'running') reply.code(202)
      return result.conversation
    },
  )
  app.post(
    '/conversations/:id/cancel',
    {
      config: { permission: { action: 'update', subject } },
      schema: { params, body: cancelAiChatMessageSchema, response: { 200: aiConversationSchema } },
    },
    (req, reply) => {
      if (!checkCsrf(req, reply)) return
      return conversations.cancelConversationMessage(
        context(req),
        req.params.id,
        req.body.messageId,
      )
    },
  )
  let jobs: Awaited<ReturnType<typeof startConversationJobs>> = null
  app.addHook('onReady', async () => {
    if (app.devonConfig.NODE_ENV !== 'test')
      jobs = await startConversationJobs(app.devonConfig.DATABASE_URL, app.log)
  })
  app.addHook('onClose', async () => {
    unsubscribe()
    if (jobs) await jobs.stop()
    jobs = null
  })
}
export default routes
