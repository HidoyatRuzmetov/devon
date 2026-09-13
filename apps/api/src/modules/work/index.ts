// Work core (TECH-SPEC §3.2/§4, EPIC-004): cards, checklist, comments, activity, labels, the People
// board, saved views, filter grammar, archive. Every route is `{kind:'department_child'}`, scoped to
// `req.actor.departmentId` (this build's one active department per session -- EPIC-002 has not
// shipped a switcher yet, see `apps/api/src/lib/actor.ts`).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { can, matchesFilterQuery, parseFilterQuery, type FilterableCard } from '@devon/contracts'
import { isHeadOf } from '../../lib/actor.js'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { withContext } from '@devon/db'
import { contextFromRequest } from './context.js'
// v1.1 SPEC §5: `field:<key>:<value>` is part of this grammar, so the card search has to know the
// answers. One narrow, documented dependency on the `fields` module -- the same shape
// `notifications/delivery.ts` has on `telegram/transport.ts`.
import { cardFieldValues, type CardFieldValues } from '../fields/filter-values.js'
import { UnsafeUrlError, unfurlLink } from './link-unfurl.js'
import * as repo from './repo.js'
import {
  archiveListSchema,
  boardSchema,
  cardChecklistParamsSchema,
  cardDetailSchema,
  cardListQuerySchema,
  cardListSchema,
  createCardBodySchema,
  createChecklistItemBodySchema,
  createCommentBodySchema,
  createLabelBodySchema,
  createSavedViewBodySchema,
  idParamsSchema,
  labelListSchema,
  patchCardBodySchema,
  patchChecklistItemBodySchema,
  savedViewListSchema,
  unfurlBodySchema,
  unfurlResultSchema,
  type CardDTO,
} from './schemas.js'

function departmentChildSubject(departmentId: string | null) {
  return {
    kind: 'department_child' as const,
    departmentId: departmentId ?? '',
  }
}

/** v1.1 SPEC §2.2 (D6d): the department's label vocabulary is head-shaped -- one shared set of names
 * everyone files work under, not something any member may add to. */
function departmentManagedSubject(departmentId: string | null) {
  return {
    kind: 'department_managed' as const,
    departmentId: departmentId ?? '',
  }
}

/**
 * v1.1 SPEC §2.1 (D6a/b/c/e). The route-level `can()` has already proven membership; this is the
 * per-object half of the same decision, made by the same function (`can()` with `{kind:'owned'}`),
 * never a hand-rolled `role === 'head'`.
 *
 * Answers 404 for a card that is not this department's -- identical to what every read route says
 * about a foreign id (H1.2) -- and 403 for a real card the caller neither gave, was given, nor
 * created. Returns the owner set on success so a caller that needs it (the watcher route) can refine
 * further.
 */
async function requireCardOwnership(
  req: FastifyRequest,
  reply: FastifyReply,
  departmentId: string,
  cardId: string,
): Promise<{ ok: true; ownerUserIds: string[] } | { ok: false }> {
  const owners = await repo.getCardOwners(contextFromRequest(req), departmentId, cardId)
  if (!owners) {
    sendProblem(reply, 'not_found')
    return { ok: false }
  }
  const decision = can(req.actor, 'update', {
    kind: 'owned',
    departmentId,
    ownerUserIds: owners.ownerUserIds,
  })
  if (!decision.allowed) {
    sendProblem(reply, 'forbidden')
    return { ok: false }
  }
  return { ok: true, ownerUserIds: owners.ownerUserIds }
}

/** Stamps the server's answer to "may this viewer edit this card?" onto every card DTO that leaves
 * this module, so the board, the table and the card sheet hide or disable exactly what the server
 * would refuse (PERMISSIONS-AUDIT Step 5). Pure JS over rows already loaded -- no extra query. */
function withCanEdit<T extends CardDTO>(cards: T[], actorUserId: string, isHead: boolean): T[] {
  return cards.map((card) => ({
    ...card,
    canEdit:
      isHead ||
      card.createdByUserId === actorUserId ||
      card.giverUserId === actorUserId ||
      card.assigneeUserId === actorUserId,
  }))
}

/** `''` (no membership) never satisfies `can()` for any real department id, so this is a safe,
 * fail-closed default -- a request with no active department is denied, never accidentally scoped to
 * "no filter at all". */
function requireDepartmentId(req: {
  actor: { departmentId: string | null } | null
}): string | null {
  return req.actor?.departmentId ?? null
}

