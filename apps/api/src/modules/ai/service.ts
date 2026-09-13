// Orchestration for the AI module: opens its own `withContext()` transaction per operation (same
// split as the events module's `service.ts`/`repo.ts`), and is the one place `@devon/ai`'s gateway is
// ever called from -- `index.ts`'s route handlers only ever call functions here, never `repo.ts` or
// `@devon/ai` directly.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import {
  canAffordCall,
  checkBudget,
  createProvider,
  getFeatureSpec,
  hasApiKey,
  loadAiConfig,
  runFeature as runAiFeature,
} from '@devon/ai'
import type { AiProvider } from '@devon/ai'
import * as search from './search-service.js'
import * as repo from './repo.js'
import { settingsToDto, traceToDto } from './dto.js'
import type {
  AiSettingsDto,
  SearchBackendDto,
  SearchHitDto,
  SearchSubjectKind,
  TraceDto,
} from './schemas.js'
import { ai as aiBreaker } from '../../lib/resilience/registry.js'
import { CircuitOpenError } from '../../lib/resilience/circuit-breaker.js'
import { aiCostUzsTotal, aiRequestDuration, aiTokensTotal } from '../../lib/metrics.js'
import {
  AiBudgetExceededError,
  AiFeatureDisabledError,
  AiInputValidationError,
  AiRunFailedError,
  AiUnavailableError,
} from './errors.js'

// Built once per process, exactly like `apps/api/src/deps.ts`'s real implementation is constructed
// once in `server.ts` -- `GlmProvider`/`MockProvider` are both stateless (a `MockProvider` built with
// `respond` never mutates), so there is no reason to rebuild either one per request.
const aiConfig = loadAiConfig()
let cachedProvider: AiProvider | null = null
function getProvider(): AiProvider {
  cachedProvider ??= createProvider(aiConfig)
  return cachedProvider
}

/** Test-only seam: `test/unit/ai/*.test.ts` injects a scripted `MockProvider` instead of whatever
 * `AI_API_KEY` happens to be set in the environment the test runner has. Never called from
 * production code (`server.ts` never imports this). */
export function __setProviderForTests(provider: AiProvider | null): void {
  cachedProvider = provider
}

/**
 * Pure classifier, exported for unit testing without a real provider or database (H8.1): decides
 * whether a `runFeature()` outcome should drive the `ai` circuit breaker towards `succeed()`,
 * `fail()`, or leave it untouched. Extracted out of `runFeatureForActor` specifically so this decision
 * -- "which outcomes count as a GLM *outage* signal vs. a model-quality or caller-input problem" --
 * has its own name and its own tests, rather than being buried in a long function only exercisable via
 * a full HTTP request against a real Postgres.
 */
export function classifyAiOutcomeForBreaker(result: {
  meta: { status: string } | null
}): 'succeed' | 'fail' | 'neutral' {
  if (result.meta === null) return 'neutral' // caller input never reached the provider
  return result.meta.status === 'provider_error' ? 'fail' : 'succeed'
}

/**
 * H15.1 "AI latency/cost": records one call's numbers into the three AI metrics, exported (like
 * `classifyAiOutcomeForBreaker` above) so the recording itself -- which labels, which fields --
 * has a unit test that never needs a real provider or database. Called for every call that actually
 * reached the provider (non-null `meta`), whether the provider's own answer was `ok` or a
 * `provider_error` -- a failed call still spent real wall-clock time and sometimes real tokens, both
 * of which belong in these numbers the same way a failed HTTP request still counts toward
 * `devon_http_request_duration_seconds` (`plugins/observability.ts`).
 */
export function recordAiRunMetrics(
  feature: string,
  meta: {
    status: string
    latencyMs: number
    costUzs: number
    promptTokens: number
    completionTokens: number
  },
): void {
  aiRequestDuration.observe(meta.latencyMs / 1000, {
    feature,
    status: meta.status,
  })
  aiCostUzsTotal.inc({ feature }, meta.costUzs)
  aiTokensTotal.inc({ feature, kind: 'prompt' }, meta.promptTokens)
  aiTokensTotal.inc({ feature, kind: 'completion' }, meta.completionTokens)
}

/** H8.1: whether a call right now would actually reach the provider, or fail fast against the open
 * `ai` circuit breaker. Read-only (never trips/resets the breaker itself) so `GET /ai/settings` can
 * poll it as often as the web layer likes. */
export function isAiAvailable(): boolean {
  return aiBreaker.isCallAllowed()
}

