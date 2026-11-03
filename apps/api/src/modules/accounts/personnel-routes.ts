import {
  personnelRecordSchema,
  personnelWriteSchema,
  personnelTemplate,
  personnelExportRequestSchema,
  personnelExportResponseSchema,
  personnelExportFields,
  preparePersonnelExport,
} from '@devon/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from '../work/context.js'
import { getPersonnelRecord, savePersonnelRecord } from './personnel-repo.js'
import { identifyPersonnelNamesForActor } from '../ai/service.js'
import {
  AiBudgetExceededError,
  AiFeatureDisabledError,
  AiInputValidationError,
  AiRunFailedError,
  AiUnavailableError,
} from '../ai/errors.js'

export const personnelRoutes: FastifyPluginAsyncZod = async (app) => {
  const permission = {
    action: 'read' as const,
    subject: () => ({ kind: 'authenticated' as const }),
  }
  app.post(
    '/personnel-record/prepare-export',
    {
      bodyLimit: 3_000_000,
      config: {
        permission,
        rateLimit: {
          max: 4,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req) => req.actor?.userId ?? req.ip,
        },
      },
      schema: {
        body: personnelExportRequestSchema,
        response: { 200: personnelExportResponseSchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (!checkCsrf(req, reply)) return
      const ctx = contextFromRequest(req)
      if (!(await getPersonnelRecord(ctx, req.body.ownerUserId)))
        return sendProblem(reply, 'not_found')
      if (personnelTemplate.validate(req.body.data).errors.length)
        return sendProblem(reply, 'validation_failed')
      const controller = new AbortController()
      const abort = () => {
        if (!reply.raw.writableEnded) controller.abort()
      }
      reply.raw.on('close', abort)
      try {
        const fields = personnelExportFields(req.body.data).filter((field) =>
          /[a-zа-яёўқғҳ]/iu.test(field.value),
        )
        const names = await identifyPersonnelNamesForActor(ctx, fields, controller.signal)
        const data = preparePersonnelExport(
          { ...req.body.data, protectedNames: names },
          req.body.script,
        )
        return { data, script: req.body.script }
      } catch (error) {
        if (error instanceof AiFeatureDisabledError || error instanceof AiBudgetExceededError)
          return sendProblem(reply, 'forbidden')
        if (error instanceof AiInputValidationError) return sendProblem(reply, 'validation_failed')
        if (error instanceof AiUnavailableError || error instanceof AiRunFailedError)
          return sendProblem(reply, 'maintenance')
        throw error
      } finally {
        reply.raw.off('close', abort)
      }
    },
  )
  app.get(
    '/personnel-record',
    {
      config: { permission },
      schema: {
        querystring: z.object({ ownerUserId: z.string().uuid().optional() }),
        response: { 200: personnelRecordSchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      const result = await getPersonnelRecord(
        contextFromRequest(req),
        req.query.ownerUserId ?? req.actor!.userId,
      )
      return result ?? sendProblem(reply, 'not_found')
    },
  )
  app.put(
    '/personnel-record',
    {
      bodyLimit: 3_000_000,
      config: {
        permission: {
          action: 'update',
          subject: (req) => ({ kind: 'personal', ownerUserId: req.actor?.userId ?? '' }),
        },
      },
      schema: { body: personnelWriteSchema, response: { 200: personnelRecordSchema } },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (!checkCsrf(req, reply)) return
      const ctx = contextFromRequest(req)
      if (!ctx.departmentId || ctx.viewAs) return sendProblem(reply, 'forbidden')
      const validation = personnelTemplate.validate(req.body.data)
      if (validation.errors.length)
        return sendProblem(reply, 'validation_failed', {
          errors: validation.errors.map((issue) => ({ path: issue.id, code: 'personnel_invalid' })),
        })
      const result = await savePersonnelRecord(ctx, req.body.data, req.body.version)
      return result ?? sendProblem(reply, 'conflict')
    },
  )
}
