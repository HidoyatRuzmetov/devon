// Calendar module (v1.1 SPEC §10, EPIC-019): per-person secret ICS feeds with regenerate/revoke, a
// read-only CalDAV surface over the same secret, per-event `.ics` downloads and "add to calendar"
// links. Auto-discovered by `apps/api/src/module-loader.ts`, mounted under `/api/v1` (`prefix = ''`)
// because the CalDAV paths must sit at a predictable place a calendar client can be told about.
//
// The feed URL is a bearer capability by necessity (a calendar app carries no cookie), so every
// route below treats the secret as a credential: it is 256 bits of CSPRNG output, it is never logged,
// it never appears in an audit row, the routes that consume it are rate limited, and the person can
// rotate or revoke it from `/calendar` in two clicks.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import {
  DAV_HEADER,
  XML_CONTENT_TYPE,
  calendarPropfind,
  calendarReport,
  homeSetPropfind,
  itemEtag,
  normaliseDepth,
  parseReport,
  principalPropfind,
  secretFromBasicAuth,
} from './caldav.js'
import { buildCalendar, buildSingleEvent, type CalendarLocale } from './ics.js'
import {
  googleCalendarUrl,
  office365Url,
  outlookLiveUrl,
  yahooCalendarUrl,
  type AddToCalendarInput,
} from './links.js'
import {
  createFeed,
  feedItem,
  feedItems,
  listFeeds,
  resolveFeed,
  revokeFeed,
  rotateFeed,
  touchFeed,
  userLocale,
  type FeedRow,
} from './repo.js'
import {
  addToCalendarQuerySchema,
  addToCalendarSchema,
  agendaQuerySchema,
  agendaSchema,
  createFeedBodySchema,
  feedListSchema,
  feedSchema,
  icsQuerySchema,
  localeSchema,
} from './schemas.js'

const API_BASE = '/api/v1'

function auditCtxFromReq(req: FastifyRequest): AuditCtx {
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    actingForUserId: null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

function asLocale(value: string | null | undefined): CalendarLocale {
  const parsed = localeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'uz-Latn'
}

function feedDto(row: FeedRow, publicUrl: string): z.infer<typeof feedSchema> {
  const path = `${API_BASE}/calendar/feed/${row.secret}.ics`
  const origin = publicUrl.replace(/\/$/, '')
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    // Absolute, not the bare `path`. This URL's whole purpose is to be pasted into software that is
    // not this application -- Google Calendar's "add by URL", Outlook's "subscribe from web" -- and a
    // relative path there resolves against *their* origin and 404s. Verified in the browser: the
    // subscriptions screen used to hand a person `/api/v1/calendar/feed/<secret>.ics`, which is
    // unusable everywhere it was meant to be used. `webcalUrl` and `caldavUrl` below were already
    // absolute, which is what made the inconsistency visible.
    url: `${origin}${path}`,
    // `webcal://` is what makes one click in Apple Calendar and Outlook desktop *subscribe* rather
    // than download a dead snapshot -- the single most common way an ICS feed gets used wrongly.
    webcalUrl: `webcal://${origin.replace(/^https?:\/\//, '')}${path}`,
    caldavUrl: `${origin}${API_BASE}/caldav/${row.secret}/`,
    createdAt: row.createdAt.toISOString(),
    rotatedAt: row.rotatedAt ? row.rotatedAt.toISOString() : null,
    lastAccessedAt: row.lastAccessedAt ? row.lastAccessedAt.toISOString() : null,
    accessCount: row.accessCount,
  }
}

