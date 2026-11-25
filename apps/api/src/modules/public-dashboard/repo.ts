import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import type { PublicDashboard } from '@devon/contracts'
import { createUnitColourIndices, unitHueIndex } from '@devon/contracts'
import { lockDepartmentHeads } from '../../lib/department-heads.js'

type Link = {
  id: string
  label: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const anonymous = (): RequestContext => ({
  requestId: randomUUID(),
  userId: null,
  actorRole: null,
  departmentId: null,
  departmentRole: null,
  actingForUserId: null,
  viewAs: false,
  ip: '',
  userAgent: '',
})
const columns = sql`id,label,created_at::text as "createdAt",expires_at::text as "expiresAt",revoked_at::text as "revokedAt"`
async function isHead(tx: Tx, ctx: RequestContext) {
  if (!ctx.userId || !ctx.departmentId || ctx.viewAs) return false
  await lockDepartmentHeads(tx, ctx.departmentId)
  // Lock the membership and publisher. Departments have SELECT-only RLS for membership-based
  // heads whose global user role remains `member`; requesting a department row lock hides that row.
  const rows =
    await tx.raw(sql`select m.id from app.memberships m join app.users u on u.id=m.user_id
    join app.departments d on d.id=m.department_id
    where m.user_id=${ctx.userId} and m.department_id=${ctx.departmentId} and m.role='head'
      and m.status='active' and m.deleted_at is null and u.status='active' and u.deleted_at is null
      and d.deleted_at is null and d.status='active' for share of m,u`)
  return rows.length > 0
}
export async function list(ctx: RequestContext) {
  return withContext(ctx, async (tx) => {
    if (!(await isHead(tx, ctx))) return null
    return tx.raw<Link>(
      sql`select ${columns} from app.public_dashboard_links where department_id=${ctx.departmentId}
        order by (revoked_at is null and (expires_at is null or expires_at>now())) desc,created_at desc limit 50`,
    )
  })
}
export async function create(ctx: RequestContext, label: string, days: number | null) {
  return withContext(ctx, async (tx) => {
    if (!(await isHead(tx, ctx))) return null
    const [count] = await tx.raw<{ n: number }>(
      sql`select count(*)::int n from app.public_dashboard_links where department_id=${ctx.departmentId} and revoked_at is null and (expires_at is null or expires_at>now())`,
    )
    if ((count?.n ?? 0) >= 10) return 'limit' as const
    const token = randomBytes(32).toString('base64url')
    const expires = days === null ? null : new Date(Date.now() + days * 86400000).toISOString()
    const [link] =
      await tx.raw<Link>(sql`insert into app.public_dashboard_links (department_id,created_by,token_hash,label,expires_at)
      values (${ctx.departmentId},${ctx.userId},${hash(token)},${label},${expires}::timestamptz) returning ${columns}`)
    if (!link) throw new Error('Public dashboard link not created')
    tx.audit({
      action: 'departments.public_dashboard_created',
      subjectType: 'public_dashboard',
      subjectId: link.id,
      after: { label, expiresAt: expires },
    })
    return { ...link, token }
  })
}
export async function revoke(ctx: RequestContext, id: string) {
  return withContext(ctx, async (tx) => {
    if (!(await isHead(tx, ctx))) return false
    const rows =
      await tx.raw(sql`update app.public_dashboard_links set revoked_at=now(),revoked_by=${ctx.userId}
      where id=${id} and department_id=${ctx.departmentId} and revoked_at is null returning id`)
    if (!rows.length) return false
    tx.audit({
      action: 'departments.public_dashboard_revoked',
      subjectType: 'public_dashboard',
      subjectId: id,
    })
    return true
  })
}
export async function read(token: string): Promise<PublicDashboard | null> {
  const tokenHash = hash(token)
  const link = await withContext(
    anonymous(),
    async (tx) =>
      (
        await tx.raw<{ id: string; department_id: string; created_by: string }>(sql`
    select id,department_id,created_by from app.public_dashboard_links
    where token_hash=${tokenHash} and revoked_at is null and (expires_at is null or expires_at>now())`)
      )[0],
  )
  if (!link) return null
  // Cookies never contribute to this context. Token scope is fixed; no user-supplied tenant or IDs.
  const ctx = {
    ...anonymous(),
    userId: link.created_by,
    departmentId: link.department_id,
    actorRole: 'member' as const,
    departmentRole: 'member' as const,
  }
  return withContext(ctx, async (tx) => {
    const [valid] = await tx.raw(sql`select id from app.public_dashboard_links where id=${link.id}
      and token_hash=${tokenHash} and revoked_at is null and (expires_at is null or expires_at>now()) for share`)
    if (!valid) return null
    const [department] = await tx.raw<{ name: string }>(sql`select d.name from app.departments d
      join app.memberships m on m.department_id=d.id join app.users u on u.id=m.user_id
      where d.id=${link.department_id} and d.deleted_at is null and d.status='active'
      and m.user_id=${link.created_by} and m.role='head' and m.status='active' and m.deleted_at is null
      and u.status='active' and u.deleted_at is null for share of m,u`)
    if (!department) return null
    const members = await tx.raw<{
      id: string
      name: string
      head: boolean
    }>(sql`select u.id,concat_ws(' ',u.given_name,u.family_name) as name,(m.role='head') as head
      from app.memberships m join app.users u on u.id=m.user_id where m.department_id=${link.department_id}
      and m.status='active' and m.deleted_at is null and u.status='active' and u.deleted_at is null order by (m.role='head') desc,u.given_name,u.family_name,u.id`)
    const cards = await tx.raw<{
      id: string
      title: string
      stage: string
      assignee: string | null
    }>(sql`select c.id,c.title,c.work_stage as stage,c.assignee_user_id as assignee from app.cards c
      where c.department_id=${link.department_id} and c.status='active' and c.deleted_at is null and c.archived_at is null
      and (c.project_id is null or exists(select 1 from app.projects p where p.id=c.project_id and p.department_id=c.department_id and p.deleted_at is null))
      order by c.order_key,c.created_at,c.id limit 5001`)
    const units = await tx.raw<{
      id: string
      name: string
      parent: string | null
      colour: number | null
    }>(sql`select id,name,parent_unit_id as parent,colour from app.units
      where department_id=${link.department_id} and deleted_at is null order by sort,name,id`)
    const roles = await tx.raw<{
      unit: string
      user: string
      role: 'head' | 'deputy' | 'member'
    }>(sql`select unit_id as unit,user_id as "user",role from app.unit_roles
      where department_id=${link.department_id} and deleted_at is null order by role,user_id`)
    const key = (id: string) =>
      createHmac('sha256', tokenHash).update(id).digest('base64url').slice(0, 22)
    const people = new Set(members.map((m) => m.id)),
      unitIds = new Set(units.map((u) => u.id))
    const palette = createUnitColourIndices(units)
    return {
      department: department.name,
      updatedAt: new Date().toISOString(),
      truncated: cards.length > 5000,
      members: members.map((m) => {
        const unit = roles.find((r) => r.user === m.id && unitIds.has(r.unit))?.unit
        const colour = unit ? `unit-${palette.get(unit)}` : m.head ? 'primary' : 'muted-foreground'
        return {
          key: key(m.id),
          name: m.name,
          head: m.head,
          colour: colour as PublicDashboard['members'][number]['colour'],
        }
      }),
      cards: cards.slice(0, 5000).map((c) => ({
        key: key(c.id),
        title: c.title,
        stage: c.stage === 'in_progress' ? 'in_progress' : 'todo',
        assigneeKey: c.assignee && people.has(c.assignee) ? key(c.assignee) : null,
      })),
      units: units.map((u) => ({
        key: key(u.id),
        name: u.name,
        parentKey: u.parent && unitIds.has(u.parent) ? key(u.parent) : null,
        colour: u.colour ?? unitHueIndex(u.id),
        people: roles
          .filter((r) => r.unit === u.id && people.has(r.user))
          .map((r) => ({ memberKey: key(r.user), role: r.role })),
      })),
    }
  })
}
