import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { quickAddInputSchema } from '@devon/ai'
import { AiInputValidationError } from './errors.js'
import { prepareLiveContext } from './live-context.js'
import { prepareCatchUpContext } from './catch-up-context.js'

/** Read current, permitted records at request time; never ask a head to prepare an AI snapshot.
 * Other helpers already supply bounded task/thread/selection payloads, which remain isolated. */
export async function prepareFeatureInput(
  ctx: RequestContext,
  departmentId: string,
  feature: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (feature === 'quick_add_parse') {
    const parsed = quickAddInputSchema.safeParse({
      ...input,
      today: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    })
    if (!parsed.success) throw new AiInputValidationError('Invalid quick-add input')
    if (input['scope'] === 'personal')
      return { ...parsed.data, members: [], labels: [], projects: [], defaultAssigneeUserId: null }
    return withContext(ctx, async (tx) => {
      const members = await tx.raw<{
        userId: string
        fullName: string
        givenName: string
        handle: string | null
      }>(sql`
        select u.id as "userId", concat_ws(' ',u.given_name,u.family_name) as "fullName",
          u.given_name as "givenName", null::text as handle
        from app.memberships m join app.users u on u.id=m.user_id
        where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null
        order by u.given_name,u.id limit 200`)
      const labels = await tx.raw<{ id: string; name: string }>(sql`
        select id,name from app.labels where department_id=${departmentId} and deleted_at is null order by name,id limit 100`)
      const projects = await tx.raw<{ id: string; title: string }>(sql`
        select id,title from app.projects where department_id=${departmentId} and deleted_at is null order by updated_at desc,id limit 50`)
      return {
        ...parsed.data,
        members,
        labels,
        projects,
        defaultAssigneeUserId: members.some((m) => m.userId === parsed.data.defaultAssigneeUserId)
          ? parsed.data.defaultAssigneeUserId
          : null,
      }
    })
  }
  if (feature === 'duplicate_check') {
    if (
      typeof input['candidateTitle'] !== 'string' ||
      !input['candidateTitle'].trim() ||
      input['candidateTitle'].length > 500
    )
      throw new AiInputValidationError('Invalid duplicate-check title')
    const existing = await withContext(ctx, (tx) =>
      tx.raw(sql`
      select c.id,c.title,c.status,concat_ws(' ',u.given_name,u.family_name) as "assigneeName",
        similarity(c.title,${input['candidateTitle']})::float8 as similarity
      from app.cards c left join app.users u on u.id=c.assignee_user_id
      where c.department_id=${departmentId} and c.deleted_at is null and c.project_id is null
        and c.status='active' and similarity(c.title,${input['candidateTitle']})>0.15
      order by similarity desc,c.id limit 10`),
    )
    return { ...input, existing }
  }
  if (feature === 'catch_up') return prepareCatchUpContext(ctx, departmentId, input)
  return prepareLiveContext(ctx, departmentId, feature, input)
}