// H27.1 "AI calls cached by prompt hash where deterministic" + "no repeated processing of unchanged
// data": an identical (department, feature, input) call within `CACHE_TTL_MS` is served from this
// cache instead of a real GLM round trip -- no tokens billed, no new trace row. In-process, not
// Valkey: this build runs one API process per TECH-SPEC's single-server decision (the same tradeoff
// `modules/admin/availability-gate.ts`'s in-process cache already documents), so there is no second
// process a Valkey layer would need to stay consistent with. Bounded (`CACHE_MAX_ENTRIES`) so it can
// never grow unbounded (H11.1 "bounded ... caches") -- a duplicate call is almost always a double
// submit or a retry arriving within seconds, not a legitimate reason to keep every distinct input a
// department has ever sent.
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX_ENTRIES = 200
type CacheEntry = { outcome: RunFeatureOutcome; expiresAt: number }
const resultCache = new Map<string, CacheEntry>()

function cacheKeyFor(
  departmentId: string,
  feature: string,
  input: Record<string, unknown>,
): string {
  const hash = createHash('sha256')
    .update(`${departmentId}:${feature}:${JSON.stringify(input)}`)
    .digest('hex')
  return hash
}

function getCached(key: string): RunFeatureOutcome | null {
  const entry = resultCache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    resultCache.delete(key)
    return null
  }
  // Refresh recency (Map preserves insertion order; delete+set moves this key to the end) so the
  // bound below evicts the truly-least-recently-used entry, not an arbitrary one.
  resultCache.delete(key)
  resultCache.set(key, entry)
  return entry.outcome
}

function setCached(key: string, outcome: RunFeatureOutcome): void {
  resultCache.set(key, { outcome, expiresAt: Date.now() + CACHE_TTL_MS })
  while (resultCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = resultCache.keys().next().value
    if (oldestKey === undefined) break
    resultCache.delete(oldestKey)
  }
}

/** Test-only seam, same precedent as `__setProviderForTests` above. */
export function __clearCacheForTests(): void {
  resultCache.clear()
}

export async function getSettingsWithUsage(
  ctx: RequestContext,
  departmentId: string,
  /** v1.1 SPEC §2.2 (D2a): the money half of this DTO is head-only. */
  isHead = true,
): Promise<AiSettingsDto> {
  // The retrieval backend is a runtime probe against a third party; it is deliberately resolved
  // outside the transaction rather than holding a Postgres connection open across an HTTP round trip
  // (the same rule `runFeatureForActor` follows for the provider call itself). `describeBackend`
  // opens its own short read for the index counts.
  const searchBackend = await search.describeBackend(ctx, departmentId)
  return withContext(ctx, async (tx) => {
    const [settings, spent, spendByFeature] = await Promise.all([
      repo.getSettings(tx, departmentId, isHead),
      repo.spentThisMonthUzs(tx, departmentId),
      repo.spentThisMonthByFeature(tx, departmentId),
    ])
    const dto = settingsToDto(settings, spent, isAiAvailable(), {
      spendByFeature,
      simulated: !hasApiKey(aiConfig),
      search: searchBackend,
    })
    if (isHead) return dto
    const {
      budgetUzsPerMonth: _budget,
      spentUzsThisMonth: _spent,
      remainingUzs: _remaining,
      budgetStatus: _status,
      usedPct: _used,
      spendByFeature: _byFeature,
      ...memberVisible
    } = dto
    return memberVisible
  })
}

export type PatchSettingsInput = {
  budgetUzsPerMonth?: number | undefined
  softCapPct?: number | undefined
  flags?: Record<string, boolean> | undefined
}

export async function patchSettings(
  ctx: RequestContext,
  departmentId: string,
  patch: PatchSettingsInput,
): Promise<AiSettingsDto> {
  const searchBackend = await search.describeBackend(ctx, departmentId)
  return withContext(ctx, async (tx) => {
    const before = await repo.getSettings(tx, departmentId)
    const after = await repo.patchSettings(tx, departmentId, patch)
    tx.audit({
      action: 'ai.settings.updated',
      subjectType: 'ai_department_settings',
      subjectId: departmentId,
      before,
      after,
    })
    const spent = await repo.spentThisMonthUzs(tx, departmentId)
    const spendByFeature = await repo.spentThisMonthByFeature(tx, departmentId)
    return settingsToDto(after, spent, isAiAvailable(), {
      spendByFeature,
      simulated: !hasApiKey(aiConfig),
      search: searchBackend,
    })
  })
}

