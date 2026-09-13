// EPIC-017 -- the automation engine.
//
// It listens on the outbox (`@devon/db`'s `subscribe`), exactly like the notification pipeline does,
// rather than being called inline from the work module's writes. Two reasons, and they are the same
// two the outbox exists for: the card write that triggers a rule has already committed by the time
// the engine sees it (so a failing rule can never roll back somebody's edit), and the work module
// does not have to know that automations exist at all.
//
// Three guards, because an automation that surprises a boshqarma boshligʻi is worse than no
// automation at all:
//
//  1. **Loop guard** (SPEC §7: "a rule cannot trigger itself twice in one chain"). Applying a rule
//     writes to the card, which emits `work.card.updated`, which re-enters this file. A per-card
//     chain -- which rules have already acted on it, and how deep the chain is -- is kept in memory
//     for `CHAIN_TTL_MS` and consulted before every evaluation.
//  2. **Repeat guard** for the two time-based triggers: an overdue card stays overdue, so without
//     `hasRecentApplied` a rule would re-label it every hour for as long as the lateness lasted.
//  3. **Everything is logged.** Applied, skipped (with a machine-readable reason) and failed all
//     write a row to `app.automation_runs`. A rule that does nothing has to be able to say why.
import type { FastifyBaseLogger } from 'fastify'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { subscribe, withContext, type OutboxEventRecord, type RequestContext } from '@devon/db'
import {
  AUTOMATION_MAX_CHAIN_DEPTH,
  matchesFilterQuery,
  parseFilterQuery,
  type AutomationAction,
  type AutomationTrigger,
  type FilterableCard,
} from '@devon/contracts'
import { notifyUser } from '../notifications/notify.js'
import type { LocalizedText } from '../notifications/schemas.js'
import * as workRepo from '../work/repo.js'
import { scanContext, systemContext } from './context.js'
import * as repo from './repo.js'

/** How long a card's automation chain is remembered. Long enough that the outbox worker's own
 * 2-second poll cannot outrun it, short enough that a genuine human edit ten minutes later starts
 * a fresh chain. */
const CHAIN_TTL_MS = 5 * 60 * 1000

/** A time-based rule may act on the same card at most once per this many hours. */
const TIME_TRIGGER_COOLDOWN_HOURS = 20

type ChainEntry = { ruleIds: Set<string>; depth: number; at: number }
const chains = new Map<string, ChainEntry>()

function chainFor(cardId: string): ChainEntry {
  const existing = chains.get(cardId)
  if (existing && Date.now() - existing.at < CHAIN_TTL_MS) return existing
  const fresh: ChainEntry = { ruleIds: new Set(), depth: 0, at: Date.now() }
  chains.set(cardId, fresh)
  // Bounded: the map is swept whenever it grows past a size no real department reaches in one
  // five-minute window, so a long-running process cannot accumulate card ids forever.
  if (chains.size > 2000) {
    const cutoff = Date.now() - CHAIN_TTL_MS
    for (const [key, value] of chains) if (value.at < cutoff) chains.delete(key)
  }
  return fresh
}

/** Test-only: the chain memory is process-local, so a test that fires the same card twice needs a
 * way to start clean. Production code never calls this. */
export function resetAutomationChains(): void {
  chains.clear()
}

type CardFacts = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  assigneeUserId: string | null
  giverUserId: string | null
  dueAt: string | null
  labels: string[]
  createdByUserId: string
  version: number
}

async function loadCard(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
): Promise<CardFacts | null> {
  const card = await workRepo.getCard(ctx, departmentId, cardId)
  if (!card) return null
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    assigneeUserId: card.assigneeUserId,
    giverUserId: card.giverUserId,
    dueAt: card.dueAt,
    labels: card.labels,
    createdByUserId: card.createdByUserId,
    version: card.version,
  }
}

/** The filter grammar over one card. The project/label/unit names a full match would need are
 * loaded once per evaluation batch, not per rule -- a department with eight rules still costs one
 * label query. */
async function filterableFor(
  ctx: RequestContext,
  departmentId: string,
  card: CardFacts,
): Promise<FilterableCard> {
  const labels = await workRepo.getLabels(ctx, departmentId)
  const byId = new Map(labels.map((l) => [l.id, l.name]))
  return {
    id: card.id,
    title: card.title,
    description: null,
    status: card.status,
    assigneeUserId: card.assigneeUserId,
    giverUserId: card.giverUserId,
    dueAt: card.dueAt,
    projectName: null,
    labelNames: card.labels.map((id) => byId.get(id) ?? '').filter(Boolean),
    unitName: null,
  }
}

