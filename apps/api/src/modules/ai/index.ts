// /api/v1/ai/* (TECH-SPEC §8, TASKS.md EPIC-012). Fastify plugin -- auto-discovered by
// `apps/api/src/module-loader.ts` (MODULE-GUIDE.md "API modules"). Every route declares
// `config.permission`; every mutation checks CSRF exactly like `PATCH /api/v1/me`; every handler talks
// only to `service.ts`, never `@devon/db` or `@devon/ai` directly.
//
// `POST /ai/features/:feature/run` is one dynamic route for all ten features (TECH-SPEC §8's list)
// rather than ten near-identical route blocks -- the feature id is validated against the same literal
// tuple `@devon/ai`'s own `AiFeature` union uses (`schemas.ts`'s `aiFeatureSchema`), and the actual
// per-feature input/output validation happens inside `@devon/ai`'s `runFeature()`. `plan_sprint` is
// the one personal-workspace feature (EPIC-009): its permission subject is `{kind:'personal'}` (I-1),
// never `department_child`, even though its budget/flag still bills to the caller's active department.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import type { RequestContext } from '@devon/db'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { contextDepartmentRole, isHeadOf } from '../../lib/actor.js'
import type { Subject } from '@devon/contracts'
import {
  AiBudgetExceededError,
  AiFeatureDisabledError,
  AiInputValidationError,
  AiRunFailedError,
  AiUnavailableError,
} from './errors.js'
import * as service from './service.js'
import {
  aiSettingsSchema,
  featureParamsSchema,
  patchAiSettingsBodySchema,
  runFeatureBodySchema,
  runFeatureResponseSchema,
  usageListResponseSchema,
  usageQuerySchema,
  type RunFeatureResponse,
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
    // The per-department membership role, which is what `app.current_department_role()` (and
    // therefore `ai_department_settings_write`, migration 0904) actually needs. Passing
    // `Actor.role` here -- the instance-wide role, always `'member'` for a real head -- was the
    // reason a fresh department's first `GET /ai/settings` 500'd on its own lazy INSERT.
    departmentRole: contextDepartmentRole(
      req.actor,
      req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? null,
    ),
    actingForUserId: null,
    viewAs: req.actor?.viewAs != null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

const departmentChildSubject = (req: {
  actor: { departmentId: string | null } | null
}): Subject => ({
  kind: 'department_child',
  departmentId: req.actor?.departmentId ?? '',
})

const departmentSubject = (req: { actor: { departmentId: string | null } | null }): Subject => ({
  kind: 'department',
  departmentId: req.actor?.departmentId ?? '',
})

/** `plan_sprint` is the only personal-workspace feature (TECH-SPEC §8): I-1 requires `{kind:
 * 'personal'}` for it specifically, never `department_child`, regardless of which department its
 * budget/flag happen to bill against. Every other feature is a department tool any member may use. */
function featureRunSubject(req: FastifyRequest): Subject {
  const params = req.params as { feature?: string }
  if (params.feature === 'plan_sprint') {
    return { kind: 'personal', ownerUserId: req.actor?.userId ?? '' }
  }
  return {
    kind: 'department_child',
    departmentId: req.actor?.departmentId ?? '',
  }
}

const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/settings',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: { response: { 200: aiSettingsSchema } },
    },
    async (req) => {
      // D2a: budget, spend, % used and budget status are the head's (audit §4.11 -- "a money figure
      // for the department"). A member still gets the feature flags, so they know which helpers they
      // may use; the four money fields are simply absent from their payload, never zeroed (a zero
      // would read as "no budget", which is a different, wrong statement).
      return service.getSettingsWithUsage(
        toDbContext(req),
        activeDepartmentId(req),
        isHeadOf(req.actor, activeDepartmentId(req)),
      )
    },
  )

  app.patch(
    '/settings',
    {
      config: { permission: { action: 'update', subject: departmentSubject } },
      schema: {
        body: patchAiSettingsBodySchema,
        response: { 200: aiSettingsSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const dto = await service.patchSettings(toDbContext(req), activeDepartmentId(req), req.body)
      reply.send(dto)
    },
  )

  app.get(
    '/usage',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: {
        querystring: usageQuerySchema,
        response: { 200: usageListResponseSchema },
      },
    },
    async (req) => {
      // D2b: who asked the AI what, how often and at what cost is surveillance-grade. A member sees
      // their own runs (useful self-awareness); the head sees the department's.
      const departmentId = activeDepartmentId(req)
      const traces = await service.listUsage(
        toDbContext(req),
        departmentId,
        req.query.limit ?? 50,
        {
          onlyUserId: isHeadOf(req.actor, departmentId) ? null : (req.actor?.userId ?? ''),
        },
      )
      return { traces }
    },
  )

  app.post(
    '/features/:feature/run',
    {
      config: {
        permission: { action: 'create', subject: featureRunSubject },
        // H1.9: the one endpoint in this API that spends money and calls a third party per request.
        // The per-department budget (TECH-SPEC §8) caps the monthly cost; this caps the burst, so a
        // single compromised session cannot exhaust a department's whole month in one minute.
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        params: featureParamsSchema,
        body: runFeatureBodySchema,
        response: { 200: runFeatureResponseSchema },
      },
      // H7.4 "AI input length": checked in `preValidation`, ahead of the permission `preHandler` and
      // ahead of `@devon/ai`'s own per-feature `inputSchema` (which only runs once `input` has
      // already been hashed for the cache key and is about to reach a provider call) -- an oversized
      // body is rejected before spending either a permission lookup or a provider call on it, the
      // same "cheapest checks first" posture `app.ts`'s app-wide body-size/JSON-depth limits already
      // have. `req.body` here is the parsed JSON object (parsing happens before `preValidation`) but
      // not yet Zod-validated against `runFeatureBodySchema`, so `input` may not even be an object
      // yet -- the guard below only measures it when it plausibly is one.
      preValidation: async (req, reply) => {
        const body = req.body as { input?: unknown } | undefined
        if (body && typeof body === 'object' && 'input' in body) {
          const inputByteLength = Buffer.byteLength(JSON.stringify(body.input), 'utf8')
          if (inputByteLength > app.devonConfig.AI_MAX_INPUT_BYTES) {
            sendProblem(reply, 'validation_failed', {
              errors: [{ path: 'input', code: 'too_large' }],
            })
          }
        }
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const outcome = await service.runFeatureForActor(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          userId: req.actor!.userId,
          feature: req.params.feature,
          input: req.body.input,
        })
        // `req.params.feature` was already validated against `aiFeatureSchema`'s literal tuple, but
        // `service.ts`'s `RunFeatureOutcome` widens it back to `string` at its own boundary (it is a
        // plain business-logic function, not itself a Zod consumer) -- `runFeatureResponseSchema`
        // re-validates this at the HTTP layer regardless, so the cast is safe, not a trust shortcut.
        reply.send(outcome as unknown as RunFeatureResponse)
      } catch (err) {
        if (err instanceof AiInputValidationError) {
          return sendProblem(reply, 'validation_failed', {
            errors: [{ path: 'input', code: 'invalid' }],
          })
        }
        if (err instanceof AiFeatureDisabledError) {
          return sendProblem(reply, 'forbidden', {
            errors: [{ path: 'feature', code: 'disabled' }],
          })
        }
        if (err instanceof AiBudgetExceededError) {
          return sendProblem(reply, 'forbidden', {
            errors: [{ path: 'budget', code: 'exceeded' }],
          })
        }
        if (err instanceof AiRunFailedError) {
          return sendProblem(reply, 'internal')
        }
        if (err instanceof AiUnavailableError) {
          // Same 503 "try again later" shape the ClamAV-outage path uses (H8.1 graceful degradation).
          return sendProblem(reply, 'maintenance')
        }
        throw err
      }
    },
  )
}

export default aiRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/ai`.
export const prefix = '/ai'

// Re-exported so `test/unit/ai/*.test.ts` can build request-shaped subjects the same way this file
// does, without duplicating the "plan_sprint is personal, everything else is department_child" rule.
export { featureRunSubject }
