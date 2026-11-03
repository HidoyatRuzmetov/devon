import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { User } from 'grammy/types'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { withTimeout } from '../../lib/resilience/timeout.js'
import { contextFromRequest } from '../work/context.js'
import { extractAllMessage, mentionMessages } from './group-mentions.js'
import { mentionCandidateIds } from './group-mentions-repo.js'
import { listGroupsForDepartment } from './repo.js'
import { getBot, sendMentionMessage } from './transport.js'

export const groupMessageSchema = z
  .object({
    groupId: z.uuid().optional(),
    message: z.string().trim().min(1).max(3500),
    mentionAll: z.boolean().default(false),
  })
  .strict()

/** Claim before contacting Telegram. An ambiguous transport failure is never automatically resent. */
export async function sendDepartmentMessage(
  ctx: RequestContext,
  input: z.infer<typeof groupMessageSchema>,
  operationId: string,
) {
  if (!ctx.userId || !ctx.departmentId || ctx.departmentRole !== 'head' || ctx.viewAs)
    return { error: 'forbidden' as const }
  const groups = await listGroupsForDepartment(ctx.departmentId)
  const group = input.groupId
    ? groups.find((item) => item.id === input.groupId)
    : groups.length === 1
      ? groups[0]
      : undefined
  if (!group) return { error: 'validation_failed' as const }
  const bot = getBot()
  if (!bot) return { error: 'conflict' as const }
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...input, groupId: group.id }))
    .digest('hex')
  const claimed = await withContext(ctx, async (tx) => {
    const inserted =
      await tx.raw(sql`insert into app.telegram_message_receipts(department_id,operation_id,group_id,message_hash)
      values(${ctx.departmentId},${operationId},${group.id},${hash}) on conflict do nothing returning operation_id`)
    if (inserted.length) return { fresh: true, status: 'sending', recipients: 0, hash }
    const [row] = await tx.raw<{ status: string; recipients: number; hash: string }>(
      sql`select status,recipients,message_hash as hash from app.telegram_message_receipts where department_id=${ctx.departmentId} and operation_id=${operationId}`,
    )
    return row ? { ...row, fresh: false } : null
  })
  if (!claimed || claimed.hash !== hash) return { error: 'conflict' as const }
  if (!claimed.fresh)
    return claimed.status === 'sent'
      ? { recipients: claimed.recipients }
      : { error: 'conflict' as const }
  let recipients = 0,
    success = false
  try {
    const allText = extractAllMessage(input.message)
    const people: User[] = []
    if (input.mentionAll || allText !== null) {
      const me = await withTimeout(bot.api.getMe(), 8000, 'telegram bot identity')
      const own = await withTimeout(
        bot.api.getChatMember(group.chatId, me.id),
        8000,
        'telegram membership',
      )
      if (!['creator', 'administrator'].includes(own.status)) throw new Error('bot_admin_required')
      const admins = await withTimeout(
        bot.api.getChatAdministrators(group.chatId),
        8000,
        'telegram administrators',
      )
      const ids = [
        ...new Set([
          ...(await mentionCandidateIds(group.id, ctx.departmentId)),
          ...admins.map((member) => member.user.id),
        ]),
      ]
      for (let start = 0; start < ids.length; start += 5) {
        const members = await Promise.all(
          ids
            .slice(start, start + 5)
            .map((id) =>
              withTimeout(
                bot.api.getChatMember(group.chatId, id),
                8000,
                'telegram membership',
              ).catch(() => null),
            ),
        )
        for (const member of members)
          if (
            member &&
            !member.user.is_bot &&
            !['left', 'kicked'].includes(member.status) &&
            (member.status !== 'restricted' || member.is_member)
          )
            people.push(member.user)
      }
    }
    const chunks =
      input.mentionAll || allText !== null
        ? mentionMessages(allText ?? input.message, people)
        : [{ text: input.message, entities: [] }]
    for (const chunk of chunks) {
      // nosemgrep: query-in-loop -- Ordered external delivery stops on the first failure; the receipt prevents replay.
      const result = await sendMentionMessage(group.chatId, chunk.text, chunk.entities)
      if (!result.ok) throw new Error('delivery_failed')
      recipients += chunk.entities.length
    }
    success = true
  } catch {
    /* Receipt records partial/ambiguous delivery; an explicit new operation is required. */
  }
  await withContext(ctx, async (tx) => {
    await tx.raw(
      sql`update app.telegram_message_receipts set status=${success ? 'sent' : 'failed'},recipients=${recipients} where department_id=${ctx.departmentId} and operation_id=${operationId}`,
    )
    tx.audit({
      action: 'telegram.group_message',
      subjectType: 'telegram_group',
      subjectId: group.id,
      after: { operationId, status: success ? 'sent' : 'failed', recipients },
    })
  })
  return success ? { recipients } : { error: 'conflict' as const }
}

export const groupMessageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/telegram/group-message',
    {
      config: {
        permission: {
          action: 'update',
          subject: (req) => ({
            kind: 'department_managed',
            departmentId: req.actor?.departmentId ?? '',
          }),
        },
      },
      schema: {
        body: groupMessageSchema,
        headers: z.object({ 'x-operation-id': z.uuid() }),
        response: { 200: z.object({ recipients: z.number().int() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await sendDepartmentMessage(
        contextFromRequest(req),
        req.body,
        req.headers['x-operation-id'],
      )
      if ('error' in result) return sendProblem(reply, result.error)
      return result
    },
  )
}