export async function listUsage(
  ctx: RequestContext,
  departmentId: string,
  limit: number,
  /** v1.1 SPEC §2.2 (D2b): `onlyUserId` non-null restricts the list to that person's own runs. The
   * route passes the caller's id for a member and `null` for the head. */
  options: { onlyUserId?: string | null } = {},
): Promise<TraceDto[]> {
  return withContext(ctx, async (tx) => {
    const rows = await repo.listTraces(tx, departmentId, limit, options.onlyUserId ?? null)
    return rows.map(traceToDto)
  })
}

export type RunFeatureParams = {
  departmentId: string
  userId: string
  feature: string
  input: Record<string, unknown>
}

export type RunFeatureOutcome = {
  data: Record<string, unknown>
  meta: {
    feature: string
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUzs: number
    latencyMs: number
    retried: boolean
    cached?: boolean
    /** v1.1 SPEC §8 "Honesty": the answer came from `@devon/ai`'s offline simulator. */
    simulated: boolean
  }
}

/**
 * G-5: writes the "somebody tried and was refused" trace. Zero tokens, zero cost -- nothing was
 * spent, and pretending otherwise would corrupt the budget figure the row exists to explain. Its own
 * transaction, committed before the caller throws, for exactly the reason the success path documents
 * below: a `withContext` that throws rolls back everything written inside it.
 *
 * Never allowed to fail the request it describes. A refusal the user can see is the product working;
 * a 500 because the *record* of the refusal could not be written is not.
 */
async function recordBlockedTrace(
  ctx: RequestContext,
  params: RunFeatureParams,
  status: 'blocked_flag' | 'blocked_budget',
): Promise<void> {
  try {
    await withContext(ctx, async (tx) => {
      await repo.insertTrace(tx, {
        departmentId: params.departmentId,
        userId: params.userId,
        feature: params.feature,
        model: aiConfig.model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUzs: 0,
        latencyMs: 0,
        retried: false,
        status,
      })
      tx.audit({
        action: 'ai.feature.blocked',
        subjectType: 'ai_trace',
        subjectId: params.feature,
        after: { feature: params.feature, status },
      })
    })
  } catch {
    // Deliberately swallowed -- see the doc comment.
  }
}

/**
 * Enforces the feature flag and the budget hard stop, calls `@devon/ai`'s `runFeature()`, and writes
 * exactly one trace row (metadata only -- see `repo.ts`'s header) whether the call succeeded or not,
 * inside the same transaction as everything else (I-5: audit/trace writes never happen on a separate
 * connection from the write that caused them, even though "the write" here is an external API call
 * rather than a row change). Throws a typed error from `errors.ts` for every non-success outcome;
 * `index.ts` maps each to its `Problem`.
 */
