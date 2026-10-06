import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'

export async function deleteProject(ctx: RequestContext, projectId: string): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const projects = await tx.raw<{ snapshot: Record<string, unknown> }>(sql`
      select to_jsonb(p) as snapshot from app.projects p where p.id = ${projectId}
        and p.department_id = ${ctx.departmentId} and p.deleted_at is null for update`)
    if (!projects[0]) return false
    const cards = await tx.raw<{ id: string; snapshot: Record<string, unknown> }>(sql`
      select c.id, to_jsonb(c) as snapshot from app.cards c where c.project_id = ${projectId}
        and c.department_id = ${ctx.departmentId} and c.deleted_at is null for update`)
    await tx.raw(sql`update app.projects set deleted_at = now(), deleted_by_user_id = ${ctx.userId},
      updated_at = now(), version = version + 1 where id = ${projectId}`)
    await tx.raw(sql`update app.cards set deleted_at = now(), deleted_by_user_id = ${ctx.userId},
      deleted_by_project_id = ${projectId}, updated_at = now(), version = version + 1
      where project_id = ${projectId} and department_id = ${ctx.departmentId} and deleted_at is null`)
    tx.audit({
      action: 'projects.project_deleted',
      subjectType: 'project',
      subjectId: projectId,
      departmentId: ctx.departmentId,
      before: projects[0].snapshot,
      after: { cardIds: cards.map((c) => c.id) },
    })
    for (const card of cards) {
      tx.audit({
        action: 'work.card_deleted',
        subjectType: 'card',
        subjectId: card.id,
        departmentId: ctx.departmentId,
        before: card.snapshot,
        after: { deletedWithProjectId: projectId },
      })
      tx.emit({
        type: 'work.card.deleted',
        departmentId: ctx.departmentId,
        payload: { cardId: card.id, actorUserId: ctx.userId },
      })
    }
    tx.emit({
      type: 'projects.project.updated',
      departmentId: ctx.departmentId,
      payload: { projectId, deleted: true },
    })
    return true
  })
}

export async function undoProjectDeletion(
  ctx: RequestContext,
  projectId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const projects = await tx.raw<{ id: string }>(sql`update app.projects set deleted_at = null,
      deleted_by_user_id = null, updated_at = now(), version = version + 1
      where id = ${projectId} and department_id = ${ctx.departmentId} and deleted_by_user_id = ${ctx.userId}
        and deleted_at >= now() - interval '30 seconds' returning id`)
    if (!projects[0]) return false
    const cards = await tx.raw<{ id: string }>(sql`update app.cards set deleted_at = null,
      deleted_by_user_id = null, deleted_by_project_id = null, updated_at = now(), version = version + 1
      where project_id = ${projectId} and department_id = ${ctx.departmentId}
        and deleted_by_project_id = ${projectId} returning id`)
    tx.audit({
      action: 'projects.project_restored',
      subjectType: 'project',
      subjectId: projectId,
      departmentId: ctx.departmentId,
      after: { cardIds: cards.map((c) => c.id) },
    })
    for (const card of cards) {
      tx.audit({
        action: 'work.card_delete_undone',
        subjectType: 'card',
        subjectId: card.id,
        departmentId: ctx.departmentId,
        after: { restoredWithProjectId: projectId },
      })
      tx.emit({
        type: 'work.card.restored',
        departmentId: ctx.departmentId,
        payload: { cardId: card.id, actorUserId: ctx.userId },
      })
    }
    tx.emit({
      type: 'projects.project.updated',
      departmentId: ctx.departmentId,
      payload: { projectId },
    })
    return true
  })
}
