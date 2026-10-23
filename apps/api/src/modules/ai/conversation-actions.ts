import type { FastifyInstance, FastifyRequest } from 'fastify'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { can, type AiChatMessage, type AiChatProposal } from '@devon/contracts'
import { contextFromRequest } from '../work/context.js'
import { getCardOwners } from '../work/repo.js'
import { ACTIONS, parseAction } from './action-catalog.js'
import { ConversationError, getConversation } from './conversations.js'

async function changeProposal(
  ctx: RequestContext,
  conversationId: string,
  proposalId: string,
  change: (p: AiChatProposal, createdAt: string) => AiChatProposal,
) {
  if (ctx.viewAs || !ctx.userId || !ctx.departmentId) throw new ConversationError('forbidden')
  return withContext(ctx, async (tx) => {
    const [row] = await tx.raw<{
      messages: AiChatMessage[]
    }>(sql`select messages from app.ai_conversations
      where id=${conversationId} and owner_user_id=${ctx.userId} and department_id=${ctx.departmentId} for update`)
    if (!row) throw new ConversationError('not_found')
    let changed: AiChatProposal | undefined
    const messages = row.messages.map((message) => ({
      ...message,
      proposals: message.proposals?.map((proposal) => {
        if (proposal.id !== proposalId) return proposal
        changed = change(proposal, message.createdAt)
        return changed
      }),
    }))
    if (!changed) throw new ConversationError('not_found')
    await tx.raw(
      sql`update app.ai_conversations set messages=${JSON.stringify(messages)}::jsonb,updated_at=now() where id=${conversationId}`,
    )
    tx.audit({
      action: `ai.action.${changed.status}`,
      subjectType: 'ai_conversation',
      subjectId: conversationId,
      after: { proposalId, kind: changed.kind, via: 'ai', result: changed.result ?? null },
    })
    tx.emit({
      type: 'ai.conversation.answered',
      payload: { conversationId, userId: ctx.userId, messageId: proposalId },
    })
    return changed
  })
}

async function attachFiles(
  req: FastifyRequest,
  conversationId: string,
  ids: string[],
  targetType: 'card' | 'page',
  targetId: string,
) {
  const ctx = contextFromRequest(req)
  if (targetType === 'card') {
    const owners = await getCardOwners(ctx, ctx.departmentId!, targetId)
    if (
      !owners ||
      !can(req.actor, 'update', {
        kind: 'owned',
        departmentId: ctx.departmentId!,
        ownerUserIds: owners.ownerUserIds,
      }).allowed
    )
      throw new ConversationError('forbidden')
  }
  await withContext(ctx, async (tx) => {
    const [target] = await tx.raw<{
      id: string
    }>(sql`select id from ${targetType === 'card' ? sql`app.cards` : sql`app.pages`}
      where id=${targetId} and department_id=${ctx.departmentId} and deleted_at is null for update`)
    if (!target) throw new ConversationError('not_found')
    const rows = await tx.raw<{
      id: string
    }>(sql`select id from app.attachments where id=any(${sql.param(ids)}::uuid[])
      and department_id=${ctx.departmentId} and uploaded_by_user_id=${ctx.userId} and subject_type='ai_conversation'
      and subject_id=${conversationId} and deleted_at is null and scan_status='clean' for update`)
    if (rows.length !== new Set(ids).size)
      throw new ConversationError('conflict', 'attachment_unavailable')
    await tx.raw(sql`update app.attachments set subject_type=${targetType},subject_id=${targetId}
      where id=any(${sql.param(ids)}::uuid[]) and department_id=${ctx.departmentId}`)
    const [conversation] = await tx.raw<{ messages: AiChatMessage[] }>(
      sql`select messages from app.ai_conversations where id=${conversationId} and owner_user_id=${ctx.userId} for update`,
    )
    if (conversation) {
      const messages = conversation.messages.map((message) => ({
        ...message,
        attachments: message.attachments?.map((file) =>
          ids.includes(file.id)
            ? {
                ...file,
                downloadPath: `/${targetType === 'card' ? 'cards' : 'pages'}/${targetId}/attachments/${file.id}/download`,
              }
            : file,
        ),
      }))
      await tx.raw(
        sql`update app.ai_conversations set messages=${JSON.stringify(messages)}::jsonb where id=${conversationId}`,
      )
    }
    tx.audit({
      action: 'ai.attachment.attached',
      subjectType: targetType,
      subjectId: targetId,
      after: { attachmentIds: ids, via: 'ai', conversationId },
    })
    if (targetType === 'card')
      tx.emit({
        type: 'work.card.updated',
        payload: { cardId: targetId, actorUserId: ctx.userId, changes: ['attachments'] },
      })
    else
      tx.emit({
        type: 'pages.page.updated',
        payload: { pageId: targetId, actorUserId: ctx.userId, changes: ['attachments'] },
      })
  })
}

