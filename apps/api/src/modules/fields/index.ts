// Custom fields (v1.1 SPEC §5) -- department-defined columns on people and on cards, the answers, and
// the head's "notify to fill". Auto-discovered by `apps/api/src/module-loader.ts`; mounted at
// `/api/v1/fields`. `app.ts` is never edited to add a module (MODULE-GUIDE.md "API modules").
//
// The permission split, decided by subject kind rather than by an `isHead` check inside a handler
// (I-7, SPEC §2.1):
//
// | route                                  | subject                | who                      |
// |----------------------------------------|------------------------|--------------------------|
// | GET  /fields/defs                      | `department_child`     | any active member        |
// | POST/PATCH/archive/restore/reorder     | `department_managed`   | the boshqarma boshligʻi  |
// | POST /fields/defs/:id/notify           | `department_managed`   | the head                 |
// | POST /fields/notify                    | `department_managed`   | the head                 |
// | GET  /fields/values (about me)         | `owned`                | the person themselves    |
// | GET  /fields/values (about anyone else)| `department_managed`   | the boshqarma boshligʻi  |
// | PUT  /fields/values                    | `owned`                | the subject, or the head |
// | GET/PUT /fields/me                     | `own_account`          | the person themselves    |
//
// `GET /fields/defs` is deliberately open to every member: a *definition* is a form label, and the
// member fill screen cannot render without it. The *answers* are what PERMISSIONS-AUDIT §4.13 protects.
//
// **v1.1 critique SEV1 #1.** Until this round `GET /values` was declared `department_child`, whose P3
// rule grants any active member every action, and the service used `isHead` only to decide whether to
// write `audit.private_reads` rows. A xodim could read all 27 colleagues' answers -- unfiltered,
// unaudited, `visible_to: 'head_only'` ignored -- in a government system holding personal data. It is
// closed in three independent places now, none of which relies on the other two: the subject function
// below (`valuesReadSubject`) refuses the query outright, `service.listValues` filters to the caller's
// own `subject_user_id`, and `repo.listValues` does the same narrowing in SQL. RLS
// (`field_values_read`) remains under all three.
import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { RequestContext } from '@devon/db'
import {
  FIELD_CAPS,
  type FieldAppliesTo,
  type FieldOption,
  type FieldValue,
} from '@devon/contracts'
import { contextDepartmentRole, isHeadOf } from '../../lib/actor.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { sendProblem } from '../../lib/problem-reply.js'
import * as service from './service.js'
import { FieldForbiddenError, FieldNotFoundError, FieldRefusedError } from './errors.js'
import { startFieldReminderSweep } from './reminders.js'
import {
  createDefSchema,
  defParamsSchema,
  defResponseSchema,
  defsQuerySchema,
  defsResponseSchema,
  myFieldsResponseSchema,
  notifyManyResponseSchema,
  notifyManySchema,
  notifyResponseSchema,
  notifyScopeSchema,
  reorderSchema,
  setManySchema,
  setValueSchema,
  updateDefSchema,
  valuesQuerySchema,
  valuesResponseSchema,
} from './schemas.js'

function activeDepartmentId(req: FastifyRequest): string {
  return req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? ''
}

function toDbContext(req: FastifyRequest): RequestContext {
  const departmentId = activeDepartmentId(req)
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    departmentId,
    departmentRole: contextDepartmentRole(req.actor, departmentId),
    actingForUserId: null,
    viewAs: req.actor?.viewAs != null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
}

/** Every domain error this module can raise, mapped to the exact Problem the rest of the API uses.
 * A refusal carries a machine code (`personal_data`, `cap_reached`, ...) and never a sentence -- the
 * translated sentence lives under `fields.error.<code>` in the four locale files. */
function replyForError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof FieldNotFoundError) {
    sendProblem(reply, 'not_found')
    return true
  }
  if (err instanceof FieldForbiddenError) {
    sendProblem(reply, 'forbidden')
    return true
  }
  if (err instanceof FieldRefusedError) {
    sendProblem(
      reply,
      err.code === 'cap_reached' || err.code === 'duplicate_key' ? 'conflict' : 'validation_failed',
      {
        errors: [{ path: err.path, code: err.code }],
      },
    )
    return true
  }
  return false
}

/** The label/description maps arrive as partial records (a head may fill only their own locale);
 * everything downstream wants a plain object with no `undefined` holes. */
function compactMap(
  map: Partial<Record<string, string>> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [locale, text] of Object.entries(map ?? {})) {
    if (typeof text === 'string' && text.trim().length > 0) out[locale] = text.trim()
  }
  return out
}