export async function runFeatureForActor(
  ctx: RequestContext,
  params: RunFeatureParams,
): Promise<RunFeatureOutcome> {
  const provider = getProvider()

  // Step 1: flag + budget gate, read-only -- a thrown error here rolls back nothing because nothing
  // was written yet.
  const { settings, spent } = await withContext(ctx, async (tx) => ({
    settings: await repo.getSettings(tx, params.departmentId),
    spent: await repo.spentThisMonthUzs(tx, params.departmentId),
  }))

  if (settings.flags[params.feature] !== true) {
    // G-5: `blocked_flag` is a valid `app.ai_trace_status`, the API DTO carries it and all four
    // locale files translate it -- and before v1.1 it could never be written, because this threw
    // before `insertTrace` ever ran. A head asking "is anyone actually trying to use this?" before
    // turning a helper on had no way to find out. Now the attempt is recorded (zero tokens, zero
    // cost -- nothing was spent) and the throw happens after.
    await recordBlockedTrace(ctx, params, 'blocked_flag')
    throw new AiFeatureDisabledError()
  }

  // H27.1: an identical call for this department+feature+input within the last `CACHE_TTL_MS` is
  // served from cache -- still gated by the feature flag above (a feature disabled after the cached
  // response was recorded must not keep serving it), but *not* by the budget check below: a cache hit
  // spends no new tokens, so it must never be blocked by (or count against) the budget that exists to
  // limit real spend.
  const cacheKey = cacheKeyFor(params.departmentId, params.feature, params.input)
  const cached = getCached(cacheKey)
  if (cached) {
    return { ...cached, meta: { ...cached.meta, cached: true } }
  }

  const budget = checkBudget(spent, settings.budget_uzs_per_month, settings.soft_cap_pct)
  if (budget.status === 'hard_stop') {
    await recordBlockedTrace(ctx, params, 'blocked_budget')
    throw new AiBudgetExceededError()
  }
  // G-4: `canAffordCall` was exported from `@devon/ai` and never called, so the hard stop was
  // "have you already exceeded the cap", never "would this call exceed it" -- meaning the call that
  // crosses a department's monthly budget always went through, at up to 8192 tokens. The worst-case
  // cost of the call we are about to make is now checked *before* making it, using the same
  // `defaultMaxTokens` the gateway will actually request (doubled, because the truncation retry may
  // double it once).
  const worstCaseTokens = Math.min(
    aiConfig.maxMaxTokens,
    getFeatureSpec(params.feature as Parameters<typeof getFeatureSpec>[0]).defaultMaxTokens * 2,
  )
  if (
    !canAffordCall(
      spent,
      settings.budget_uzs_per_month,
      worstCaseTokens,
      aiConfig.pricePerMillionTokensUzs,
    )
  ) {
    await recordBlockedTrace(ctx, params, 'blocked_budget')
    throw new AiBudgetExceededError()
  }
  // H8.1: the breaker is open (repeated recent GLM failures) -- fail fast, before spending a
  // guaranteed-to-time-out network round trip on a call that has already shown it will not succeed.
  // `getSettingsWithUsage` already reports this on every read via `available`/effective `flags`, so a
  // client polling settings sees the feature disappear at the same moment this would start rejecting
  // its calls. `guard()` (not the read-only `isAiAvailable()`) because this is the one call site that
  // is actually allowed to spend the single half-open probe once the reset window has passed.
  try {
    aiBreaker.guard()
  } catch (err) {
    if (err instanceof CircuitOpenError) throw new AiUnavailableError('circuit_open')
    throw err
  }

  // Step 2: the actual provider call, deliberately OUTSIDE any transaction -- an OpenAI-compatible
  // HTTP round trip has no business holding a Postgres connection/transaction open for its duration.
  // `@devon/ai`'s `run()` (`gateway.ts`) catches a transport failure itself and returns
  // `{ok:false, meta:{status:'provider_error', ...}}` rather than throwing, so the breaker cannot be
  // driven by `execute()`'s catch here -- `succeed()`/`fail()` are called explicitly below, based on
  // the returned outcome, once it is known (H8.1: circuit breaker for AI).
  const result = await runAiFeature({
    provider,
    config: aiConfig,
    // `@devon/ai`'s `runFeature` narrows this to its own `AiFeature` union internally via
    // `inputSchema`/registry lookup; the route param was already validated against the identical
    // literal tuple in `schemas.ts` before this function was ever called.
    feature: params.feature as Parameters<typeof runAiFeature>[0]['feature'],
    input: params.input,
  })

  const verdict = classifyAiOutcomeForBreaker(result)
  if (verdict === 'fail') aiBreaker.fail(new Error(result.ok ? 'provider_error' : result.error))
  else if (verdict === 'succeed') aiBreaker.succeed()

  if (result.meta === null) {
    // Input failed the feature's own schema before any provider call was made -- no trace, no budget
    // spent, and no signal either way about whether GLM itself is reachable.
    throw new AiInputValidationError(result.error)
  }

  recordAiRunMetrics(params.feature, result.meta)

  // Step 3: record what happened -- in its OWN transaction, committed unconditionally, so a call that
  // spent real tokens but still failed schema validation (or came back empty even after the retry)
  // is never lost to a rollback just because this function goes on to throw right afterwards (a
  // `withContext` that throws rolls back everything written inside it -- see that function's own
  // comment -- so recording the trace and then throwing from the *same* transaction would silently
  // discard the very usage record the budget/settings screen exists to show).
  await withContext(ctx, async (tx) => {
    await repo.insertTrace(tx, {
      departmentId: params.departmentId,
      userId: params.userId,
      feature: params.feature,
      model: result.meta.model,
      promptTokens: result.meta.promptTokens,
      completionTokens: result.meta.completionTokens,
      totalTokens: result.meta.totalTokens,
      costUzs: result.meta.costUzs,
      latencyMs: result.meta.latencyMs,
      retried: result.meta.retried,
      status: result.meta.status,
    })
    tx.audit({
      action: 'ai.feature.run',
      subjectType: 'ai_trace',
      subjectId: params.feature,
      after: {
        feature: params.feature,
        status: result.meta.status,
        totalTokens: result.meta.totalTokens,
        costUzs: result.meta.costUzs,
      },
    })
  })

  if (!result.ok) {
    // SEV2 #23: the gateway distinguishes "we stopped waiting" from "the provider refused"; so does
    // the trace row above, and so must the Problem this route answers with.
    throw new AiRunFailedError(
      result.error,
      result.meta.status === 'timeout' ? 'timeout' : 'failed',
    )
  }

  const outcome: RunFeatureOutcome = {
    data: result.data as Record<string, unknown>,
    meta: {
      feature: params.feature,
      model: result.meta.model,
      promptTokens: result.meta.promptTokens,
      completionTokens: result.meta.completionTokens,
      totalTokens: result.meta.totalTokens,
      costUzs: result.meta.costUzs,
      latencyMs: result.meta.latencyMs,
      retried: result.meta.retried,
      simulated: result.meta.simulated,
    },
  }
  // Only a real, successful (non-empty-cost) call is worth caching -- `result.ok` above already
  // guarded this path, so every reachable return here is one a repeat of the same input should reuse.
  setCached(cacheKey, outcome)
  return outcome
}

