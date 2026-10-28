import { can, type Actor, type ProblemCode } from '@devon/contracts'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { sql } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'
import { createHash, randomUUID } from 'node:crypto'
import { lockCardOrder, validOrderKey } from './ordering.js'
import { createCardInTx, lockActiveCardTargets } from './repo.js'
import type {
  AssignMany,
  CardChecklistPlan,
  PlannedChecklist,
  WorkflowResult,
} from './workflow-schemas.js'

export class WorkPlanError extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly reason: string,
  ) {
    super(reason)
  }
}
const normalise = (text: string) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’‘`ʻʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
function createInput(ctx: RequestContext, create: NonNullable<CardChecklistPlan['create']>) {
  return {
    departmentId: ctx.departmentId!,
    createdByUserId: ctx.userId!,
    title: create.title,
    description: create.description,
    kind: create.kind,
    assigneeUserId: create.assigneeUserId ?? ctx.userId,
    giverUserId: create.giverUserId ?? ctx.userId,
    priority: create.priority,
    startAt: create.startAt,
    dueAt: create.dueAt,
    labels: create.labels,
    links: create.links,
    projectId: create.projectId,
    projectScope: create.projectScope,
    orderKey: create.orderKey,
    estimateMin: create.estimateMin,
    recurrence: create.recurrence,
    source: ctx.userAgent?.includes(' ai-action/') ? ('ai' as const) : ('manual' as const),
  }
}
async function appendChecklist(
  tx: Tx,
  ctx: RequestContext,
  cardId: string,
  items: PlannedChecklist,
): Promise<number> {
  const existing = await tx.raw<{
    id: string
    text: string
    parent_item_id: string | null
    order_key: string
  }>(sql`select id,text,parent_item_id,order_key from app.card_checklist_items
    where card_id=${cardId} and deleted_at is null order by order_key collate "C",created_at,id for update`)
  // Rebalance legacy keys only when needed, keeping the current visible order intact.
  if (existing.some((item) => !validOrderKey(item.order_key))) {
    const keys = generateNKeysBetween(null, null, existing.length)
    await tx.raw(sql`update app.card_checklist_items i set order_key=v.key from
      (values ${sql.join(
        existing.map((item, index) => sql`(${item.id}::uuid,${keys[index]}::text)`),
        sql`,`,
      )}) v(id,key)
      where i.id=v.id and i.card_id=${cardId}`)
    existing.forEach((item, index) => {
      item.order_key = keys[index]!
    })
  }
  const nextKeys = generateNKeysBetween(existing.at(-1)?.order_key ?? null, null, items.length)
  const known = new Map(
    existing.map((item) => [`${item.parent_item_id ?? ''}:${normalise(item.text)}`, item.id]),
  )
  const ids = new Set(existing.map((item) => item.id)),
    byKey = new Map<string, string>()
  const additions: { id: string; text: string; parentId: string | null; orderKey: string }[] = []
  for (const item of items) {
    const parentId = item.parentKey ? byKey.get(item.parentKey) : (item.parentItemId ?? null)
    if (parentId === undefined || (item.parentItemId && !ids.has(item.parentItemId)))
      throw new WorkPlanError('validation_failed', 'checklist_parent_unavailable')
    const key = `${parentId ?? ''}:${normalise(item.text)}`
    let id = known.get(key)
    if (!id) {
      id = randomUUID()
      known.set(key, id)
      additions.push({ id, text: item.text, parentId, orderKey: nextKeys[additions.length]! })
    }
    byKey.set(item.key, id)
  }
  if (!additions.length) return 0
  // Parent IDs are allocated before the one bulk insert; all child constraints see the same statement.
  await tx.raw(sql`insert into app.card_checklist_items(id,department_id,card_id,parent_item_id,text,order_key)
    values ${sql.join(
      additions.map(
        (item) =>
          sql`(${item.id},${ctx.departmentId},${cardId},${item.parentId},${item.text},${item.orderKey})`,
      ),
      sql`,`,
    )}`)
  await tx.raw(sql`insert into app.card_activity(department_id,card_id,actor_user_id,kind,data)
    values(${ctx.departmentId},${cardId},${ctx.userId},'checklist',${JSON.stringify({ added: additions.map((i) => i.text).join('; '), itemIds: additions.map((i) => i.id), count: additions.length, via: ctx.userAgent?.includes(' ai-action/') ? 'ai' : 'manual' })}::jsonb)`)
  tx.audit({
    action: 'work.checklist_plan_applied',
    subjectType: 'card',
    subjectId: cardId,
    after: { via: 'ai', items: additions },
  })
  tx.emit({
    type: 'work.checklist.updated',
    departmentId: ctx.departmentId,
    payload: { cardId, actorUserId: ctx.userId },
  })
  return additions.length
}
async function once(
  ctx: RequestContext,
  operationId: string,
  input: unknown,
  run: (tx: Tx) => Promise<WorkflowResult>,
): Promise<WorkflowResult> {
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return withContext(ctx, async (tx) => {
    await tx.raw(
      sql`select pg_advisory_xact_lock(hashtextextended(${`work-plan:${ctx.departmentId}:${ctx.userId}:${operationId}`},0))`,
    )
    const previous = await tx.raw<{ fingerprint: string; result: WorkflowResult }>(
      sql`select fingerprint,result from app.work_action_receipts where operation_id=${operationId} and user_id=${ctx.userId}`,
    )
    if (previous[0]) {
      if (previous[0].fingerprint !== fingerprint)
        throw new WorkPlanError('conflict', 'operation_changed')
      return previous[0].result
    }
    const result = await run(tx)
    await tx.raw(sql`insert into app.work_action_receipts(department_id,user_id,operation_id,fingerprint,result)
      values(${ctx.departmentId},${ctx.userId},${operationId},${fingerprint},${JSON.stringify(result)}::jsonb)`)
    tx.audit({
      action: 'work.plan_applied',
      subjectType: 'card',
      subjectId: result.id,
      after: { ...result, operationId, via: 'ai' },
    })
    return result
  })
}
export async function applyCardChecklistPlan(
  ctx: RequestContext,
  actor: Actor,
  operationId: string,
  input: CardChecklistPlan,
): Promise<WorkflowResult> {
  return once(ctx, operationId, { kind: 'cardChecklist', input }, async (tx) => {
    // Shared with normal card creation, so concurrent "create if missing" cannot race a plain create.
    await lockCardOrder(tx, ctx.departmentId!)
    let cardId = input.existingCardId,
      created = 0
    if (!cardId && input.create) {
      const target = input.create.assigneeUserId ?? ctx.userId
      const matches = await tx.raw<{
        id: string
        title: string
      }>(sql`select id,title from app.cards where department_id=${ctx.departmentId}
        and assignee_user_id=${target} and project_id is not distinct from ${input.create.projectId ?? null}::uuid and deleted_at is null for update`)
      const exact = matches.filter(
        (card) => normalise(card.title) === normalise(input.create!.title),
      )
      if (exact.length > 1) throw new WorkPlanError('conflict', 'ambiguous_existing_card')
      cardId = exact[0]?.id
      if (!cardId) {
        const card = await createCardInTx(ctx, tx, createInput(ctx, input.create))
        cardId = card.id
        created = 1
      }
    }
    if (!cardId) throw new WorkPlanError('validation_failed', 'card_required')
    const cards = await tx.raw<{
      assignee_user_id: string | null
      giver_user_id: string | null
      created_by_user_id: string
    }>(sql`select assignee_user_id,giver_user_id,created_by_user_id
      from app.cards where id=${cardId} and department_id=${ctx.departmentId} and deleted_at is null for update`)
    const card = cards[0]
    if (!card) throw new WorkPlanError('not_found', 'card_unavailable')
    if (
      !can(actor, 'update', {
        kind: 'owned',
        departmentId: ctx.departmentId!,
        ownerUserIds: [card.assignee_user_id, card.giver_user_id, card.created_by_user_id].filter(
          (id): id is string => !!id,
        ),
      }).allowed
    )
      throw new WorkPlanError('forbidden', 'card_forbidden')
    const checklistAdded = await appendChecklist(tx, ctx, cardId, input.checklist)
    return { id: cardId, cardIds: [cardId], created, checklistAdded }
  })
}
export async function assignMany(
  ctx: RequestContext,
  operationId: string,
  input: AssignMany,
): Promise<WorkflowResult> {
  if (ctx.departmentRole !== 'head' || ctx.viewAs)
    throw new WorkPlanError('forbidden', 'head_required')
  return once(ctx, operationId, { kind: 'assignMany', input }, async (tx) => {
    await lockCardOrder(tx, ctx.departmentId!)
    const recipients = [...new Set(input.recipientUserIds)].sort()
    await lockActiveCardTargets(tx, ctx.departmentId!, recipients)
    const cardIds: string[] = []
    let checklistAdded = 0
    // One bounded atomic domain operation, not independent HTTP calls. Every creation shares the
    // ordinary validation, ordering, audit and notifications, and any failure rolls all of it back.
    for (let index = 0; index < recipients.length; index += 1) {
      // nosemgrep: query-in-loop
      const card = await createCardInTx(
        ctx,
        tx,
        createInput(ctx, { ...input.task, assigneeUserId: recipients[index]! }),
      )
      cardIds.push(card.id)
      // nosemgrep: query-in-loop
      checklistAdded += await appendChecklist(tx, ctx, card.id, input.checklist)
    }
    return { id: cardIds[0]!, cardIds, created: cardIds.length, checklistAdded }
  })
}