function actionLabel(action: AutomationAction): string {
  return action.kind
}

async function headUserIds(ctx: RequestContext, departmentId: string): Promise<string[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ user_id: string }>(
      sql`select user_id from app.memberships
          where department_id = ${departmentId} and role = 'head' and status = 'active'
            and deleted_at is null`,
    )
    return rows.map((r) => r.user_id)
  })
}

function notificationText(
  ruleName: string,
  cardTitle: string,
): {
  title: LocalizedText
  body: LocalizedText
} {
  // Four locales written out in full rather than interpolated from one string, for the reason
  // `notifications/registry.ts` gives: uz-Latn and uz-Cyrl are two scripts of one language and
  // Russian declines differently, so a template with a slot is not a translation. The rule's own
  // name and the card's title are user data and appear verbatim in every locale.
  return {
    title: {
      'uz-Latn': `Avtomatlashtirish: ${ruleName}`,
      'uz-Cyrl': `Автоматлаштириш: ${ruleName}`,
      ru: `Автоматизация: ${ruleName}`,
      en: `Automation: ${ruleName}`,
    },
    body: {
      'uz-Latn': `«${cardTitle}» kartasi boʻyicha qoida ishga tushdi.`,
      'uz-Cyrl': `«${cardTitle}» картаси бўйича қоида ишга тушди.`,
      ru: `Правило сработало по карточке «${cardTitle}».`,
      en: `A rule ran on the card "${cardTitle}".`,
    },
  }
}

type ApplyOutcome = { applied: string[]; error: string | null }