function compactOptions(
  options: ReadonlyArray<{
    id: string
    label: Partial<Record<string, string>>
    colorToken: string
    order: number
  }>,
): FieldOption[] {
  return options.map((o) => ({
    id: o.id,
    label: compactMap(o.label),
    colorToken: o.colorToken,
    order: o.order,
  }))
}

/** `FieldValue` allows a `readonly string[]` (a multi-select answer); the wire schema is a plain
 * array. This copy is the one place the two meet -- the same shape `modules/people/index.ts` uses for
 * its list indicators. */
function wireValue(value: FieldValue): string | number | boolean | string[] | null {
  return Array.isArray(value) ? [...value] : ((value ?? null) as string | number | boolean | null)
}

/** One definition, flattened for the wire: mutable arrays, plain records. */
function wireDef(def: service.FieldDefDto) {
  return {
    ...def,
    label: { ...def.label },
    description: def.description ? { ...def.description } : null,
    options: def.options.map((o) => ({ ...o, label: { ...o.label } })),
    defaultValue: wireValue(def.defaultValue),
  }
}

const fieldsRoutes: FastifyPluginAsyncZod = async (app) => {
  const departmentChildSubject = (r: FastifyRequest) => ({
    kind: 'department_child' as const,
    departmentId: activeDepartmentId(r),
  })
  const departmentManagedSubject = (r: FastifyRequest) => ({
    kind: 'department_managed' as const,
    departmentId: activeDepartmentId(r),
  })
  const ownAccountSubject = (r: FastifyRequest) => ({
    kind: 'own_account' as const,
    userId: r.actor?.userId ?? '',
  })

  /**
   * v1.1 critique SEV1 #1: the shape of the *question* decides the subject.
   *
   * `GET /values` serves two genuinely different reads. "Show me my own answers" is an `owned` read
   * any member may make. "Show me these colleagues' answers" is per-person analytics, which SPEC §2.1
   * puts squarely under `department_managed` -- head only, reads included. A member who asks for
   * anyone but themselves now gets a 403 from `can()` before a single row is fetched, instead of the
   * old `department_child` (whose P3 rule grants any active member every action).
   *
   * Person values are keyed by *membership* id, which a route function cannot resolve to a user id
   * synchronously. So the rule is conservative in the only direction that is safe: a query is "about
   * me" only when it names me by `userIds` and nothing else. Everything broader is head territory.
   */
  const valuesReadSubject = (r: FastifyRequest) => {
    const departmentId = activeDepartmentId(r)
    const actorUserId = r.actor?.userId ?? ''
    const query = (r.query ?? {}) as {
      subjectType?: string
      subjectIds?: string
      userIds?: string
    }
    if (query.subjectType === 'card') {
      // Card values are department-transparent, exactly like the card they hang off.
      return { kind: 'department_child' as const, departmentId }
    }
    // Everything else -- including the boot-time probe's empty request, which is why this route is
    // listed in `head-only-routes.test.ts` -- falls to the head-only branch unless it is provably a
    // question about the caller themselves. Fail closed, then widen.
    const subjectIds = splitList(query.subjectIds)
    const userIds = splitList(query.userIds)
    const onlyMe =
      subjectIds.length === 0 && userIds.length === 1 && userIds[0] === actorUserId && actorUserId
    if (onlyMe) {
      return {
        kind: 'owned' as const,
        departmentId,
        ownerUserIds: [actorUserId],
      }
    }
    return { kind: 'department_managed' as const, departmentId }
  }

  /** A person value belongs to the person it is about; a card value to the department. Either way the
   * owner set is what `can()` decides on, not an `isHead` branch inside the handler (I-7). */
  const valuesWriteSubject = (r: FastifyRequest) => {
    const departmentId = activeDepartmentId(r)
    const body = (r.body ?? {}) as { subjectUserId?: string | null }
    const actorUserId = r.actor?.userId ?? ''
    const target = body.subjectUserId ?? actorUserId
    return {
      kind: 'owned' as const,
      departmentId,
      ownerUserIds: target ? [target] : [],
    }
  }

  // --- definitions ---------------------------------------------------------------------------------

  app.get(
    '/defs',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: {
        querystring: defsQuerySchema,
        response: { 200: defsResponseSchema },
      },
    },
    async (req) => {
      const departmentId = activeDepartmentId(req)
      const isHead = isHeadOf(req.actor, departmentId)
      const defs = await service.listDefs(toDbContext(req), {
        departmentId,
        appliesTo: (req.query.appliesTo ?? null) as FieldAppliesTo | null,
        includeArchived: req.query.includeArchived === true,
        withProgress: isHead,
      })
      return {
        defs: defs.map(wireDef),
        caps: { card: FIELD_CAPS.card, person: FIELD_CAPS.person },
        canManage: isHead,
      }
    },
  )

  app.post(
    '/defs',
    {
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
      },
      schema: { body: createDefSchema, response: { 201: defResponseSchema } },
    },
    async (req, reply) => {
      try {
        const def = await service.createDef(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          actorUserId: req.actor!.userId,
          appliesTo: req.body.appliesTo,
          key: req.body.key,
          label: compactMap(req.body.label),
          description: req.body.description ? compactMap(req.body.description) : null,
          type: req.body.type,
          options: compactOptions(req.body.options),
          required: req.body.required,
          defaultValue: req.body.defaultValue,
          showInTable: req.body.showInTable,
          showOnCardTile: req.body.showOnCardTile,
          selfEditable: req.body.selfEditable,
          visibleTo: req.body.visibleTo,
          reminderDays: req.body.reminderDays,
        })
        reply.code(201)
        return { def: wireDef(def) }
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }
    },
  )

  app.patch(
    '/defs/:id',
    {
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
      },
      schema: {
        params: defParamsSchema,
        body: updateDefSchema,
        response: { 200: defResponseSchema },
      },
    },
    async (req, reply) => {
      try {
        const def = await service.updateDef(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          actorUserId: req.actor!.userId,
          defId: req.params.id,
          patch: {
            ...(req.body.label !== undefined ? { label: compactMap(req.body.label) } : {}),
            ...(req.body.description !== undefined
              ? {
                  description: req.body.description ? compactMap(req.body.description) : null,
                }
              : {}),
            ...(req.body.type !== undefined ? { type: req.body.type } : {}),
            ...(req.body.options !== undefined
              ? { options: compactOptions(req.body.options) }
              : {}),
            ...(req.body.required !== undefined ? { required: req.body.required } : {}),
            ...(req.body.defaultValue !== undefined ? { defaultValue: req.body.defaultValue } : {}),
            ...(req.body.showInTable !== undefined ? { showInTable: req.body.showInTable } : {}),
            ...(req.body.showOnCardTile !== undefined
              ? { showOnCardTile: req.body.showOnCardTile }
              : {}),
            ...(req.body.selfEditable !== undefined ? { selfEditable: req.body.selfEditable } : {}),
            ...(req.body.visibleTo !== undefined ? { visibleTo: req.body.visibleTo } : {}),
            ...(req.body.reminderDays !== undefined ? { reminderDays: req.body.reminderDays } : {}),
          },
        })
        return { def: wireDef(def) }
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }
    },
  )

  // Archive and restore are two routes rather than a flag, because the pair is what makes the
  // manager's undo a single call with no body to get wrong (DESIGN.md: undo over confirm).
  app.post(
    '/defs/:id/archive',
    {
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
      },
      schema: { params: defParamsSchema, response: { 200: defResponseSchema } },
    },
    async (req, reply) => {
      try {
        const def = await service.setArchived(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          actorUserId: req.actor!.userId,
          defId: req.params.id,
          archived: true,
        })
        return { def: wireDef(def) }
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }
    },
  )

  app.post(
    '/defs/:id/restore',
    {
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
      },
      schema: { params: defParamsSchema, response: { 200: defResponseSchema } },
    },
    async (req, reply) => {
      try {
        const def = await service.setArchived(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          actorUserId: req.actor!.userId,
          defId: req.params.id,
          archived: false,
        })
        return { def: wireDef(def) }
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }
    },
  )

  app.post(
    '/defs/reorder',
    {
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
      },
      schema: { body: reorderSchema, response: { 204: z.void() } },
    },
    async (req, reply) => {
      await service.reorder(toDbContext(req), {
        departmentId: activeDepartmentId(req),
        actorUserId: req.actor!.userId,
        ids: req.body.ids,
      })
      reply.code(204)
      return undefined
    },
  )

  app.post(
    '/defs/:id/notify',
    {
      config: {
        permission: { action: 'create', subject: departmentManagedSubject },
      },
      schema: {
        params: defParamsSchema,
        body: notifyScopeSchema.optional(),
        response: { 200: notifyResponseSchema },
      },
    },
    async (req, reply) => {
      try {
        return await service.notifyToFill(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          actorUserId: req.actor!.userId,
          defId: req.params.id,
          userIds: req.body?.userIds ?? null,
        })
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }
    },
  )

  /** SEV2 #6: the same ask, from the people table's row action and bulk bar, where the head is
   * looking at *people* rather than at one field. `defIds`/`userIds` omitted means "all of them". */
  app.post(
    '/notify',
    {
      config: {
        permission: { action: 'create', subject: departmentManagedSubject },
      },
      schema: {
        body: notifyManySchema,
        response: { 200: notifyManyResponseSchema },
      },
    },
    async (req, reply) => {
      try {
        return await service.notifyMany(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          actorUserId: req.actor!.userId,
          defIds: req.body.defIds ?? null,
          userIds: req.body.userIds ?? null,
        })
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }
    },
  )

  // --- values ---------------------------------------------------------------------------------------

  app.get(
    '/values',
    {
      config: { permission: { action: 'read', subject: valuesReadSubject } },
      schema: {
        querystring: valuesQuerySchema,
        response: { 200: valuesResponseSchema },
      },
    },
    async (req) => {
      const departmentId = activeDepartmentId(req)
      const values = await service.listValues(toDbContext(req), {
        departmentId,
        subjectType: req.query.subjectType,
        subjectIds: splitList(req.query.subjectIds),
        userIds: splitList(req.query.userIds),
        isHead: isHeadOf(req.actor, departmentId),
        actorUserId: req.actor!.userId,
      })
      return {
        values: values.map((v) => ({ ...v, value: wireValue(v.value) })),
      }
    },
  )

  app.put(
    '/values',
    {
      config: { permission: { action: 'update', subject: valuesWriteSubject } },
      schema: { body: setValueSchema, response: { 204: z.void() } },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      try {
        await service.setValue(toDbContext(req), {
          departmentId,
          actorUserId: req.actor!.userId,
          isHead: isHeadOf(req.actor, departmentId),
          defId: req.body.defId,
          subjectId: req.body.subjectId,
          subjectUserId: req.body.subjectUserId,
          value: req.body.value,
        })
        reply.code(204)
        return undefined
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }
    },
  )

  // --- "Mening maʼlumotlarim" -------------------------------------------------------------------------

  app.get(
    '/me',
    {
      config: { permission: { action: 'read', subject: ownAccountSubject } },
      schema: { response: { 200: myFieldsResponseSchema } },
    },
    async (req) => {
      const result = await service.myFields(toDbContext(req), {
        departmentId: activeDepartmentId(req),
        userId: req.actor!.userId,
      })
      return {
        ...result,
        fields: result.fields.map((f) => ({
          ...f,
          def: wireDef(f.def),
          value: wireValue(f.value),
        })),
      }
    },
  )

  app.put(
    '/me',
    {
      config: { permission: { action: 'update', subject: ownAccountSubject } },
      schema: {
        body: setManySchema,
        response: { 200: myFieldsResponseSchema },
      },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      try {
        // A person answers a handful of fields at once; each write is its own transaction so one
        // rejected value does not roll back the four that were fine, and the loop is over a bounded
        // form, not over rows (I-14).
        for (let i = 0; i < req.body.items.length; i += 1) {
          const item = req.body.items[i]!
          // nosemgrep: query-in-loop -- repeated defIds are allowed; preserve submitted write order and stop on first invalid value.
          await service.setValue(toDbContext(req), {
            departmentId,
            actorUserId: req.actor!.userId,
            isHead: false,
            defId: item.defId,
            subjectUserId: req.actor!.userId,
            value: item.value,
          })
        }
      } catch (err) {
        if (replyForError(reply, err)) return reply
        throw err
      }

      const result = await service.myFields(toDbContext(req), {
        departmentId,
        userId: req.actor!.userId,
      })
      return {
        ...result,
        fields: result.fields.map((f) => ({
          ...f,
          def: wireDef(f.def),
          value: wireValue(f.value),
        })),
      }
    },
  )

  // SPEC §5: "a reminder job after N days (default 3, configurable)". Started here, in the plugin
  // body, and never under `NODE_ENV=test` -- the same guard `notifications/index.ts` puts on its
  // pg-boss crons, so the fast gate's unit tests never pick up a timer or need Postgres.
  if (app.devonConfig.NODE_ENV !== 'test') {
    const stop = startFieldReminderSweep(app.log)
    app.addHook('onClose', async () => stop())
  }
}

export default fieldsRoutes

export const prefix = '/fields'
