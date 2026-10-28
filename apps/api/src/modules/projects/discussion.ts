import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { can, type Actor } from '@devon/contracts'
import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from './context.js'

const params = z.object({ id: z.string().uuid() })
const commentParams = params.extend({ commentId: z.string().uuid() })
const commentResponse = z.object({
  id: z.string().uuid(),
  authorUserId: z.string().uuid(),
  body: z.object({ text: z.string() }),
  mentions: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
})
const input = z
  .object({
    text: z.string().trim().min(1).max(10000),
    mentions: z.array(z.string().uuid()).max(100).default([]),
  })
  .strict()
type Comment = {
  id: string
  author_user_id: string
  body: { text: string }
  mentions: string[]
  created_at: Date
  edited_at: Date | null
}

async function projectComments(ctx: RequestContext, projectId: string) {
  return withContext(ctx, async (tx) => {
    const [project] = await tx.raw(
      sql`select id from app.projects where id=${projectId} and department_id=${ctx.departmentId} and deleted_at is null`,
    )
    if (!project) return null
    const comments =
      await tx.raw<Comment>(sql`select id,author_user_id,body,mentions,created_at,edited_at from app.project_comments
      where project_id=${projectId} and department_id=${ctx.departmentId} and deleted_at is null order by created_at,id`)
    return comments.map((c) => ({
      id: c.id,
      authorUserId: c.author_user_id,
      body: c.body,
      mentions: c.mentions,
      createdAt: new Date(c.created_at).toISOString(),
      editedAt: c.edited_at ? new Date(c.edited_at).toISOString() : null,
    }))
  })
}

async function writeProjectComment(
  ctx: RequestContext,
  actor: Actor | null,
  projectId: string,
  commentId: string | null,
  value: { text: string; mentions: string[]; editedAt?: string | null } | null,
): Promise<{ id: string } | 'not_found' | 'forbidden' | 'conflict'> {
  return withContext(ctx, async (tx) => {
    // Share the parent lock with project deletion so a post cannot arrive after the project is removed.
    const [project] = await tx.raw<{ members: string[]; owner_user_id: string }>(
      sql`select members,owner_user_id from app.projects where id=${projectId} and department_id=${ctx.departmentId} and deleted_at is null for update`,
    )
    if (!project) return 'not_found'
    const before = commentId
      ? (
          await tx.raw<Comment>(
            sql`select * from app.project_comments where id=${commentId} and project_id=${projectId} and department_id=${ctx.departmentId} and deleted_at is null for update`,
          )
        )[0]
      : null
    if (commentId && !before) return 'not_found'
    if (
      before &&
      !can(actor, value ? 'update' : 'delete', {
        kind: 'owned',
        departmentId: ctx.departmentId!,
        ownerUserIds: [before.author_user_id],
      }).allowed
    )
      return 'forbidden'
    if (
      before &&
      value &&
      (before.edited_at ? new Date(before.edited_at).toISOString() : null) !== value.editedAt
    )
      return 'conflict'
    const mentions = value?.mentions.length
      ? (
          await tx.raw<{
            user_id: string
          }>(sql`select m.user_id from app.memberships m join app.users u on u.id=m.user_id
      where m.department_id=${ctx.departmentId} and m.status='active' and m.deleted_at is null and u.status='active' and u.deleted_at is null
      and m.user_id=any(${sql.param([...new Set(value.mentions)])}::uuid[])`)
        ).map((m) => m.user_id)
      : []
    const id = commentId ?? randomUUID()
    if (!commentId && value)
      await tx.raw(sql`insert into app.project_comments(id,department_id,project_id,author_user_id,body,mentions)
      values(${id},${ctx.departmentId},${projectId},${ctx.userId},${JSON.stringify({ format: 'markdown', text: value.text })}::jsonb,${sql.param(mentions)}::uuid[])`)
    else if (value)
      await tx.raw(
        sql`update app.project_comments set body=${JSON.stringify({ format: 'markdown', text: value.text })}::jsonb,mentions=${sql.param(mentions)}::uuid[],edited_at=clock_timestamp() where id=${id}`,
      )
    else
      await tx.raw(sql`update app.project_comments set deleted_at=clock_timestamp() where id=${id}`)
    tx.audit({
      action: !commentId
        ? 'projects.comment_added'
        : value
          ? 'projects.comment_edited'
          : 'projects.comment_deleted',
      subjectType: 'project_comment',
      subjectId: id,
      departmentId: ctx.departmentId,
      ...(before ? { before: { body: before.body, mentions: before.mentions } } : {}),
      ...(value ? { after: { body: { text: value.text }, mentions } } : {}),
    })
    const payload = {
      projectId,
      commentId: id,
      actorUserId: ctx.userId,
      recipientIds: [
        ...new Set([project.owner_user_id, ...project.members, ...(before?.mentions ?? [])]),
      ],
      mentions: mentions.filter((m) => !before?.mentions.includes(m)),
    }
    if (!commentId)
      tx.emit({ type: 'projects.project.commented', departmentId: ctx.departmentId, payload })
    else if (value)
      tx.emit({ type: 'projects.comment.updated', departmentId: ctx.departmentId, payload })
    else tx.emit({ type: 'projects.comment.deleted', departmentId: ctx.departmentId, payload })
    return { id }
  })
}

export const projectDiscussionRoutes: FastifyPluginAsyncZod = async (app) => {
  const subject = (r: { actor: Actor | null }) => ({
    kind: 'department_child' as const,
    departmentId: r.actor?.departmentId ?? '',
  })
  app.get(
    '/projects/:id/comments',
    {
      config: { permission: { action: 'read', subject } },
      schema: { params, response: { 200: z.array(commentResponse) } },
    },
    async (req, reply) => {
      const result = await projectComments(contextFromRequest(req), req.params.id)
      return result ?? sendProblem(reply, 'not_found')
    },
  )
  app.post(
    '/projects/:id/comments',
    {
      config: {
        permission: { action: 'create', subject },
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: { params, body: input, response: { 201: z.object({ id: z.string().uuid() }) } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await writeProjectComment(
        contextFromRequest(req),
        req.actor,
        req.params.id,
        null,
        req.body,
      )
      return typeof result === 'string' ? sendProblem(reply, result) : reply.code(201).send(result)
    },
  )
  app.patch(
    '/projects/:id/comments/:commentId',
    {
      config: { permission: { action: 'update', subject } },
      schema: {
        params: commentParams,
        body: input.extend({ editedAt: z.string().datetime().nullable() }),
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await writeProjectComment(
        contextFromRequest(req),
        req.actor,
        req.params.id,
        req.params.commentId,
        req.body,
      )
      return typeof result === 'string' ? sendProblem(reply, result) : reply.code(204).send()
    },
  )
  app.delete(
    '/projects/:id/comments/:commentId',
    { config: { permission: { action: 'delete', subject } }, schema: { params: commentParams } },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await writeProjectComment(
        contextFromRequest(req),
        req.actor,
        req.params.id,
        req.params.commentId,
        null,
      )
      return typeof result === 'string' ? sendProblem(reply, result) : reply.code(204).send()
    },
  )
}
