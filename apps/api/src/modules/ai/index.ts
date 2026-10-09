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
import { requestBriefing, startBriefingJobs, type BriefingJobsHandle } from './briefing.js'
import { readBriefing } from './briefing-repo.js'
import {
  aiSettingsSchema,
  askBodySchema,
  askResponseSchema,
  featureParamsSchema,
  patchAiSettingsBodySchema,
  reindexResponseSchema,
  runFeatureBodySchema,
  runFeatureResponseSchema,
  searchBackendSchema,
  briefingResponseSchema,
  refreshBriefingBodySchema,
  refreshBriefingResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
  usageListResponseSchema,
  usageQuerySchema,
  type AskResponse,
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

const departmentManagedSubject = (req: {
  actor: { departmentId: string | null } | null
}): Subject => ({
  kind: 'department_managed',
  departmentId: req.actor?.departmentId ?? '',
})

/**
 * v1.1 SPEC §2.2 + §8. Three helpers exist to answer a management question about *other people* --
 * who is late (`board_risk_digest`), who should take this (`suggest_assignee`), and the department-
 * wide `catch_up` scope the head dashboard's Monday briefing runs. Those are `department_managed`:
 * head only, refused on the server, not merely hidden in the sidebar. Running them as a member was
 * exactly the role leakage the CTO found.
 *
 * `catch_up` is the interesting one: the *feature* is a member's own "what did I miss", and only the
 * `scope: 'department'` variant is managerial. The scope lives in the body, so the check that matters
 * is in `service.runFeatureForActor`'s caller below, not in the subject -- see `headOnlyScopeGuard`.
 */
const HEAD_ONLY_FEATURES = new Set(['board_risk_digest', 'suggest_assignee'])

/** `plan_sprint` is the only personal-workspace feature (TECH-SPEC §8): I-1 requires `{kind:
 * 'personal'}` for it specifically, never `department_child`, regardless of which department its
 * budget/flag happen to bill against. Every other feature is a department tool any member may use. */
function featureRunSubject(req: FastifyRequest): Subject {
  const params = req.params as { feature?: string }
  if (params.feature === 'plan_sprint') {
    return { kind: 'personal', ownerUserId: req.actor?.userId ?? '' }
  }
  if (params.feature && HEAD_ONLY_FEATURES.has(params.feature)) {
    return departmentManagedSubject(req)
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
      return reply.type('application/json').send(dto)
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
          onlyUserId:
            contextDepartmentRole(req.actor, departmentId) === 'head'
              ? null
              : (req.actor?.userId ?? ''),
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
      // H7.4 "AI input length": checked ahead of `@devon/ai`'s own per-feature `inputSchema` (which
      // only runs once `input` has already been hashed for the cache key and is about to reach a
      // provider call) -- an oversized body never costs a provider call.
      //
      // v1.1 integration: `plugins/authorize.ts` is a *global* `preValidation` hook now, and Fastify
      // runs a phase's global hooks before a route's own -- so this guard is reached only by a caller
      // who may run the feature, which is exactly the caller who could otherwise spend the
      // department's tokens. A stranger is refused without their payload being measured at all,
      // which is cheaper still.
      //
      // `req.body` here is the parsed JSON object (parsing happens before `preValidation`) but not
      // yet Zod-validated against `runFeatureBodySchema`, so `input` may not even be an object yet --
      // the guard below only measures it when it plausibly is one.
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
      // SPEC §8: `catch_up` is a member's own "what did I miss" -- except at `scope: 'department'`,
      // which is the head's Monday briefing over everyone's work. The feature id alone cannot carry
      // that distinction, so the scope is checked here, on the server, before a single token is
      // spent. Hiding the scope in the client would leave a member one `curl` away from a summary of
      // the whole department's week.
      if (
        req.params.feature === 'catch_up' &&
        (req.body.input as { scope?: unknown }).scope === 'department' &&
        !isHeadOf(req.actor, activeDepartmentId(req))
      ) {
        return sendProblem(reply, 'forbidden', {
          errors: [{ path: 'scope', code: 'head_only' }],
        })
      }
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
        reply.type('application/json').send(outcome as unknown as RunFeatureResponse)
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
          // SEV2 #23: a timeout is a 504 the person can retry, not a 500 they cannot.
          if (err.kind === 'timeout') {
            return sendProblem(reply, 'internal', {
              errors: [{ path: 'feature', code: 'timeout' }],
            })
          }
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

  // --- EPIC-016: semantic search + the Ask box ------------------------------------------------
  //
  // Both read the department's own cards, comments, pages and events, so both are plain
  // `department_child` reads: anything a member could open by clicking is something they may search
  // for. Neither ever reaches the personal workspace (I-1) -- `app.ai_search_documents` only ever
  // indexes department-owned tables, and its RLS policy is department-scoped on top of that.

  app.get(
    '/search',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: {
        querystring: searchQuerySchema,
        response: { 200: searchResponseSchema },
      },
    },
    async (req) => {
      return service.runSearch(
        toDbContext(req),
        activeDepartmentId(req),
        req.query.q,
        req.query.limit ?? 12,
        req.query.kind,
      )
    },
  )

  app.get(
    '/search/backend',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: { response: { 200: searchBackendSchema } },
    },
    async (req) => service.describeSearchBackend(toDbContext(req), activeDepartmentId(req)),
  )

  app.post(
    '/ask',
    {
      config: {
        permission: { action: 'create', subject: departmentChildSubject },
        // Same reasoning as `/features/:feature/run`: one question is one model call.
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { body: askBodySchema, response: { 200: askResponseSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      try {
        const outcome = await service.ask(toDbContext(req), {
          departmentId: activeDepartmentId(req),
          userId: req.actor!.userId,
          question: req.body.question,
          locale: req.body.locale,
        })
        // Same boundary note as `/features/:feature/run` above: `service.ts` is plain business logic
        // and widens the feature id back to `string`; `askResponseSchema` re-validates at the HTTP
        // layer either way, so this cast is the schema's shape, not a trust shortcut.
        return reply.type('application/json').send(outcome as unknown as AskResponse)
      } catch (err) {
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
        if (err instanceof AiInputValidationError) {
          return sendProblem(reply, 'validation_failed', {
            errors: [{ path: 'question', code: 'invalid' }],
          })
        }
        if (err instanceof AiRunFailedError) return sendProblem(reply, 'internal')
        if (err instanceof AiUnavailableError) return sendProblem(reply, 'maintenance')
        throw err
      }
    },
  )

  /**
   * The head's department briefing, read from cache (v1.1 recapture #23, `briefing.ts`).
   *
   * A GET that never calls a model. `catch_up` at department scope takes 78-276 seconds against the
   * ministry's GLM; this returns whatever the nightly job last produced, in milliseconds, with the
   * time it was generated, so the tile paints on the first frame instead of opening a request nobody
   * can wait out.
   */
  app.get(
    '/briefing',
    {
      // `department_managed`, not `department_child`: the briefing reads the whole department's week
      // -- who is late and who is overloaded -- which SPEC §2.2 makes a head-only question, refused
      // on the server rather than hidden in the sidebar.
      config: {
        permission: { action: 'read', subject: departmentManagedSubject },
      },
      schema: { response: { 200: briefingResponseSchema } },
    },
    async (req) => {
      const ctx = toDbContext(req)
      const row = await readBriefing(ctx, activeDepartmentId(req))
      return {
        briefing: row
          ? {
              day: row.day,
              locale: row.locale,
              status: row.status,
              data: row.output,
              generatedAt: row.generatedAt,
              error: row.error,
              latencyMs: row.latencyMs,
            }
          : null,
        // The refresh button exists only for a head, and only when nothing is already in flight --
        // I-6: the client hides what it cannot use, the server decides what that is.
        canRefresh:
          isHeadOf(req.actor, activeDepartmentId(req)) &&
          (row === null || row.status === 'ready' || row.status === 'failed'),
      }
    },
  )

  /**
   * "Yangilash". Enqueues a run and returns immediately -- the tile goes quiet ("tayyorlanmoqda")
   * and polls `GET /briefing` until the row turns `ready`. Head-only, and rate-limited twice over:
   * by the route limiter against bursts, and by `REFRESH_COOLDOWN_MS` inside `requestBriefing`
   * against a head who presses it every minute for an hour, which is the one that protects the
   * department's soʻm.
   */
  app.post(
    '/briefing/refresh',
    {
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
        rateLimit: { max: 6, timeWindow: '1 minute' },
      },
      schema: {
        body: refreshBriefingBodySchema,
        response: { 200: refreshBriefingResponseSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await requestBriefing(toDbContext(req), {
        departmentId: activeDepartmentId(req),
        locale: req.body.locale,
        userId: req.actor?.userId ?? null,
      })
      return reply
        .type('application/json')
        .send(
          outcome.accepted
            ? { status: outcome.status, retryAfterMs: null }
            : { status: 'ready' as const, retryAfterMs: outcome.retryAfterMs },
        )
    },
  )

  app.post(
    '/search/reindex',
    {
      // Rebuilding the index is a department-wide maintenance action whose only visible effect is on
      // spend (it embeds); `department_managed` keeps it with the budget, where it belongs.
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
      },
      schema: { response: { 200: reindexResponseSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      return reply
        .type('application/json')
        .send(await service.rebuildSearchIndex(toDbContext(req), activeDepartmentId(req)))
    },
  )

  // The embedding sidecar (EPIC-016). Started on this plugin's own `onReady` and cleared on
  // `onClose` -- never a module-level `setInterval`, so `buildApp()` in a unit test starts no
  // background timer (H11.1 "timers cleared"), and never in `test`, where a fake provider and a
  // truncated database would make it pure noise. It is a no-op on a deployment with no key, and a
  // no-op again on one whose GLM has no embeddings model: `embedPendingTick` asks the probe first.
  const SIDECAR_INTERVAL_MS = 60_000
  let sidecar: NodeJS.Timeout | null = null
  // The briefing runner (v1.1 recapture #23): pg-boss, started here and stopped on close, exactly
  // like `work/jobs.ts`'s -- never in `test`, where there is no Postgres for it to reach.
  let briefingJobs: BriefingJobsHandle | null = null
  app.addHook('onReady', async () => {
    if (app.devonConfig.NODE_ENV === 'test') return
    if (briefingJobs === null) {
      briefingJobs = await startBriefingJobs(app.devonConfig.DATABASE_URL, app.log)
    }
  })
  app.addHook('onClose', async () => {
    if (briefingJobs) await briefingJobs.stop().catch(() => {})
    briefingJobs = null
  })
  app.addHook('onReady', async () => {
    if (app.devonConfig.NODE_ENV === 'test') return
    sidecar = setInterval(() => {
      void service
        .embedPendingTick({
          requestId: `ai-embed-${Date.now()}`,
          userId: null,
          actorRole: 'super_admin',
          departmentId: null,
          departmentRole: null,
          actingForUserId: null,
          viewAs: false,
          ip: '127.0.0.1',
          userAgent: 'devon-ai/embed-sidecar',
        })
        .catch((err: unknown) => {
          app.log.warn({ err }, 'ai embedding sidecar tick failed')
        })
    }, SIDECAR_INTERVAL_MS)
    sidecar.unref?.()
  })
  app.addHook('onClose', async () => {
    if (sidecar) clearInterval(sidecar)
    sidecar = null
  })
}

export default aiRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/ai`.
export const prefix = '/ai'

// Re-exported so `test/unit/ai/*.test.ts` can build request-shaped subjects the same way this file
// does, without duplicating the "plan_sprint is personal, everything else is department_child" rule.
export { featureRunSubject }