const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  const publicUrl = app.devonConfig.DEVON_PUBLIC_URL

  // --- Feed management (the person's own, `personal` subject: no head exception, I-1) --------------

  app.get(
    '/calendar/feeds',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: feedListSchema } },
    },
    async (req, reply) => {
      const rows = await listFeeds(req.actor!.userId)
      return reply.send({ items: rows.map((row) => feedDto(row, publicUrl)) })
    },
  )

  app.post(
    '/calendar/feeds',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        body: createFeedBodySchema,
        response: { 200: feedSchema, 422: z.object({ code: z.string() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const existing = await listFeeds(req.actor!.userId)
      // Twenty live feeds per person is already generous (a phone, a laptop, a desktop, a shared
      // room screen); the cap exists so a scripted loop cannot mint credentials without limit.
      if (existing.length >= 20) return reply.code(422).send({ code: 'too_many_feeds' })
      const row = await createFeed(
        auditCtxFromReq(req),
        req.actor!.userId,
        req.body.kind,
        req.body.label,
      )
      return reply.type('application/json').send(feedDto(row, publicUrl))
    },
  )

  app.post(
    '/calendar/feeds/:id/rotate',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: feedSchema, 404: z.object({ code: z.string() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await rotateFeed(auditCtxFromReq(req), req.actor!.userId, req.params.id)
      if (!row) return reply.code(404).send({ code: 'not_found' })
      return reply.type('application/json').send(feedDto(row, publicUrl))
    },
  )

  app.delete(
    '/calendar/feeds/:id',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ revoked: z.boolean() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const revoked = await revokeFeed(auditCtxFromReq(req), req.actor!.userId, req.params.id)
      return reply.send({ revoked })
    },
  )

  /** The agenda the `/calendar` screen renders: exactly what the subscription feed contains, as
   * JSON, so what a person sees in WorkPortal and what lands in their phone's calendar can never
   * disagree -- one query, one visibility rule, two renderings. */
  app.get(
    '/calendar/agenda',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { querystring: agendaQuerySchema, response: { 200: agendaSchema } },
    },
    async (req, reply) => {
      const items = await feedItems(req.actor!.userId, 'all', {
        fromDays: 0,
        toDays: req.query.days,
      })
      return reply.send({
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          place: item.place,
          startsAt: item.startsAt.toISOString(),
          endsAt: item.endsAt.toISOString(),
          deepLink: item.deepLink,
          status: item.status,
        })),
      })
    },
  )

  // --- The feed itself (public: a calendar app carries no session cookie) --------------------------

  /** `GET /calendar/feed/<secret>.ics`. The `.ics` suffix is part of the path rather than a query
   * parameter because more than one desktop client decides how to treat a subscription by looking at
   * the extension. */
  app.get(
    '/calendar/feed/:secret',
    {
      config: { permission: { public: true } },
      // A feed URL is a credential, so the route is rate limited per IP the same way every other
      // pre-session route in this API is -- a leaked link must not also be a free amplifier.
      // (`@fastify/rate-limit` is registered globally in `app.ts`; this narrows it for this route.)
      schema: {
        params: z.object({ secret: z.string().min(16).max(140) }),
        querystring: icsQuerySchema,
      },
    },
    async (req, reply) => {
      const raw = req.params.secret
      const secret = raw.endsWith('.ics') ? raw.slice(0, -4) : raw
      const feed = await resolveFeed(secret)
      if (!feed) {
        // Identical answer for "never existed", "revoked" and "rotated away": a 404 with no body.
        return reply.code(404).send()
      }
      const [items, locale] = await Promise.all([
        feedItems(feed.userId, feed.kind),
        userLocale(feed.userId),
      ])
      const body = buildCalendar({
        items,
        locale: asLocale(req.query.locale ?? locale),
        publicUrl,
        reminderMinutes: req.query.alarm === undefined ? 30 : req.query.alarm || null,
      })
      // Bookkeeping after the body is built, never before: a failed render must not look like a
      // successful subscription on the person's own screen.
      void touchFeed(feed.id, feed.userId).catch(() => {})
      return (
        reply
          .header('content-type', 'text/calendar; charset=utf-8')
          .header('content-disposition', 'inline; filename="workportal.ics"')
          // Private: this body is one person's calendar and must never sit in a shared proxy cache.
          .header('cache-control', 'private, max-age=300')
          .send(body)
      )
    },
  )

  /** One event as a downloadable `.ics`, for the person who would rather attach it to a meeting than
   * subscribe to anything. Authenticated -- this one *does* have a session. */
  app.get(
    '/calendar/items/:id.ics',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ locale: localeSchema.optional() }),
      },
    },
    async (req, reply) => {
      const item = await feedItem(req.actor!.userId, req.params.id)
      if (!item) return reply.code(404).send()
      const locale = asLocale(req.query.locale ?? (await userLocale(req.actor!.userId)))
      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('content-disposition', `attachment; filename="${item.kind}-${item.id}.ics"`)
        .send(buildSingleEvent(item, locale, publicUrl))
    },
  )

  /** The "Kalendarga qoʻshish" menu's four links plus the `.ics` fallback, built server-side so the
   * four services' date formats live in one tested place (`links.ts`). */
  app.get(
    '/calendar/add-links',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        querystring: addToCalendarQuerySchema,
        response: { 200: addToCalendarSchema, 404: z.object({ code: z.string() }) },
      },
    },
    async (req, reply) => {
      const item = await feedItem(req.actor!.userId, req.query.eventId)
      if (!item) return reply.code(404).send({ code: 'not_found' })
      const origin = publicUrl.replace(/\/$/, '')
      const input: AddToCalendarInput = {
        title: item.title,
        description: item.body,
        place: item.place,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        eventUrl: `${origin}${item.deepLink}`,
      }
      return reply.send({
        google: googleCalendarUrl(input),
        outlook: outlookLiveUrl(input),
        office365: office365Url(input),
        yahoo: yahooCalendarUrl(input),
        ics: `${API_BASE}/calendar/items/${item.id}.ics`,
        title: item.title,
        startsAt: item.startsAt.toISOString(),
        endsAt: item.endsAt.toISOString(),
      })
    },
  )

  // --- CalDAV (read-only) ---------------------------------------------------------------------------
  //
  // `PROPFIND` and `REPORT` are not HTTP methods Fastify knows about, so they are registered with
  // `addHttpMethod` (Fastify 5's supported way to add one) before the routes that use them. Both
  // carry a body, hence `hasBody: true`.

  app.addHttpMethod('PROPFIND', { hasBody: true })
  app.addHttpMethod('REPORT', { hasBody: true })

  async function resolveFromRequest(req: FastifyRequest): Promise<{
    id: string
    secret: string
    userId: string
    kind: 'all' | 'events' | 'tasks'
  } | null> {
    const params = req.params as { secret?: string }
    const fromPath = params.secret ?? null
    const fromAuth = secretFromBasicAuth(req.headers.authorization)
    const secret = fromPath && fromPath.length >= 16 ? fromPath : fromAuth
    if (!secret) return null
    const feed = await resolveFeed(secret)
    return feed ? { id: feed.id, secret, userId: feed.userId, kind: feed.kind } : null
  }

  function davHeaders(reply: FastifyReply): FastifyReply {
    return reply
      .header('DAV', DAV_HEADER)
      .header('Allow', 'OPTIONS, GET, HEAD, PROPFIND, REPORT')
      .header('MS-Author-Via', 'DAV')
  }

  /** Discovery. A client that is given the bare `/caldav/` URL asks OPTIONS first; answering with
   * the DAV headers is what makes it continue instead of declaring the server "not a calendar". */
  app.options(
    '/caldav/*',
    { config: { permission: { public: true } }, schema: {} },
    async (_req, reply) => davHeaders(reply).code(204).send(),
  )

  app.route({
    method: 'PROPFIND' as 'GET',
    url: '/caldav/:secret/',
    config: { permission: { public: true } },
    handler: async (req, reply) => {
      const feed = await resolveFromRequest(req)
      if (!feed) return reply.code(404).send()
      const items = await feedItems(feed.userId, feed.kind)
      const displayName = 'WorkPortal'
      const depth = normaliseDepth(req.headers['depth'] as string | undefined)
      // Depth 1 on the principal is how most clients enumerate the home set: answer with the
      // principal *and* the one calendar collection it contains.
      const body =
        depth === '0'
          ? principalPropfind(API_BASE, feed.secret, displayName)
          : homeSetPropfind(API_BASE, feed.secret, displayName, items)
      return davHeaders(reply).code(207).header('content-type', XML_CONTENT_TYPE).send(body)
    },
  })

  app.route({
    method: 'PROPFIND' as 'GET',
    url: '/caldav/:secret/calendar/',
    config: { permission: { public: true } },
    handler: async (req, reply) => {
      const feed = await resolveFromRequest(req)
      if (!feed) return reply.code(404).send()
      const items = await feedItems(feed.userId, feed.kind)
      void touchFeed(feed.id, feed.userId).catch(() => {})
      return davHeaders(reply)
        .code(207)
        .header('content-type', XML_CONTENT_TYPE)
        .send(
          calendarPropfind(
            API_BASE,
            feed.secret,
            'WorkPortal',
            items,
            normaliseDepth(req.headers['depth'] as string | undefined),
          ),
        )
    },
  })

  app.route({
    method: 'REPORT' as 'GET',
    url: '/caldav/:secret/calendar/',
    config: { permission: { public: true } },
    handler: async (req, reply) => {
      const feed = await resolveFromRequest(req)
      if (!feed) return reply.code(404).send()
      const [items, locale] = await Promise.all([
        feedItems(feed.userId, feed.kind),
        userLocale(feed.userId),
      ])
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '')
      const report = parseReport(raw)
      return davHeaders(reply)
        .code(207)
        .header('content-type', XML_CONTENT_TYPE)
        .send(
          calendarReport(
            API_BASE,
            feed.secret,
            items,
            asLocale(locale),
            publicUrl,
            report.kind === 'calendar-multiget' ? (report.hrefs ?? []) : null,
          ),
        )
    },
  })

  /** One resource inside the collection. `<kind>-<uuid>.ics`, exactly the href the PROPFIND handed
   * out -- a client fetching anything else gets a 404, never a guess. */
  app.get(
    '/caldav/:secret/calendar/:resource',
    {
      config: { permission: { public: true } },
      schema: {
        params: z.object({
          secret: z.string().min(16).max(140),
          resource: z.string().min(5).max(80),
        }),
      },
    },
    async (req, reply) => {
      const feed = await resolveFromRequest(req)
      if (!feed) return reply.code(404).send()
      const match = /^(event|card)-([0-9a-f-]{36})\.ics$/i.exec(req.params.resource)
      if (!match) return reply.code(404).send()
      const item = await feedItem(feed.userId, match[2]!)
      if (!item || item.kind !== match[1]) return reply.code(404).send()
      const locale = asLocale(await userLocale(feed.userId))
      return davHeaders(reply)
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('ETag', itemEtag(item))
        .send(buildSingleEvent(item, locale, publicUrl))
    },
  )

  /** Everything a write-capable client might try. Answered honestly rather than with a 404, so the
   * client shows "read-only calendar" instead of "server broken". */
  for (const url of ['/caldav/:secret/calendar/', '/caldav/:secret/calendar/:resource']) {
    app.put(url, { config: { permission: { public: true } }, schema: {} }, async (_req, reply) =>
      davHeaders(reply).code(403).send(),
    )
    app.delete(url, { config: { permission: { public: true } }, schema: {} }, async (_req, reply) =>
      davHeaders(reply).code(403).send(),
    )
  }
}

export default calendarRoutes
export const prefix = ''
