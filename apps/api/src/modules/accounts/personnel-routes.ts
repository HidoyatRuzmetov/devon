import {
  personnelRecordSchema,
  personnelWriteSchema,
  personnelTemplate,
  personnelExportRequestSchema,
  personnelExportResponseSchema,
  personnelExportFields,
  preparePersonnelExport,
  personnelImportRequestSchema,
  personnelImportResponseSchema,
} from '@devon/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from '../work/context.js'
import { getPersonnelRecord, savePersonnelRecord } from './personnel-repo.js'
import { identifyPersonnelNamesForActor, importPersonnelRecordForActor } from '../ai/service.js'
import { extractFileText } from '../ai/file-text.js'
import { ScannerUnavailable } from '../../lib/storage/clamav.js'
import { CircuitOpenError } from '../../lib/resilience/circuit-breaker.js'
import { clamav as clamavBreaker } from '../../lib/resilience/registry.js'
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
    '/personnel-record/import',
    {
      bodyLimit: 12_000_000,
      config: {
        permission,
        rateLimit: {
          max: 3,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req) => req.actor?.userId ?? req.ip,
        },
      },
      schema: {
        body: personnelImportRequestSchema,
        response: { 200: personnelImportResponseSchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (!checkCsrf(req, reply)) return
      const ctx = contextFromRequest(req)
      if (!ctx.userId || !(await getPersonnelRecord(ctx, ctx.userId)))
        return sendProblem(reply, 'forbidden')
      const bytes = Buffer.from(req.body.content, 'base64')
      if (
        !bytes.length ||
        bytes.length > 8 * 1024 * 1024 ||
        bytes.toString('base64') !== req.body.content
      )
        return sendProblem(reply, 'validation_failed')
      const controller = new AbortController()
      const abort = () => {
        if (!reply.raw.writableEnded) controller.abort()
      }
      reply.raw.on('close', abort)
      try {
        const verdict = await clamavBreaker.execute(() => app.storage.scanner.scan(bytes))
        if (verdict.verdict === 'infected') return sendProblem(reply, 'validation_failed')
        const source = await extractFileText(bytes, req.body.name)
        // Never pass a truncated or unreadable document as a complete extraction.
        if (source.status !== 'read') return sendProblem(reply, 'validation_failed')
        if (controller.signal.aborted) return
        return await importPersonnelRecordForActor(ctx, source.text, controller.signal)
      } catch (error) {
        if (error instanceof AiFeatureDisabledError || error instanceof AiBudgetExceededError)
          return sendProblem(reply, 'forbidden')
        if (error instanceof AiInputValidationError) return sendProblem(reply, 'validation_failed')
        if (
          error instanceof AiUnavailableError ||
          error instanceof AiRunFailedError ||
          error instanceof ScannerUnavailable ||
          error instanceof CircuitOpenError
        )
          return sendProblem(reply, 'maintenance')
        throw error
      } finally {
        reply.raw.off('close', abort)
      }
    },
  )
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