/** At-most-once dispatch: confirmation is durably claimed before any domain write. A double click,
 * retry or reload can never replay an executed action. An interrupted dispatch is shown as such;
 * we never guess that a possibly completed create is safe to repeat. */
export async function resolveProposal(
  app: FastifyInstance,
  req: FastifyRequest,
  conversationId: string,
  proposalId: string,
  execute: boolean,
) {
  const ctx = contextFromRequest(req)
  await getConversation(ctx, conversationId)
  let claimed = false
  const proposal = await changeProposal(ctx, conversationId, proposalId, (p, createdAt) => {
    if (p.status !== 'pending') return p
    if (Date.now() - Date.parse(createdAt) > 24 * 60 * 60 * 1000) return { ...p, status: 'expired' }
    claimed = execute
    return {
      ...p,
      status: execute ? 'executing' : 'discarded',
      ...(execute ? { startedAt: new Date().toISOString() } : {}),
    }
  })
  if (!claimed) return getConversation(ctx, conversationId)
  let result: AiChatProposal['result']
  try {
    const args = parseAction(proposal.kind, proposal.arguments)
    const operation = ACTIONS[proposal.kind]!
    if (proposal.kind === 'attachment.attach') {
      await attachFiles(
        req,
        conversationId,
        args['attachmentIds'] as string[],
        args['targetType'] as 'card' | 'page',
        String(args['targetId']),
      )
      result = { href: operation.href(args, {}), label: proposal.title }
    } else {
      const attachmentIds = args['attachmentIds'] as string[] | undefined
      // Validate all staged uploads before creating anything. Size approval and malware scanning
      // happened in the ordinary upload pipeline; the model cannot bypass either.
      if (attachmentIds?.length)
        await withContext(ctx, async (tx) => {
          const files =
            await tx.raw(sql`select id from app.attachments where id=any(${sql.param(attachmentIds)}::uuid[])
          and department_id=${ctx.departmentId} and subject_type='ai_conversation' and subject_id=${conversationId}
          and uploaded_by_user_id=${ctx.userId} and deleted_at is null and scan_status='clean'`)
          if (files.length !== new Set(attachmentIds).size)
            throw new ConversationError('conflict', 'attachment_unavailable')
        })
      const response = await app.inject({
        method: operation.method,
        url: `/api/v1${operation.path(args)}`,
        headers: {
          cookie: req.headers.cookie ?? '',
          'x-csrf-token': String(req.headers['x-csrf-token'] ?? ''),
          'user-agent': `${req.headers['user-agent'] ?? 'WorkPortal'} ai-action/${proposalId}`,
        },
        ...(args['body'] ? { payload: args['body'] as Record<string, unknown> } : {}),
      })
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const code =
          response.statusCode === 403
            ? 'forbidden'
            : response.statusCode === 404
              ? 'not_found'
              : response.statusCode === 409
                ? 'conflict'
                : 'action_failed'
        throw new Error(code)
      }
      const responseBody = response.body
        ? (JSON.parse(response.body) as Record<string, unknown>)
        : {}
      result = { href: operation.href(args, responseBody), label: proposal.title }
      if (attachmentIds?.length)
        await attachFiles(
          req,
          conversationId,
          attachmentIds,
          proposal.kind === 'card.create' ? 'card' : 'page',
          String(responseBody['id']),
        )
    }
    await changeProposal(ctx, conversationId, proposalId, (p) => ({
      ...p,
      status: 'executed',
      result,
    }))
  } catch (error) {
    const known = ['forbidden', 'not_found', 'conflict', 'attachment_unavailable', 'action_failed']
    const code =
      error instanceof Error && known.includes(error.message) ? error.message : 'action_failed'
    await changeProposal(ctx, conversationId, proposalId, (p) => ({
      ...p,
      status: 'failed',
      error: result ? 'attachment_failed' : code,
      ...(result ? { result } : {}),
    }))
  }
  return getConversation(ctx, conversationId)
}
