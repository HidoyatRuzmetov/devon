// Translates the Work module's filter grammar (`@devon/contracts`'s `parseFilterQuery` -- TECH-SPEC
// §4/§9: "a filter bar with a filter grammar ... person, unit, project, giver, label, date range,
// status") into concrete id sets this module's own SQL can filter `app.cards` by. The grammar package
// is deliberately table-agnostic (its own header: "token -> candidate-id resolution is injected by
// the caller") -- this file is analytics's own injection, reading `app.users`/`app.projects`/
// `app.labels`/`app.unit_roles` (a different module's tables, reached the same way every chart query
// below does: `Tx.raw()` against the shared `app` schema, MODULE-GUIDE.md never having forbidden a
// *read* of another module's table, only importing its schema file or editing its code).
import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '@devon/db'
import { parseFilterQuery, resolveDateWord, type CardFilterStatus } from '@devon/contracts'

export type ResolvedFilter = {
  assigneeIds: string[] | null
  giverIds: string[] | null
  status: CardFilterStatus | null
  projectIds: string[] | null
  labelIds: string[] | null
  unitMemberIds: string[] | null
  textTerms: string[]
  dueBefore: Date | null
  dueAfter: Date | null
}

type MemberLite = { id: string; login: string; givenName: string; familyName: string }
type ProjectLite = { id: string; title: string }
type LabelLite = { id: string; name: string }
type UnitMemberLite = { unitName: string; userId: string }

function emptyFilter(): ResolvedFilter {
  return {
    assigneeIds: null,
    giverIds: null,
    status: null,
    projectIds: null,
    labelIds: null,
    unitMemberIds: null,
    textTerms: [],
    dueBefore: null,
    dueAfter: null,
  }
}

function matchPerson(token: string, members: readonly MemberLite[], meUserId: string): string[] {
  if (token === '@me' || token === 'me') return [meUserId]
  const needle = token.replace(/^@/, '').trim().toLowerCase()
  if (needle.length === 0) return []
  return members
    .filter(
      (m) =>
        m.login.toLowerCase() === needle ||
        m.givenName.toLowerCase().includes(needle) ||
        m.familyName.toLowerCase().includes(needle) ||
        `${m.givenName} ${m.familyName}`.toLowerCase().includes(needle),
    )
    .map((m) => m.id)
}

/** Intersects repeated clauses of the same kind (AND semantics, matching
 * `filter-grammar.ts`'s `matchesFilterQuery`: "every clause must match"). */
function intersect(existing: string[] | null, ids: readonly string[]): string[] {
  if (existing === null) return [...ids]
  const set = new Set(ids)
  return existing.filter((id) => set.has(id))
}

