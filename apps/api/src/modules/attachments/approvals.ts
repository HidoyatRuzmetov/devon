import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'

export const APPROVAL_THRESHOLD = 100 * 1024 * 1024
type Request = { subjectType: 'card' | 'page'; subjectId: string; name: string; size: number }
export async function requestApproval(ctx: RequestContext, input: Request): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    // Serialize requests from the same uploader, including double-clicks and retried network calls.
    await tx.raw(sql`select pg_advisory_xact_lock(hashtext(${ctx.userId}))`)
    const [approved] = await tx.raw<{
      id: string
    }>(sql`update app.file_upload_approvals set status = 'consumed'
      where id = (select id from app.file_upload_approvals where department_id = ${ctx.departmentId} and user_id = ${ctx.userId}
        and subject_type = ${input.subjectType} and subject_id = ${input.subjectId} and name = ${input.name} and size = ${input.size}
        and status = 'approved' order by created_at desc limit 1 for update) returning id`)
    if (approved) {
      tx.audit({
        action: 'attachments.approval_consumed',
        subjectType: 'file_upload_approval',
        subjectId: approved.id,
        departmentId: ctx.departmentId,
      })
      tx.emit({
        type: 'attachments.approval.consumed',
        departmentId: ctx.departmentId,
        payload: { approvalId: approved.id, actorUserId: ctx.userId },
      })
      return true
    }
    const [pending] = await tx.raw<{
      id: string
    }>(sql`select id from app.file_upload_approvals where department_id = ${ctx.departmentId}
      and user_id = ${ctx.userId} and subject_type = ${input.subjectType} and subject_id = ${input.subjectId}
      and name = ${input.name} and size = ${input.size} and status = 'pending' limit 1`)
    if (!pending) {
      const [row] = await tx.raw<{
        id: string
      }>(sql`insert into app.file_upload_approvals(department_id,user_id,subject_type,subject_id,name,size)
        values(${ctx.departmentId},${ctx.userId},${input.subjectType},${input.subjectId},${input.name},${input.size}) returning id`)
      tx.audit({
        action: 'attachments.approval_requested',
        subjectType: 'file_upload_approval',
        subjectId: row!.id,
        departmentId: ctx.departmentId,
        after: { size: input.size },
      })
      tx.emit({
        type: 'attachments.approval.requested',
        departmentId: null,
        payload: { approvalId: row!.id, actorUserId: ctx.userId },
      })
    }
    return false
  })
}
export async function listApprovals(ctx: RequestContext) {
  return withContext(ctx, (tx) =>
    tx.raw<{
      id: string
      name: string
      size: number
      department: string
      requester: string
      subjectType: string
    }>(sql`
    select a.id,a.name,a.size,a.subject_type as "subjectType",d.name as department,u.given_name || ' ' || u.family_name as requester
    from app.file_upload_approvals a join app.departments d on d.id=a.department_id join app.users u on u.id=a.user_id
    where a.status='pending' order by a.created_at`),
  )
}
export async function ownApprovals(
  ctx: RequestContext,
  subjectType: 'card' | 'page',
  subjectId: string,
) {
  return withContext(ctx, (tx) =>
    tx.raw<{ id: string; name: string; status: string }>(sql`
    select id, name, status from app.file_upload_approvals where user_id=${ctx.userId}
      and department_id=${ctx.departmentId} and subject_type=${subjectType} and subject_id=${subjectId}
      and status <> 'consumed' order by created_at desc limit 20`),
  )
}
export async function reviewApproval(ctx: RequestContext, id: string, approved: boolean) {
  return withContext(ctx, async (tx) => {
    const [row] = await tx.raw<{ id: string; department_id: string }>(
      sql`update app.file_upload_approvals set status=${approved ? 'approved' : 'rejected'}, reviewed_by=${ctx.userId}, reviewed_at=now() where id=${id} and status='pending' returning id,department_id`,
    )
    if (!row) return false
    tx.audit({
      action: 'attachments.approval_reviewed',
      subjectType: 'file_upload_approval',
      subjectId: id,
      departmentId: row.department_id,
      after: { approved },
    })
    tx.emit({
      type: 'attachments.approval.reviewed',
      departmentId: row.department_id,
      payload: { approvalId: id, actorUserId: ctx.userId },
    })
    return true
  })
}