function toFilterable(
  card: CardDTO,
  projectNames: Map<string, string>,
  labelNames: Map<string, string>,
  fieldValues?: CardFieldValues,
): FilterableCard {
  const values = fieldValues?.get(card.id)
  return {
    ...(values ? { fieldValues: values } : {}),
    id: card.id,
    title: card.title,
    description: card.description?.text ?? null,
    status: card.status,
    assigneeUserId: card.assigneeUserId,
    giverUserId: card.giverUserId,
    dueAt: card.dueAt,
    projectName: card.projectId ? (projectNames.get(card.projectId) ?? null) : null,
    labelNames: card.labels.map((id) => labelNames.get(id) ?? '').filter(Boolean),
    unitName: null, // EPIC-003 (structure/bo'limlar) has not shipped yet
  }
}

const workRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/board',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { response: { 200: boardSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId)
        return reply.send({
          members: [],
          columns: [],
          unassigned: [],
          labels: [],
        })
      const ctx = contextFromRequest(req)
      const [members, cards, labels] = await Promise.all([
        repo.getMembers(ctx, departmentId),
        repo.listCards(ctx, departmentId, { excludeArchived: true }),
        repo.getLabels(ctx, departmentId),
      ])
      const active = cards.filter((c) => c.status !== 'done')
      const byAssignee = new Map<string, CardDTO[]>()
      const unassigned: CardDTO[] = []
      for (const card of active) {
        if (!card.assigneeUserId) {
          unassigned.push(card)
          continue
        }
        const list = byAssignee.get(card.assigneeUserId) ?? []
        list.push(card)
        byAssignee.set(card.assigneeUserId, list)
      }
      const isHead = isHeadOf(req.actor, departmentId)
      const me = req.actor!.userId
      const columns = members.map((member) => ({
        member,
        cards: withCanEdit(byAssignee.get(member.userId) ?? [], me, isHead),
      }))
      return reply.send({
        members,
        columns,
        unassigned: withCanEdit(unassigned, me, isHead),
        labels,
      })
    },
  )

  app.get(
    '/cards',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        querystring: cardListQuerySchema,
        response: { 200: cardListSchema },
      },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send({ items: [], nextCursor: null })
      const ctx = contextFromRequest(req)
      const [cards, members, labels, projectNames, fieldValues] = await Promise.all([
        repo.listCards(ctx, departmentId, {}),
        repo.getMembers(ctx, departmentId),
        repo.getLabels(ctx, departmentId),
        repo.getProjectNames(ctx, departmentId),
        withContext(ctx, (tx) => cardFieldValues(tx, departmentId)),
      ])
      const labelNames = new Map(labels.map((l) => [l.id, l.name]))
      const resolveUserIds = (token: string): string[] => {
        const needle = token.replace(/^@/, '').toLowerCase()
        return members
          .filter(
            (m) =>
              m.givenName.toLowerCase().includes(needle) ||
              m.familyName.toLowerCase().includes(needle),
          )
          .map((m) => m.userId)
      }

      let filtered = cards
      if (req.query.q && req.query.q.trim().length > 0) {
        const query = parseFilterQuery(req.query.q)
        filtered = cards.filter((c) =>
          matchesFilterQuery(toFilterable(c, projectNames, labelNames, fieldValues), query, {
            meUserId: req.actor!.userId,
            resolveUserIds,
          }),
        )
      }
      if (req.query.mine) {
        filtered = filtered.filter((c) => c.assigneeUserId === req.actor!.userId)
      }

      const limit = req.query.limit ?? 50
      const cursorIndex = req.query.cursor ? Number(req.query.cursor) : 0
      const page = withCanEdit(
        filtered.slice(cursorIndex, cursorIndex + limit),
        req.actor!.userId,
        isHeadOf(req.actor, departmentId),
      )
      const nextCursor = cursorIndex + limit < filtered.length ? String(cursorIndex + limit) : null
      return reply.send({ items: page, nextCursor })
    },
  )

  app.post(
    '/cards',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: createCardBodySchema,
        response: { 201: cardDetailSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      // Cross-tenant reference guard (H1.3, `test/integration/mass-assignment.test.ts`): `createCard`
      // wrote whatever uuid the body named as assignee/giver, so a member could create a card in
      // their own department "assigned to" somebody who belongs to a different one (or to nobody at
      // all) -- a row the victim's department can never see and the board can never render. Both ids
      // are checked against the department's active memberships in ONE query before the insert.
      const named = [req.body.assigneeUserId, req.body.giverUserId].filter(
        (id): id is string => typeof id === 'string',
      )
      if (named.length > 0) {
        const members = await repo.filterDepartmentMemberIds(ctx, departmentId, named)
        if (named.some((id) => !members.has(id))) {
          return sendProblem(reply, 'validation_failed')
        }
      }
      const card = await repo.createCard(ctx, {
        departmentId,
        title: req.body.title,
        description: req.body.description,
        kind: req.body.kind,
        assigneeUserId: req.body.assigneeUserId,
        giverUserId: req.body.giverUserId,
        priority: req.body.priority,
        startAt: req.body.startAt,
        dueAt: req.body.dueAt,
        labels: req.body.labels,
        links: req.body.links,
        projectId: req.body.projectId,
        projectScope: req.body.projectScope,
        orderKey: req.body.orderKey,
        createdByUserId: req.actor!.userId,
      })
      return reply.code(201).send({
        ...withCanEdit([card], req.actor!.userId, isHeadOf(req.actor, departmentId))[0]!,
        checklist: [],
        comments: [],
        activity: [],
      })
    },
  )

  app.get(
    '/cards/:id',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 200: cardDetailSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const card = await repo.getCard(ctx, departmentId, req.params.id)
      if (!card) return sendProblem(reply, 'not_found')
      const [checklist, comments, activity] = await Promise.all([
        repo.getChecklist(ctx, card.id),
        repo.getComments(ctx, card.id),
        repo.getActivity(ctx, card.id),
      ])
      return reply.send({
        ...withCanEdit([card], req.actor!.userId, isHeadOf(req.actor, departmentId))[0]!,
        checklist,
        comments,
        activity,
      })
    },
  )

  app.patch(
    '/cards/:id',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: patchCardBodySchema,
        response: { 200: cardDetailSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const { version, ...patch } = req.body
      // D6a/D6b: rewriting, re-dating, reassigning or archiving a colleague's card you have nothing
      // to do with is the leak the CTO felt. The giver, the assignee, the creator and the head may;
      // everyone else gets a 403 and the board hides the affordance (`canEdit` on the DTO).
      const ownership = await requireCardOwnership(req, reply, departmentId, req.params.id)
      if (!ownership.ok) return
      const result = await repo.patchCard(
        ctx,
        departmentId,
        req.params.id,
        patch,
        version,
        req.actor!.userId,
      )
      if (!result.ok) {
        return sendProblem(reply, result.reason === 'conflict' ? 'conflict' : 'not_found')
      }
      const [checklist, comments, activity] = await Promise.all([
        repo.getChecklist(ctx, result.card.id),
        repo.getComments(ctx, result.card.id),
        repo.getActivity(ctx, result.card.id),
      ])
      return reply.send({
        ...withCanEdit([result.card], req.actor!.userId, isHeadOf(req.actor, departmentId))[0]!,
        checklist,
        comments,
        activity,
      })
    },
  )

  app.post(
    '/cards/:id/restore',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const restoreOwnership = await requireCardOwnership(req, reply, departmentId, req.params.id)
      if (!restoreOwnership.ok) return
      const ok = await repo.restoreCard(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.actor!.userId,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.post(
    '/cards/:id/checklist',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: createChecklistItemBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const checklistOwnership = await requireCardOwnership(req, reply, departmentId, req.params.id)
      if (!checklistOwnership.ok) return
      const id = await repo.addChecklistItem(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.body,
      )
      // `null` means the card is not this department's (H1.2): the same 404 the card's own routes
      // answer, so a foreign card id is indistinguishable from one that never existed.
      if (id === null) return sendProblem(reply, 'not_found')
      return reply.code(201).send({ id })
    },
  )

  app.patch(
    '/cards/:id/checklist/:itemId',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: cardChecklistParamsSchema,
        body: patchChecklistItemBodySchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const patchItemOwnership = await requireCardOwnership(req, reply, departmentId, req.params.id)
      if (!patchItemOwnership.ok) return
      const ok = await repo.patchChecklistItem(
        contextFromRequest(req),
        departmentId,
        req.params.itemId,
        req.body,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.delete(
    '/cards/:id/checklist/:itemId',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: cardChecklistParamsSchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const deleteItemOwnership = await requireCardOwnership(
        req,
        reply,
        departmentId,
        req.params.id,
      )
      if (!deleteItemOwnership.ok) return
      const ok = await repo.deleteChecklistItem(
        contextFromRequest(req),
        departmentId,
        req.params.itemId,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.post(
    '/cards/:id/comments',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: createCommentBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const id = await repo.addComment(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.actor!.userId,
        req.body.text,
        req.body.mentions ?? [],
      )
      if (id === null) return sendProblem(reply, 'not_found')
      return reply.code(201).send({ id })
    },
  )

  app.get(
    '/cards/:id/activity',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 200: z.array(z.any()) } },
    },
    async (req, reply) => {
      const ctx = contextFromRequest(req)
      // Without this the route answered 200 with an empty array for a card the caller cannot see --
      // RLS emptied the activity query, so nothing leaked, but the endpoint reported success for
      // another department's id and disagreed with `GET /cards/:id`'s 404 (H1.2).
      if (!(await repo.cardExists(ctx, requireDepartmentId(req)!, req.params.id))) {
        return sendProblem(reply, 'not_found')
      }
      return reply.send(await repo.getActivity(ctx, req.params.id))
    },
  )

  app.get(
    '/labels',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { response: { 200: labelListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      return reply.send(
        departmentId ? await repo.getLabels(contextFromRequest(req), departmentId) : [],
      )
    },
  )

  app.post(
    '/labels',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: createLabelBodySchema,
        response: { 201: labelListSchema.element },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const label = await repo.createLabel(
        contextFromRequest(req),
        departmentId,
        req.body.name,
        req.body.colour ?? '#6366f1',
      )
      return reply.code(201).send(label)
    },
  )

  app.get(
    '/views',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { response: { 200: savedViewListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send([])
      return reply.send(
        await repo.listSavedViews(contextFromRequest(req), departmentId, req.actor!.userId),
      )
    },
  )

  app.post(
    '/views',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: createSavedViewBodySchema,
        response: { 201: savedViewListSchema.element },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const view = await repo.createSavedView(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        req.body,
      )
      return reply.code(201).send(view)
    },
  )

  app.delete(
    '/views/:id',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ok = await repo.deleteSavedView(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        req.params.id,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.get(
    '/archive',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        querystring: z.object({ userId: z.string().uuid() }),
        response: { 200: archiveListSchema },
      },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const [members, items] = await Promise.all([
        repo.getMembers(ctx, departmentId),
        repo.listArchiveForMember(ctx, departmentId, req.query.userId),
      ])
      const member = members.find((m) => m.userId === req.query.userId)
      if (!member) return sendProblem(reply, 'not_found')
      return reply.send({ member, items })
    },
  )

  app.post(
    '/links/unfurl',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { body: unfurlBodySchema, response: { 200: unfurlResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        // H1.6 (SSRF-safe unfurling). Triaged Semgrep false positive: the rule fires on any request
        // value reaching an outbound fetch. `unfurlLink` is that control, not a bypass of it -- it
        // resolves DNS itself and refuses loopback, link-local (including 169.254.169.254),
        // RFC 1918, CGNAT and unique-local addresses before a byte is sent, refuses embedded
        // credentials and non-http(s) schemes, pins the socket to the address it approved so a DNS
        // rebind cannot move the connection afterwards, never follows a redirect (the target is a
        // new URL none of those checks have run against), and bounds the body at 200 kB and the
        // whole call at 4 s (`modules/work/link-unfurl.ts`, `test/unit/link-unfurl.test.ts`).
        // nosemgrep: javascript.lang.security.audit.ssrf.ssrf-requests
        reply.send(await unfurlLink(req.body.url))
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          return sendProblem(reply, 'validation_failed', {
            errors: [{ path: 'url', code: 'unsafe_url' }],
          })
        }
        throw err
      }
    },
  )

  app.post(
    '/cards/:id/watchers',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 200: cardDetailSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const existing = await repo.getCard(ctx, departmentId, req.params.id)
      if (!existing) return sendProblem(reply, 'not_found')
      const userId = req.actor!.userId
      const nextWatchers = existing.watchers.includes(userId)
        ? existing.watchers.filter((w) => w !== userId)
        : [...existing.watchers, userId]
      const result = await repo.patchCard(
        ctx,
        departmentId,
        req.params.id,
        { watchers: nextWatchers },
        undefined,
        userId,
      )
      if (!result.ok) return sendProblem(reply, 'not_found')
      const [checklist, comments, activity] = await Promise.all([
        repo.getChecklist(ctx, result.card.id),
        repo.getComments(ctx, result.card.id),
        repo.getActivity(ctx, result.card.id),
      ])
      return reply.send({
        ...withCanEdit([result.card], req.actor!.userId, isHeadOf(req.actor, departmentId))[0]!,
        checklist,
        comments,
        activity,
      })
    },
  )
}

export default workRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1` -- `GET /board` below becomes
// `GET /api/v1/board`.
export const prefix = ''
