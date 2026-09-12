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
// | GET  /fields/values                    | `department_child`     | any member; RLS removes  |
// |                                        |                        | head-only answers        |
// | PUT  /fields/values                    | `department_child`     | any member; the service  |
// |                                        |                        | decides whose answer     |
// | GET/PUT /fields/me                     | `own_account`          | the person themselves    |
//
// `GET /fields/defs` is deliberately open to every member: a *definition* is a form label, and the
// member fill screen cannot render without it. The *answers* are what PERMISSIONS-AUDIT §4.13 protects,
// and they are protected in the database (`field_values_read`), not by this file.
import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { RequestContext } from '@devon/db'
import { FIELD_CAPS, type FieldAppliesTo, type FieldOption } from '@devon/contracts'
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
  notifyResponseSchema,
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
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
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
    sendProblem(reply, err.code === 'cap_reached' || err.code === 'duplicate_key' ? 'conflict' : 'validation_failed', {
      errors: [{ path: err.path, code: err.code }],
    })
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
function wireValue(
  value: import('@devon/contracts').FieldValue,
): string | number | boolean | string[] | null {
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

  // --- definitions ---------------------------------------------------------------------------------

  app.get(
    '/defs',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { querystring: defsQuerySchema, response: { 200: defsResponseSchema } },
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
      config: { permission: { action: 'update', subject: departmentManagedSubject } },
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
      config: { permission: { action: 'update', subject: departmentManagedSubject } },
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
              ? { description: req.body.description ? compactMap(req.body.description) : null }
              : {}),
            ...(req.body.type !== undefined ? { type: req.body.type } : {}),
            ...(req.body.options !== undefined
              ? { options: compactOptions(req.body.options) }
              : {}),
            ...(req.body.required !== undefined ? { required: req.body.required } : {}),
            ...(req.body.defaultValue !== undefined
              ? { defaultValue: req.body.defaultValue }
              : {}),
            ...(req.body.showInTable !== undefined ? { showInTable: req.body.showInTable } : {}),
            ...(req.body.showOnCardTile !== undefined
              ? { showOnCardTile: req.body.showOnCardTile }
              : {}),
            ...(req.body.selfEditable !== undefined
              ? { selfEditable: req.body.selfEditable }
              : {}),
            ...(req.body.visibleTo !== undefined ? { visibleTo: req.body.visibleTo } : {}),
            ...(req.body.reminderDays !== undefined
              ? { reminderDays: req.body.reminderDays }
              : {}),
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
      config: { permission: { action: 'update', subject: departmentManagedSubject } },
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
      config: { permission: { action: 'update', subject: departmentManagedSubject } },
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
      config: { permission: { action: 'update', subject: departmentManagedSubject } },
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
      config: { permission: { action: 'create', subject: departmentManagedSubject } },
      schema: { params: defParamsSchema, response: { 200: notifyResponseSchema } },
    },
    async (req, reply) => {
      try {
        return await service.notifyToFill(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          actorUserId: req.actor!.userId,
          defId: req.params.id,
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
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { querystring: valuesQuerySchema, response: { 200: valuesResponseSchema } },
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
      return { values: values.map((v) => ({ ...v, value: wireValue(v.value) })) }
    },
  )

  app.put(
    '/values',
    {
      config: { permission: { action: 'update', subject: departmentChildSubject } },
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
      schema: { body: setManySchema, response: { 200: myFieldsResponseSchema } },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      try {
        // A person answers a handful of fields at once; each write is its own transaction so one
        // rejected value does not roll back the four that were fine, and the loop is over a bounded
        // form, not over rows (I-14).
        for (let i = 0; i < req.body.items.length; i += 1) {
          const item = req.body.items[i]!
          // nosemgrep: query-in-loop -- one form submission, at most 50 fields, each its own audited
          // transaction; see this handler's comment.
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
