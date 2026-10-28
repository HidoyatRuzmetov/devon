import { can, type AiChatMessage, type AiChatProposal } from '@devon/contracts'
import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { contextFromRequest } from '../work/context.js'
import { getCardOwners } from '../work/repo.js'
import { ACTIONS } from './action-catalog.js'
import { CREATED_ENTITY, parsePlannedArguments, resolveActionBindings } from './action-plan.js'
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
      and department_id=${ctx.departmentId} and uploaded_by_user_id=${ctx.userId}
      and ((subject_type='ai_conversation' and subject_id=${conversationId}) or (subject_type=${targetType} and subject_id=${targetId}))
      and deleted_at is null and scan_status='clean' for update`)
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
  batchClaimed?: AiChatProposal,
) {
  const ctx = contextFromRequest(req)
  const snapshot = await getConversation(ctx, conversationId)
  let claimed = !!batchClaimed
  const proposal =
    batchClaimed ??
    (await changeProposal(ctx, conversationId, proposalId, (p, createdAt) => {
      if (p.status !== 'pending') return p
      if (Date.now() - Date.parse(createdAt) > 24 * 60 * 60 * 1000)
        return { ...p, status: 'expired' }
      claimed = execute
      return {
        ...p,
        status: execute ? 'executing' : 'discarded',
        ...(execute ? { startedAt: new Date().toISOString() } : {}),
      }
    }))
  if (!claimed) return getConversation(ctx, conversationId)
  let result: AiChatProposal['result']
  try {
    const siblings =
      snapshot.messages.find((m) => m.proposals?.some((p) => p.id === proposalId))?.proposals ?? []
    const prior = siblings.slice(
      0,
      siblings.findIndex((p) => p.id === proposalId),
    )
    const args = resolveActionBindings(
      proposal,
      new Map(prior.filter((p) => p.key).map((p) => [p.key!, p])),
    )
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
          'x-operation-id': proposalId,
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
      result = {
        href: operation.href(args, responseBody),
        label: proposal.title,
        ...(CREATED_ENTITY[proposal.kind] && z.uuid().safeParse(responseBody['id']).success
          ? { entityId: responseBody['id'] as string }
          : {}),
      }
      if (attachmentIds?.length)
        await attachFiles(
          req,
          conversationId,
          attachmentIds,
          proposal.kind === 'card.create' || proposal.kind === 'card.withChecklist'
            ? 'card'
            : 'page',
          String(responseBody['id']),
        )
    }
    await changeProposal(ctx, conversationId, proposalId, (p) => ({
      ...p,
      status: 'executed',
      result,
    }))
  } catch (error) {
    const known = [
      'forbidden',
      'not_found',
      'conflict',
      'attachment_unavailable',
      'action_failed',
      'dependency_unavailable',
    ]
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

export async function editProposal(
  ctx: RequestContext,
  conversationId: string,
  proposalId: string,
  input: { revision: number; arguments: Record<string, unknown> },
) {
  await changeProposal(ctx, conversationId, proposalId, (p) => {
    if (p.status !== 'pending' || (p.revision ?? 0) !== input.revision)
      throw new ConversationError('conflict', 'proposal_changed')
    let parsed: Record<string, unknown>
    try {
      parsed = parsePlannedArguments({ ...p, arguments: input.arguments })
    } catch {
      throw new ConversationError('validation_failed', 'invalid_action_arguments')
    }
    return { ...p, arguments: parsed, revision: (p.revision ?? 0) + 1 }
  })
  return getConversation(ctx, conversationId)
}

/** Claim the entire reviewed selection in one transaction. A racing edit cannot replace an
 * unchecked or approved operation between review and execution. Each domain operation commits
 * independently; failures remain visible per row, and an interrupted batch is never replayed. */
export async function resolveProposalBatch(
  app: FastifyInstance,
  req: FastifyRequest,
  conversationId: string,
  input: { messageId: string; proposals: { id: string; revision: number; selected: boolean }[] },
) {
  const ctx = contextFromRequest(req)
  if (ctx.viewAs || !ctx.userId || !ctx.departmentId) throw new ConversationError('forbidden')
  const claimed = await withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      messages: AiChatMessage[]
    }>(sql`select messages from app.ai_conversations where id=${conversationId}
      and owner_user_id=${ctx.userId} and department_id=${ctx.departmentId} for update`)
    if (!rows[0]) throw new ConversationError('not_found')
    const message = rows[0].messages.find((m) => m.id === input.messageId && m.role === 'assistant')
    if (!message) throw new ConversationError('not_found')
    const choices = new Map(input.proposals.map((p) => [p.id, p]))
    const proposals = message.proposals ?? []
    if (input.proposals.some((p) => !proposals.some((existing) => existing.id === p.id)))
      throw new ConversationError('not_found')
    const currentPending = proposals.filter((p) => p.status === 'pending')
    // A retry after the selection was claimed is a read, never a second execution.
    if (!currentPending.length) return []
    if (
      currentPending.some(
        (p) => !choices.has(p.id) || choices.get(p.id)!.revision !== (p.revision ?? 0),
      )
    )
      throw new ConversationError('conflict', 'proposal_changed')
    if (Date.now() - Date.parse(message.createdAt) > 24 * 3600000)
      throw new ConversationError('conflict', 'proposal_expired')
    const dispatch: AiChatProposal[] = []
    message.proposals = proposals.map((p) => {
      if (p.status !== 'pending') return p
      const selected = choices.get(p.id)!.selected
      if (selected) parsePlannedArguments(p)
      const next: AiChatProposal = {
        ...p,
        status: selected ? 'executing' : 'discarded',
        ...(selected ? { startedAt: new Date().toISOString() } : {}),
      }
      if (selected) dispatch.push(next)
      return next
    })
    await tx.raw(
      sql`update app.ai_conversations set messages=${JSON.stringify(rows[0].messages)}::jsonb,updated_at=now() where id=${conversationId}`,
    )
    tx.audit({
      action: 'ai.actions.confirmed',
      subjectType: 'ai_conversation',
      subjectId: conversationId,
      after: { via: 'ai', messageId: input.messageId, choices: input.proposals },
    })
    tx.emit({
      type: 'ai.conversation.answered',
      payload: { conversationId, userId: ctx.userId, messageId: input.messageId },
    })
    return dispatch
  })
  for (let index = 0; index < claimed.length; index += 1) {
    // Ordered domain operations may refer to a previous change. These are not independent reads.
    // nosemgrep: query-in-loop
    await resolveProposal(app, req, conversationId, claimed[index]!.id, true, claimed[index])
  }
  return getConversation(ctx, conversationId)
}
