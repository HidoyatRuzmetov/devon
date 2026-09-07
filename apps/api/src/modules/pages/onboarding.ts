// "A newcomer's join creates their onboarding checklist as personal-workspace tasks linked to the
// template" (TECH-SPEC §3.5), opt-in per department (`onboarding_templates.enabled`). Hooks into the
// `departments.member.joined` domain event (`apps/api/src/modules/departments/repo.ts`'s `joinByKey`)
// exactly as MODULE-GUIDE.md's "Domain events" describes: "subscribe at import time, anywhere that
// runs once at boot" -- this module's own `index.ts` plugin body, never a shared boot file.
//
// Two tables written in one transaction: `app.onboarding_runs` (department-owned; idempotency ledger
// so a redelivered event, or someone leaving and rejoining, never creates the checklist twice) and
// `app.personal_tasks` (user-owned, a different module's table -- MODULE-GUIDE.md's own precedent for
// a cross-module reference is `personal_tasks.linked_card_id`, "id only, never a foreign key"; here
// the reference runs the other way, one system write touching both tables, exactly like
// `notifications/notify.ts`'s `systemAuditCtx` pattern for "the system, acting as a specific user").
import type { FastifyBaseLogger } from 'fastify'
import { sql } from 'drizzle-orm'
import { subscribe, withContext, type OutboxEventRecord, type RequestContext } from '@devon/db'

function systemContext(departmentId: string, userId: string): RequestContext {
  return {
    requestId: `pages-onboarding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    actorRole: 'member',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-pages/onboarding',
  }
}

type TemplateRow = { id: string; items: { id: string; text: string; ownerRole: string }[] }

function isJoinedPayload(v: unknown): v is { userId: string; status: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['userId'] === 'string' &&
    typeof (v as Record<string, unknown>)['status'] === 'string'
  )
}

/**
 * Creates one newcomer-owned personal task per `ownerRole: 'newcomer'` item of every *enabled*
 * onboarding template in the department, at most once per (template, user) -- the `onboarding_runs`
 * unique index (`0700_analytics_pages.sql`) is the actual guarantee; the `for` loop below (never
 * `for-of`, per I-16's "no await in a loop" convention already used by `notifications/jobs.ts`) just
 * keeps each template's write independent and attributable if one fails.
 */
export async function runOnboardingForNewcomer(
  log: FastifyBaseLogger,
  departmentId: string,
  userId: string,
): Promise<void> {
  const templates = await withContext(systemContext(departmentId, userId), (tx) =>
    tx.raw<TemplateRow>(sql`
      select id, items from app.onboarding_templates
      where department_id = ${departmentId} and enabled = true and deleted_at is null
    `),
  )
  if (templates.length === 0) return

  for (let i = 0; i < templates.length; i += 1) {
    const template = templates[i]!
    const newcomerItems = template.items.filter((item) => item.ownerRole === 'newcomer')
    if (newcomerItems.length === 0) continue

    try {
      await withContext(systemContext(departmentId, userId), async (tx) => {
        const claimed = await tx.raw<{ id: string }>(sql`
          insert into app.onboarding_runs (department_id, template_id, user_id, created_task_count)
          values (${departmentId}, ${template.id}, ${userId}, ${newcomerItems.length})
          on conflict (template_id, user_id) do nothing
          returning id
        `)
        if (claimed.length === 0) return // already ran for this (template, user) pair

        // One INSERT for every item (I-16: no query in a loop) -- a VALUES list joined against the
        // target table, the same shape `personal/repo.ts`'s `reorderTasks` already uses for a batch.
        const valueRows = newcomerItems.map(
          (item, sort) => sql`(${userId}::uuid, ${item.text}::text, ${sort}::int)`,
        )
        await tx.raw(sql`
          insert into app.personal_tasks (user_id, title, sort)
          select v.user_id, v.title, v.sort from (values ${sql.join(valueRows, sql.raw(', '))})
            as v(user_id, title, sort)
        `)
        tx.audit({
          action: 'pages.onboarding_template.applied',
          subjectType: 'onboarding_template',
          subjectId: template.id,
          departmentId,
          after: { userId, createdTaskCount: newcomerItems.length },
        })
      })
    } catch (err) {
      log.error(
        { err, departmentId, userId, templateId: template.id },
        'pages: onboarding template application failed',
      )
    }
  }
}

function makeHandler(log: FastifyBaseLogger) {
  return async (event: OutboxEventRecord): Promise<void> => {
    if (!isJoinedPayload(event.payload) || !event.departmentId) return
    if (event.payload.status !== 'active') return // pending approval: applied once actually approved
    await runOnboardingForNewcomer(log, event.departmentId, event.payload.userId)
  }
}

/** Called once from `index.ts`'s plugin body, exactly like `notifications/events.ts`'s own
 * registration -- a Fastify plugin function body runs exactly once per process. */
export function registerOnboardingSubscription(log: FastifyBaseLogger): () => void {
  return subscribe('departments.member.joined', makeHandler(log))
}
