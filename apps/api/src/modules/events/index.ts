// /api/v1/events/* (TECH-SPEC §3.4, §4; EPIC-008). Fastify plugin -- auto-discovered by
// `apps/api/src/module-loader.ts` (MODULE-GUIDE.md "API modules"). Every route declares
// `config.permission`; every mutation checks CSRF exactly like `PATCH /api/v1/me`
// (`apps/api/src/modules/me/index.ts`); every handler talks only to `service.ts`, never `@devon/db`
// directly.
//
// `req.actor.departmentId`/`.memberships` are populated by `apps/api/src/lib/actor.ts`, which -- as of
// this epic's foundation -- always returns `null`/`[]` (that file's own header comment: departments
// arrive with EPIC-002/accounts-departments). Every route below is written against the *documented*
// contract (`req.actor.departmentId`, `Membership.role === 'head'`) so it starts working the moment
// that file is filled in at integration, exactly as MODULE-GUIDE.md's `useDepartment()` note describes
// for the web side; until then `can()`'s own `department_child` check denies every request with
// `not_a_member` before a handler body ever runs, which is the correct fail-closed behaviour, not a
// bug in this module.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { RequestContext } from '@devon/db'
import { EventConflictError, EventForbiddenError, EventNotFoundError } from './errors.js'
import * as service from './service.js'
import {
  cancelEventBodySchema,
  carpoolBodySchema,
  carpoolClaimBodySchema,
  carpoolDto,
  carpoolListResponseSchema,
  commentBodySchema,
  commentDto,
  commentListResponseSchema,
  createEventBodySchema,
  eventListResponseSchema,
  eventSchema,
  feedbackBodySchema,
  feedbackListResponseSchema,
  icsResponseSchema,
  itemBodySchema,
  itemDto,
  itemListResponseSchema,
  pollBodySchema,
  pollDto,
  pollListResponseSchema,
  pollVoteBodySchema,
  photoBodySchema,
  photoDto,
  photoListResponseSchema,
  rsvpBodySchema,
  rsvpListResponseSchema,
  updateEventBodySchema,
} from './schemas.js'

function activeDepartmentId(req: FastifyRequest): string {
  return req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? ''
}