async function applyActions(
  log: FastifyBaseLogger,
  ctx: RequestContext,
  departmentId: string,
  ruleName: string,
  card: CardFacts,
  actions: readonly AutomationAction[],
  actorUserId: string | null,
): Promise<ApplyOutcome> {
  const applied: string[] = []
  // Card-shaped actions are collected into ONE patch rather than applied one at a time: three
  // actions on one card would otherwise be three optimistic-lock bumps, three activity rows and
  // three `work.card.updated` events, which is three chances for the loop guard to earn its keep.
  const patch: Parameters<typeof workRepo.patchCard>[3] = {}
  const notifications: Array<{ userId: string }> = []
  const checklist: string[] = []
  let followUp: { title: string; dueInDays: number | null } | null = null

  for (const action of actions) {
    switch (action.kind) {
      case 'assign':
        if (action.userId) patch.assigneeUserId = action.userId
        break
      case 'set_priority':
        if (action.priority) patch.priority = action.priority
        break
      case 'set_status':
        if (action.status) patch.status = action.status
        break
      case 'add_label':
        if (action.labelId && !card.labels.includes(action.labelId)) {
          patch.labels = [...(patch.labels ?? card.labels), action.labelId]
        }
        break
      case 'notify_user':
        if (action.userId) notifications.push({ userId: action.userId })
        break
      case 'notify_head':
        break
      case 'add_checklist':
        checklist.push(...(action.checklist ?? []))
        break
      case 'create_followup':
        if (action.title) {
          followUp = { title: action.title, dueInDays: action.dueInDays ?? null }
        }
        break
    }
    applied.push(actionLabel(action))
  }

  try {
    if (Object.keys(patch).length > 0) {
      const result = await workRepo.patchCard(
        ctx,
        departmentId,
        card.id,
        patch,
        undefined,
        actorUserId ?? card.createdByUserId,
      )
      if (!result.ok) return { applied, error: `patch_${result.reason}` }
    }

    if (checklist.length > 0) {
      await withContext(ctx, async (tx) => {
        const values = checklist.map(
          (text, index) =>
            sql`(${randomUUID()}, ${departmentId}, ${card.id}, ${text}, ${`z${index.toString().padStart(4, '0')}`})`,
        )
        await tx.raw(
          sql`insert into app.card_checklist_items (id, department_id, card_id, text, order_key)
              values ${sql.join(values, sql`, `)}`,
        )
      })
    }

    if (followUp) {
      await workRepo.createCard(ctx, {
        departmentId,
        title: followUp.title,
        description: undefined,
        kind: 'task',
        assigneeUserId: card.assigneeUserId,
        giverUserId: card.giverUserId,
        priority: card.priority,
        startAt: null,
        dueAt:
          followUp.dueInDays === null
            ? null
            : new Date(Date.now() + followUp.dueInDays * 86_400_000).toISOString(),
        labels: [],
        links: [],
        projectId: null,
        projectScope: 'none',
        orderKey: undefined,
        createdByUserId: actorUserId ?? card.createdByUserId,
        source: 'template',
      })
    }

    const wantsHead = actions.some((a) => a.kind === 'notify_head')
    const recipients = new Set(notifications.map((n) => n.userId))
    if (wantsHead) for (const id of await headUserIds(ctx, departmentId)) recipients.add(id)
    if (recipients.size > 0) {
      const text = notificationText(ruleName, card.title)
      // `notifyUser` is the one place "create a notification and deliver it on the channels its
      // owner wants right now" happens (notifications/notify.ts) -- the automations module never
      // writes an inbox row or a Telegram message itself.
      await Promise.all(
        [...recipients].map((userId) =>
          notifyUser(log, {
            userId,
            type: 'automations.rule.ran',
            reason: 'system',
            subjectType: 'card',
            subjectId: card.id,
            departmentId,
            title: text.title,
            body: text.body,
            deepLink: `/work/card?id=${card.id}`,
          }),
        ),
      )
    }

    return { applied, error: null }
  } catch (err) {
    return { applied, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Evaluate every enabled rule for one trigger against one card. Exported so the hourly tick and
 * the event subscriber share exactly one code path. */
export async function evaluateTrigger(
  log: FastifyBaseLogger,
  departmentId: string,
  cardId: string,
  trigger: AutomationTrigger,
  actorUserId: string | null,
  options: { timeBased?: boolean } = {},
): Promise<void> {
  const ctx = systemContext(departmentId, actorUserId)
  const rules = await repo.listEnabledRulesForTrigger(ctx, departmentId, trigger)
  if (rules.length === 0) return

  const card = await loadCard(ctx, departmentId, cardId)
  if (!card) return
  const filterable = await filterableFor(ctx, departmentId, card)
  const chain = chainFor(cardId)

  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i]!
    // eslint-disable-next-line no-await-in-loop -- rules on one card are sequential by design: the
    // second rule must see what the first one wrote, and the chain guard below depends on that
    // order. Never more than 50 rules (`listEnabledRulesForTrigger`'s own limit).
    const outcome = await evaluateOneRule(log, ctx, departmentId, rule, card, filterable, chain, {
      trigger,
      actorUserId,
      timeBased: options.timeBased === true,
    })
    if (outcome === 'applied') {
      chain.ruleIds.add(rule.id)
      chain.depth += 1
      chain.at = Date.now()
    }
  }
}

async function evaluateOneRule(
  log: FastifyBaseLogger,
  ctx: RequestContext,
  departmentId: string,
  rule: repo.AutomationRule,
  card: CardFacts,
  filterable: FilterableCard,
  chain: ChainEntry,
  context: { trigger: AutomationTrigger; actorUserId: string | null; timeBased: boolean },
): Promise<'applied' | 'skipped' | 'failed'> {
  const skip = async (reason: string) => {
    await repo.recordRun(ctx, departmentId, {
      ruleId: rule.id,
      cardId: card.id,
      status: 'skipped',
      detail: { reason },
    })
    return 'skipped' as const
  }

  if (chain.depth >= AUTOMATION_MAX_CHAIN_DEPTH) return skip('chain_depth')
  if (chain.ruleIds.has(rule.id)) return skip('loop_guard')
  if (rule.actions.length === 0) return skip('no_valid_actions')

  const config = rule.triggerConfig
  if (
    context.trigger === 'card_status_changed' &&
    config.toStatus != null &&
    card.status !== config.toStatus
  ) {
    return skip('status_did_not_match')
  }
  if (config.filter && config.filter.trim().length > 0) {
    const query = parseFilterQuery(config.filter)
    const matched = matchesFilterQuery(filterable, query, {
      meUserId: null,
      resolveUserIds: () => [],
    })
    if (!matched) return skip('filter_did_not_match')
  }
  if (context.timeBased) {
    const recent = await repo.hasRecentApplied(
      ctx,
      departmentId,
      rule.id,
      card.id,
      TIME_TRIGGER_COOLDOWN_HOURS,
    )
    if (recent) return skip('already_applied_today')
  }

  const outcome = await applyActions(
    log,
    ctx,
    departmentId,
    rule.name,
    card,
    rule.actions,
    context.actorUserId,
  )
  if (outcome.error) {
    await repo.recordRun(ctx, departmentId, {
      ruleId: rule.id,
      cardId: card.id,
      status: 'failed',
      detail: { actions: outcome.applied, error: outcome.error },
    })
    log.warn({ ruleId: rule.id, cardId: card.id, error: outcome.error }, 'automations: rule failed')
    return 'failed'
  }
  await repo.recordRun(ctx, departmentId, {
    ruleId: rule.id,
    cardId: card.id,
    status: 'applied',
    detail: { actions: outcome.applied },
  })
  return 'applied'
}

function payloadOf(event: OutboxEventRecord): Record<string, unknown> {
  return typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : {}
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

/**
 * Subscribes the engine to the three card events the work module already emits. Called once, from
 * the module's plugin body -- the same place `notifications/events.ts` registers its own
 * subscription, and never from a route handler.
 */
export function registerAutomationSubscriptions(log: FastifyBaseLogger): () => void {
  const handle = async (event: OutboxEventRecord, trigger: AutomationTrigger): Promise<void> => {
    const departmentId = event.departmentId
    if (!departmentId) return
    const payload = payloadOf(event)
    const cardId = stringField(payload, 'cardId')
    if (!cardId) return
    await evaluateTrigger(log, departmentId, cardId, trigger, stringField(payload, 'actorUserId'))
  }

  const unsubscribers = [
    subscribe('work.card.created', (event) => handle(event, 'card_created')),
    subscribe('work.card.assigned', (event) => handle(event, 'card_assigned')),
    subscribe('work.card.updated', async (event) => {
      const payload = payloadOf(event)
      const changes = Array.isArray(payload['changes'])
        ? (payload['changes'] as unknown[]).filter((c): c is string => typeof c === 'string')
        : []
      // One emitted event, two possible triggers: a status move and a field edit are different
      // things to react to, and a PATCH that did both legitimately fires both.
      if (changes.includes('status')) await handle(event, 'card_status_changed')
      if (
        changes.some((c) => c === 'priority' || c === 'labels' || c === 'dueAt' || c === 'estimate')
      ) {
        await handle(event, 'card_field_changed')
      }
    }),
  ]
  return () => {
    for (const off of unsubscribers) off()
  }
}

/**
 * The hourly tick for the two time-based triggers. One query for the departments that have such a
 * rule at all, then one query per department for the cards in the window -- never one per rule and
 * never one per card (I-14).
 */
export async function runTimeTriggerScan(log: FastifyBaseLogger): Promise<void> {
  // The one genuinely cross-department read in this module. `scanContext()` carries
  // `actorRole: 'super_admin'` with no department, exactly like `analytics/aggregate.ts`'s own
  // nightly job does -- the policies in migration 1100 allow that instance-level read and nothing
  // else about it: every *write* below happens under a per-department `systemContext`.
  const departments = await repo.listDepartmentsWithTimeTriggers(scanContext())
  for (let i = 0; i < departments.length; i += 1) {
    const departmentId = departments[i]!.departmentId
    const ctx = systemContext(departmentId, null)
    try {
      // eslint-disable-next-line no-await-in-loop -- one department's scan must finish before the
      // next starts so a slow department cannot fan out into hundreds of concurrent transactions;
      // this is a background tick, not a request path.
      const dueSoonRules = await repo.listEnabledRulesForTrigger(ctx, departmentId, 'card_due_soon')
      // eslint-disable-next-line no-await-in-loop -- see above.
      const overdueRules = await repo.listEnabledRulesForTrigger(ctx, departmentId, 'card_overdue')
      const jobs: Array<{ trigger: 'card_due_soon' | 'card_overdue'; daysAhead: number }> = []
      if (dueSoonRules.length > 0) {
        jobs.push({
          trigger: 'card_due_soon',
          daysAhead: Math.max(...dueSoonRules.map((r) => r.triggerConfig.daysAhead ?? 2)),
        })
      }
      if (overdueRules.length > 0) jobs.push({ trigger: 'card_overdue', daysAhead: 0 })

      for (let j = 0; j < jobs.length; j += 1) {
        const job = jobs[j]!
        // eslint-disable-next-line no-await-in-loop -- two iterations at most (due-soon, overdue).
        const cards = await repo.listCardsForTimeTrigger(
          ctx,
          departmentId,
          job.trigger,
          job.daysAhead,
        )
        for (let k = 0; k < cards.length; k += 1) {
          // eslint-disable-next-line no-await-in-loop -- sequential on purpose: each card's rules
          // may write to that card, and a background tick must not stampede the pool.
          await evaluateTrigger(log, departmentId, cards[k]!.id, job.trigger, null, {
            timeBased: true,
          })
        }
      }
    } catch (err) {
      log.error({ err, departmentId }, 'automations: time-trigger scan failed for a department')
    }
  }
}
