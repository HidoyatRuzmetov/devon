// Department-scoped facts for the same filter grammar the work board exposes. One bounded batch
// per evaluated card, reused by every matching rule; no per-rule/per-person reads or cross-tenant
// name lookup. The rule author is the stable meaning of @me, even for time-based background jobs.
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { FieldValue, FilterableCard } from '@devon/contracts'

type Card = {
  id: string
  title: string
  description: string | null
  status: 'active' | 'done' | 'archived'
  assigneeUserId: string | null
  giverUserId: string | null
  dueAt: string | null
  projectId: string | null
  labels: string[]
  estimateMin: number | null
}
type Member = {
  id: string
  login: string
  given_name: string
  family_name: string
  unit_name: string | null
}
const normalized = (text: string) => text.toLowerCase().replace(/[ʻʼ‘’]/g, "'")

export async function loadFilterFacts(ctx: RequestContext, departmentId: string, card: Card) {
  return withContext(ctx, async (tx) => {
    const members = await tx.raw<Member>(sql`
      select u.id, u.login, u.given_name, u.family_name, un.name as unit_name
      from app.memberships m join app.users u on u.id=m.user_id
      left join app.unit_roles ur on ur.department_id=m.department_id and ur.user_id=u.id and ur.deleted_at is null
      left join app.units un on un.id=ur.unit_id and un.department_id=m.department_id and un.deleted_at is null
      where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null
        and u.status='active' and u.deleted_at is null
    `)
    const projects = card.projectId
      ? await tx.raw<{ title: string }>(sql`
      select title from app.projects where id=${card.projectId} and department_id=${departmentId} and deleted_at is null
    `)
      : []
    const labels = card.labels.length
      ? await tx.raw<{ name: string }>(sql`
      select name from app.labels where department_id=${departmentId} and deleted_at is null
        and id=any(${sql.param(card.labels)}::uuid[])
    `)
      : []
    const values = await tx.raw<{ key: string; value: FieldValue }>(sql`
      select d.key,v.value from app.field_values v join app.field_defs d on d.id=v.def_id
      where v.department_id=${departmentId} and d.department_id=${departmentId}
        and v.subject_type='card' and v.subject_id=${card.id} and d.archived_at is null
    `)
    const filterable: FilterableCard = {
      ...card,
      projectName: projects[0]?.title ?? null,
      unitName: members.find((member) => member.id === card.assigneeUserId)?.unit_name ?? null,
      labelNames: labels.map((label) => label.name),
      fieldValues: Object.fromEntries(values.map((value) => [value.key, value.value])),
    }
    const resolveUserIds = (token: string) => {
      const needle = normalized(token.replace(/^@/, ''))
      if (!needle) return []
      return members
        .filter(
          (member) =>
            normalized(member.login) === needle ||
            normalized(`${member.given_name} ${member.family_name}`).includes(needle) ||
            normalized(member.family_name).includes(needle),
        )
        .map((member) => member.id)
    }
    return { filterable, resolveUserIds }
  })
}