// --- EPIC-016: semantic search + the Ask box --------------------------------------------------

export type AskParams = {
  departmentId: string
  userId: string
  question: string
  locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'
}

export type AskOutcome = {
  data: Record<string, unknown>
  meta: RunFeatureOutcome['meta']
  sources: SearchHitDto[]
  backend: 'embeddings' | 'fts'
}

/** How many retrieved passages the model is allowed to see. Twelve is the prompt's own cap; eight
 * keeps the call cheap and, in practice, everything past the eighth hit is noise the model has to
 * work to ignore. */
const ASK_PASSAGES = 8

/**
 * The Ask box. Retrieval first, then exactly one model call over what was retrieved -- never a model
 * call that could answer from its own knowledge (see `semantic-ask.ts`'s header for why that
 * distinction is the whole design in a ministry).
 *
 * The citations the model returns are intersected with the refs we actually handed it, here, on the
 * server. `@devon/ai`'s own `validateOutput` already does this, and doing it twice is deliberate:
 * the client renders these as links into real department records, and "the link goes somewhere that
 * does not exist" is the one failure a reader cannot detect for themselves.
 */
export async function ask(ctx: RequestContext, params: AskParams): Promise<AskOutcome> {
  const { hits, backend } = await search.search(
    ctx,
    params.departmentId,
    params.question,
    ASK_PASSAGES,
  )

  const passages = hits.map((hit) => ({
    ref: `${hit.subjectType}:${hit.subjectId}`,
    kind: hit.subjectType,
    id: hit.subjectId,
    title: hit.title || '—',
    excerpt: (hit.snippet || hit.title || '—').slice(0, 1500),
    score: hit.score,
  }))

  const outcome = await runFeatureForActor(ctx, {
    departmentId: params.departmentId,
    userId: params.userId,
    feature: 'semantic_ask',
    input: { locale: params.locale, backend, question: params.question, passages },
  })

  const allowed = new Set(passages.map((passage) => passage.ref))
  const citations = Array.isArray(outcome.data['citations'])
    ? (outcome.data['citations'] as unknown[]).filter(
        (ref): ref is string => typeof ref === 'string' && allowed.has(ref),
      )
    : []

  return {
    data: { ...outcome.data, citations },
    meta: outcome.meta,
    sources: hits.filter((hit) => citations.includes(`${hit.subjectType}:${hit.subjectId}`)).length
      ? hits.filter((hit) => citations.includes(`${hit.subjectType}:${hit.subjectId}`))
      : hits,
    backend,
  }
}

export async function runSearch(
  ctx: RequestContext,
  departmentId: string,
  query: string,
  limit: number,
  kind?: SearchSubjectKind,
): Promise<{ hits: SearchHitDto[]; backend: 'embeddings' | 'fts' }> {
  return search.search(ctx, departmentId, query, limit, kind)
}

export async function describeSearchBackend(
  ctx: RequestContext,
  departmentId: string,
): Promise<SearchBackendDto> {
  return search.describeBackend(ctx, departmentId)
}

export async function rebuildSearchIndex(
  ctx: RequestContext,
  departmentId: string,
): Promise<{ indexed: number; embedded: number; backend: 'embeddings' | 'fts' }> {
  return search.rebuildIndex(ctx, departmentId)
}