function toDbContext(req: FastifyRequest): RequestContext {
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    departmentId: req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? null,
    actingForUserId: null,
    viewAs: req.actor?.viewAs != null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

function currentActor(req: FastifyRequest): service.Actor {
  const departmentId = activeDepartmentId(req)
  const isHead =
    req.actor?.memberships.some((m) => m.departmentId === departmentId && m.role === 'head') ??
    false
  return {
    userId: req.actor!.userId,
    isHead,
    givenName: req.actorUser?.givenName ?? '',
    familyName: req.actorUser?.familyName ?? '',
  }
}

/** Maps this module's typed domain errors (`errors.ts`) to the same RFC 9457 `Problem` bodies every
 * other route in the codebase sends. Returns `true` once it has replied -- the caller returns
 * immediately rather than falling through to a 200. Anything not one of these three re-throws, so
 * Fastify's shared error handler (`app.ts`) still produces the generic 500 for a genuine bug. */
function mapServiceError(err: unknown, reply: FastifyReply): boolean {
  if (err instanceof EventNotFoundError) {
    sendProblem(reply, 'not_found')
    return true
  }
  if (err instanceof EventForbiddenError) {
    sendProblem(reply, 'forbidden')
    return true
  }
  if (err instanceof EventConflictError) {
    sendProblem(reply, 'conflict')
    return true
  }
  return false
}

const eventIdParams = z.object({ eventId: z.string().uuid() })
const commentIdParams = z.object({ eventId: z.string().uuid(), commentId: z.string().uuid() })
const carpoolIdParams = z.object({ eventId: z.string().uuid(), carpoolId: z.string().uuid() })
const itemIdParams = z.object({ eventId: z.string().uuid(), itemId: z.string().uuid() })
const pollIdParams = z.object({ eventId: z.string().uuid(), pollId: z.string().uuid() })
const photoIdParams = z.object({ eventId: z.string().uuid(), photoId: z.string().uuid() })
const listQuerySchema = z.object({ from: z.string().optional(), to: z.string().optional() })

const eventsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Every *write* handler below wraps its service call in `try { ... } catch (err) { if
  // (!mapServiceError(err, reply)) throw err }`; the read handlers never did, because before H1.2
  // they could not raise a domain error. They can now (a `list*` for an event the caller cannot see
  // raises `EventNotFoundError`), and without this an uncaught one becomes a 500 logged as
  // "unhandled error" -- the wrong status for the client and a false alarm for the operator (H1.13,
  // H16.1). This plugin is registered with a prefix, so it is its own encapsulation context and this
  // handler covers exactly the events routes; anything that is not one of the module's three typed
  // errors is passed straight to the app-level handler, unchanged.
  app.setErrorHandler((err, _req, reply) => {
    if (mapServiceError(err, reply)) return
    throw err
  })

  const departmentChildSubject = (r: FastifyRequest) => ({
    kind: 'department_child' as const,
    departmentId: activeDepartmentId(r),
  })

  app.get(
    '/',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { querystring: listQuerySchema, response: { 200: eventListResponseSchema } },
    },
    async (req, reply) => {
      const items = await service.listEvents(
        toDbContext(req),
        req.actor!.userId,
        currentActor(req).isHead,
        {
          from: req.query.from ? new Date(req.query.from) : undefined,
          to: req.query.to ? new Date(req.query.to) : undefined,
        },
      )
      return reply.send({ items })
    },
  )

  app.post(
    '/',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { body: createEventBodySchema, response: { 201: eventSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const created = await service.createEvent(toDbContext(req), currentActor(req), req.body)
      return reply.code(201).send(created)
    },
  )

  app.get(
    '/:eventId',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: eventSchema } },
    },
    async (req, reply) => {
      try {
        const event = await service.getEvent(
          toDbContext(req),
          req.actor!.userId,
          currentActor(req).isHead,
          req.params.eventId,
        )
        reply.send(event)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.patch(
    '/:eventId',
    {
      config: { permission: { action: 'update', subject: departmentChildSubject } },
      schema: {
        params: eventIdParams,
        body: updateEventBodySchema,
        response: { 200: eventSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const updated = await service.updateEvent(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body,
        )
        reply.send(updated)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.post(
    '/:eventId/cancel',
    {
      config: { permission: { action: 'update', subject: departmentChildSubject } },
      schema: {
        params: eventIdParams,
        body: cancelEventBodySchema,
        response: { 200: eventSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const cancelled = await service.cancelEvent(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body.reason,
        )
        reply.send(cancelled)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.get(
    '/:eventId/ics',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: icsResponseSchema } },
    },
    async (req, reply) => {
      try {
        const ics = await service.exportEventIcs(toDbContext(req), req.params.eventId)
        reply.send(ics)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  // --- RSVPs ---------------------------------------------------------------------------------------

  app.post(
    '/:eventId/rsvp',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: eventIdParams, body: rsvpBodySchema, response: { 200: eventSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const updated = await service.upsertRsvp(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body,
        )
        reply.send(updated)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.get(
    '/:eventId/rsvps',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: rsvpListResponseSchema } },
    },
    async (req, reply) => {
      const items = await service.listRsvps(toDbContext(req), req.params.eventId)
      return reply.send({ items })
    },
  )

  // --- Comments --------------------------------------------------------------------------------------

  app.get(
    '/:eventId/comments',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: commentListResponseSchema } },
    },
    async (req, reply) => {
      const items = await service.listComments(
        toDbContext(req),
        req.actor!.userId,
        req.params.eventId,
      )
      return reply.send({ items })
    },
  )

  app.post(
    '/:eventId/comments',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: eventIdParams, body: commentBodySchema, response: { 201: commentDto } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const comment = await service.addComment(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body.body,
        )
        reply.code(201).send(comment)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.delete(
    '/:eventId/comments/:commentId',
    {
      config: { permission: { action: 'delete', subject: departmentChildSubject } },
      schema: { params: commentIdParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        await service.deleteComment(toDbContext(req), currentActor(req), req.params.commentId)
        reply.code(204).send()
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  // --- Carpools --------------------------------------------------------------------------------------

  app.get(
    '/:eventId/carpools',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: carpoolListResponseSchema } },
    },
    async (req, reply) => {
      const items = await service.listCarpools(
        toDbContext(req),
        req.actor!.userId,
        currentActor(req).isHead,
        req.params.eventId,
      )
      return reply.send({ items })
    },
  )

  app.post(
    '/:eventId/carpools',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: eventIdParams, body: carpoolBodySchema, response: { 201: carpoolDto } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const carpool = await service.createCarpool(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body,
        )
        reply.code(201).send(carpool)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.post(
    '/:eventId/carpools/:carpoolId/claim',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: carpoolIdParams, body: carpoolClaimBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        await service.claimCarpoolSeat(
          toDbContext(req),
          currentActor(req),
          req.params.carpoolId,
          req.body.seats,
        )
        reply.code(204).send()
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.delete(
    '/:eventId/carpools/:carpoolId/claim',
    {
      config: { permission: { action: 'delete', subject: departmentChildSubject } },
      schema: { params: carpoolIdParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        await service.releaseCarpoolSeat(toDbContext(req), currentActor(req), req.params.carpoolId)
        reply.code(204).send()
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  // --- Items ("who brings what") ----------------------------------------------------------------------

  app.get(
    '/:eventId/items',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: itemListResponseSchema } },
    },
    async (req, reply) => {
      const items = await service.listItems(toDbContext(req), req.actor!.userId, req.params.eventId)
      return reply.send({ items })
    },
  )

  app.post(
    '/:eventId/items',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: eventIdParams, body: itemBodySchema, response: { 201: itemDto } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const item = await service.addItem(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body,
        )
        reply.code(201).send(item)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.post(
    '/:eventId/items/:itemId/claim',
    {
      config: { permission: { action: 'update', subject: departmentChildSubject } },
      schema: { params: itemIdParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const claimed = await service.claimItem(
        toDbContext(req),
        currentActor(req),
        req.params.itemId,
      )
      if (!claimed) {
        sendProblem(reply, 'conflict')
        return
      }
      return reply.code(204).send()
    },
  )

  app.delete(
    '/:eventId/items/:itemId/claim',
    {
      config: { permission: { action: 'update', subject: departmentChildSubject } },
      schema: { params: itemIdParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const released = await service.releaseItem(
        toDbContext(req),
        currentActor(req),
        req.params.itemId,
      )
      if (!released) {
        sendProblem(reply, 'conflict')
        return
      }
      return reply.code(204).send()
    },
  )

  // --- Polls -----------------------------------------------------------------------------------------

  app.get(
    '/:eventId/polls',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: pollListResponseSchema } },
    },
    async (req, reply) => {
      const items = await service.listPolls(
        toDbContext(req),
        req.actor!.userId,
        currentActor(req).isHead,
        req.params.eventId,
      )
      return reply.send({ items })
    },
  )

  app.post(
    '/:eventId/polls',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: eventIdParams, body: pollBodySchema, response: { 201: pollDto } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const poll = await service.createPoll(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body,
        )
        reply.code(201).send(poll)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.post(
    '/:eventId/polls/:pollId/vote',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: pollIdParams, body: pollVoteBodySchema, response: { 200: pollDto } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const poll = await service.voteOnPoll(
          toDbContext(req),
          currentActor(req),
          req.params.pollId,
          req.body.optionIds,
        )
        reply.send(poll)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  // --- Photos ----------------------------------------------------------------------------------------

  app.get(
    '/:eventId/photos',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: photoListResponseSchema } },
    },
    async (req, reply) => {
      const items = await service.listPhotos(
        toDbContext(req),
        req.actor!.userId,
        req.params.eventId,
      )
      return reply.send({ items })
    },
  )

  app.post(
    '/:eventId/photos',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: eventIdParams, body: photoBodySchema, response: { 201: photoDto } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const photo = await service.addPhoto(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body,
        )
        reply.code(201).send(photo)
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  app.delete(
    '/:eventId/photos/:photoId',
    {
      config: { permission: { action: 'delete', subject: departmentChildSubject } },
      schema: { params: photoIdParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        await service.deletePhoto(toDbContext(req), currentActor(req), req.params.photoId)
        reply.code(204).send()
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  // --- Feedback ----------------------------------------------------------------------------------------

  app.get(
    '/:eventId/feedback',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { params: eventIdParams, response: { 200: feedbackListResponseSchema } },
    },
    async (req, reply) => {
      const result = await service.listFeedback(
        toDbContext(req),
        req.actor!.userId,
        req.params.eventId,
      )
      return reply.send(result)
    },
  )

  app.post(
    '/:eventId/feedback',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { params: eventIdParams, body: feedbackBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        await service.submitFeedback(
          toDbContext(req),
          currentActor(req),
          req.params.eventId,
          req.body,
        )
        reply.code(204).send()
      } catch (err) {
        if (!mapServiceError(err, reply)) throw err
      }
    },
  )

  // --- Personal ICS feed -----------------------------------------------------------------------------
  // Fastify's router (find-my-way) always prefers a static path segment over a parametric one at the
  // same depth, regardless of registration order -- so `GET /events/ics/me` matches this route, never
  // `/events/:eventId` with `eventId="ics"` followed by a non-existent `/me` segment, and
  // `/events/:eventId/ics` (a different depth entirely) is unaffected either way.

  app.get(
    '/ics/me',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'own_account', userId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: icsResponseSchema } },
    },
    async (req, reply) => {
      const ics = await service.exportMyIcs(toDbContext(req), req.actor!.userId)
      return reply.send(ics)
    },
  )
}

export default eventsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/events`.
export const prefix = '/events'