export async function resolveFilter(
  tx: Tx,
  departmentId: string,
  filterText: string,
  viewerUserId: string,
): Promise<ResolvedFilter> {
  const query = parseFilterQuery(filterText ?? '')
  const result = emptyFilter()
  if (query.clauses.length === 0) return result

  const needsPeople = query.clauses.some((c) => c.kind === 'assignee' || c.kind === 'giver')
  const needsProjects = query.clauses.some((c) => c.kind === 'project')
  const needsLabels = query.clauses.some((c) => c.kind === 'label')
  const needsUnits = query.clauses.some((c) => c.kind === 'unit')

  const [members, projects, labels, unitMembers] = await Promise.all([
    needsPeople
      ? tx.raw<MemberLite>(sql`
          select u.id, u.login, u.given_name as "givenName", u.family_name as "familyName"
          from app.users u
          join app.memberships m on m.user_id = u.id
          where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null
        `)
      : Promise.resolve([] as MemberLite[]),
    needsProjects
      ? tx.raw<ProjectLite>(sql`
          select id, title from app.projects
          where department_id = ${departmentId} and deleted_at is null
        `)
      : Promise.resolve([] as ProjectLite[]),
    needsLabels
      ? tx.raw<LabelLite>(sql`
          select id, name from app.labels
          where department_id = ${departmentId} and deleted_at is null
        `)
      : Promise.resolve([] as LabelLite[]),
    needsUnits
      ? tx.raw<UnitMemberLite>(sql`
          select un.name as "unitName", ur.user_id as "userId"
          from app.unit_roles ur
          join app.units un on un.id = ur.unit_id and un.deleted_at is null
          where ur.department_id = ${departmentId} and ur.deleted_at is null
        `)
      : Promise.resolve([] as UnitMemberLite[]),
  ])

  for (const clause of query.clauses) {
    switch (clause.kind) {
      case 'assignee':
        result.assigneeIds = intersect(
          result.assigneeIds,
          matchPerson(clause.token, members, viewerUserId),
        )
        break
      case 'giver':
        result.giverIds = intersect(
          result.giverIds,
          matchPerson(clause.token, members, viewerUserId),
        )
        break
      case 'status':
        result.status = clause.value
        break
      case 'project': {
        const ids = projects
          .filter((p) => p.title.toLowerCase() === clause.name.toLowerCase())
          .map((p) => p.id)
        result.projectIds = intersect(result.projectIds, ids)
        break
      }
      case 'label': {
        const ids = labels
          .filter((l) => l.name.toLowerCase() === clause.name.toLowerCase())
          .map((l) => l.id)
        result.labelIds = intersect(result.labelIds, ids)
        break
      }
      case 'unit': {
        const ids = unitMembers
          .filter((u) => u.unitName.toLowerCase() === clause.name.toLowerCase())
          .map((u) => u.userId)
        result.unitMemberIds = intersect(result.unitMemberIds, ids)
        break
      }
      case 'due': {
        const target = resolveDateWord(clause.word)
        if (target) {
          if (clause.op === '<=' || clause.op === '<' || clause.op === '=')
            result.dueBefore = target
          if (clause.op === '>=' || clause.op === '>' || clause.op === '=') result.dueAfter = target
        }
        break
      }
      case 'text':
        result.textTerms.push(clause.value)
        break
    }
  }
  return result
}

/** One AND-joined predicate over `app.cards` (aliased `c` or bare -- callers `sql.join` this into
 * their own query, same "no query in a loop" shape `personal/repo.ts`'s `joinSet` uses). An id array
 * resolved to *zero* matches (e.g. `assignee:nobody-by-this-name`) still produces `= any('{}')`,
 * correctly matching nothing rather than silently dropping the restriction. */
export function cardsFilterSql(f: ResolvedFilter, column = ''): SQL {
  const col = (name: string) => sql.raw(column ? `${column}.${name}` : name)
  const parts: SQL[] = [sql`true`]
  // `sql.param(...)`, never a bare `${array}` -- drizzle's tagged template treats a plain JS array
  // interpolation as a *list* of separate bound values (for `IN (${arr})`-style expansion), not one
  // array-typed parameter; `sql.param` is `work/repo.ts`'s own documented escape hatch for "bind this
  // whole array as a single `uuid[]` parameter" (its `patch.labels`/`patch.watchers` writes use the
  // same wrapper for exactly this reason -- found the hard way: a one-element id array produced a bare
  // scalar `$n`, which Postgres then rejected as a malformed array literal).
  if (f.assigneeIds)
    parts.push(sql`${col('assignee_user_id')} = any(${sql.param(f.assigneeIds)}::uuid[])`)
  if (f.giverIds) parts.push(sql`${col('giver_user_id')} = any(${sql.param(f.giverIds)}::uuid[])`)
  if (f.unitMemberIds)
    parts.push(sql`${col('assignee_user_id')} = any(${sql.param(f.unitMemberIds)}::uuid[])`)
  if (f.status) parts.push(sql`${col('status')} = ${f.status}`)
  if (f.projectIds) parts.push(sql`${col('project_id')} = any(${sql.param(f.projectIds)}::uuid[])`)
  if (f.labelIds) parts.push(sql`${col('labels')} && ${sql.param(f.labelIds)}::uuid[]`)
  for (const term of f.textTerms) parts.push(sql`${col('title')} ilike ${'%' + term + '%'}`)
  if (f.dueAfter) parts.push(sql`${col('due_at')} >= ${f.dueAfter}`)
  if (f.dueBefore) parts.push(sql`${col('due_at')} <= ${f.dueBefore}`)
  return sql.join(parts, sql.raw(' and '))
}

export function hasPersonRestriction(f: ResolvedFilter): boolean {
  return f.assigneeIds !== null || f.giverIds !== null || f.unitMemberIds !== null
}