/**
 * The embedding sidecar's one tick, for `index.ts`'s `onReady` timer. Walks every department that has
 * rows waiting -- one query to find them, then a bounded batch each (I-9: the loop is over
 * departments, which is a handful, and each iteration is a batch call, not a per-row query).
 */
export async function embedPendingTick(ctx: RequestContext): Promise<number> {
  if (!hasApiKey(aiConfig)) return 0
  const departments = await withContext(ctx, (tx) =>
    tx.raw<{ department_id: string }>(sql`
      select department_id
      from app.ai_search_documents
      where embedded_at is null
      group by department_id
      order by count(*) desc
      limit 10
    `),
  )
  let embedded = 0
  for (const row of departments) {
    embedded += await search.embedPending(
      { ...ctx, departmentId: row.department_id },
      row.department_id,
      2,
    )
  }
  return embedded
}

// --- the Friday department briefing (AI-AUDIT §5 fix 17) ------------------------------------

/**
 * Narrates a department's week for the Telegram group digest, using the same `catch_up` prompt the
 * head dashboard uses at `scope: 'department'`.
 *
 * v1.0's weekly department digest (`modules/notifications/jobs.ts`) was a hand-built count string
 * that never called `@devon/ai` at all, while TECH-SPEC §8 promised "weekly summary per person and
 * per department (drafts the digest)". This is that wiring, and it is deliberately the only place
 * the notifications module has to know about AI: it hands over a department id and a fallback, and
 * gets back a string.
 *
 * **Never throws, and never blocks a digest.** A department with the helper off, no budget left, no
 * head, no API key, or a GLM outage gets `fallbackText` -- the count line it has always had. A
 * Friday digest that fails to send because an AI call failed would be strictly worse than one that
 * reads a little plainer.
 */
export async function narrateDepartmentWeek(
  ctx: RequestContext,
  params: {
    departmentId: string
    locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'
    fallbackText: string
  },
): Promise<string> {
  try {
    const { snapshot, head, departmentName } = await withContext(ctx, async (tx) => ({
      snapshot: await repo.departmentWeekSnapshot(tx, params.departmentId),
      head: await repo.headUserId(tx, params.departmentId),
      departmentName: await repo.departmentName(tx, params.departmentId),
    }))
    if (!head) return params.fallbackText
    // `catch_up`'s `subjectName` is `min(1)`: a department with no name would fail the feature's own
    // input schema and cost a pointless validation round trip, so the id stands in for it.
    const subjectName = departmentName || params.departmentId

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
    const outcome = await runFeatureForActor(ctx, {
      departmentId: params.departmentId,
      userId: head,
      feature: 'catch_up',
      input: {
        locale: params.locale,
        scope: 'department',
        window: 'week',
        subjectName,
        viewerName: subjectName,
        period: {
          start: weekAgo.toISOString().slice(0, 10),
          end: now.toISOString().slice(0, 10),
        },
        counts: {
          done: snapshot.done.length,
          doneLastPeriod: snapshot.doneLastPeriodCount,
          created: snapshot.createdCount,
          overdue: snapshot.overdue.length,
        },
        done: snapshot.done,
        overdue: snapshot.overdue,
        dueThisWeek: [],
        assignedToMe: [],
        mentions: [],
        comments: [],
        loadPerPerson: snapshot.loadPerPerson,
        eventsAhead: [],
      },
    })

    const data = outcome.data as {
      headline?: unknown
      wins?: { text?: unknown }
      risks?: { text?: unknown }[]
      overloaded?: { name?: unknown; text?: unknown }[]
      lookingAhead?: { text?: unknown }
    }
    const lines: string[] = []
    if (typeof data.headline === 'string' && data.headline) lines.push(data.headline)
    if (typeof data.wins?.text === 'string' && data.wins.text) lines.push(data.wins.text)
    for (const risk of data.risks ?? []) {
      if (typeof risk?.text === 'string' && risk.text) lines.push(`- ${risk.text}`)
    }
    for (const person of data.overloaded ?? []) {
      if (typeof person?.name === 'string' && typeof person?.text === 'string') {
        lines.push(`- ${person.name}: ${person.text}`)
      }
    }
    if (typeof data.lookingAhead?.text === 'string' && data.lookingAhead.text) {
      lines.push(data.lookingAhead.text)
    }
    // An answer with nothing in it is not an answer: fall back rather than send an empty message.
    return lines.length > 0 ? lines.join('\n') : params.fallbackText
  } catch {
    return params.fallbackText
  }
}
