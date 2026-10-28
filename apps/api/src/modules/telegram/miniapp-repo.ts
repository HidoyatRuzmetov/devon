// Postgres access for the Telegram Mini App's own two purpose-built reads (v1.1 SPEC §9).
//
// Everything the Mini App can do with an existing endpoint, it does with that endpoint: the inbox is
// `/api/v1/notifications`, a card is `/api/v1/cards/:id`, an RSVP is `/api/v1/events/:id/rsvp`, the
// today list and the Pomodoro are `/api/v1/personal/*`. Duplicating those would duplicate their
// permission checks, their audit rows and their domain events, which is exactly the drift I-7 and I-5
// exist to prevent.
//
// Two things genuinely need their own query, because a phone on a mobile network must not download a
// 5000-card board to show seven cards:
//   * `boardPeek`  -- my column plus a per-person count summary, in two batched queries, never one
//                     per person (I-14 / TECH-SPEC §16 "no query in a loop").
//   * `setupChecklist` -- the head's "is Telegram actually wired up?" answer, one query.
// and one is genuinely optional: the person custom fields (SPEC §5) are owned by the `fields` module,
// which lands in a sibling worktree this package must not depend on -- so every read below is
// feature-detected against the live catalogue and degrades to `{ available: false }`, which the Mini
// App renders as a designed empty state rather than an error.
//
// Same convention as every other module repo here (`notifications/repo.ts`, `telegram/repo.ts`):
// parameterized `tx.raw()` through `withContext()`, never a direct schema import, never string-built
// SQL.
import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'

// --- Board peek ------------------------------------------------------------------------------------

export type MiniCard = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  risk: 'none' | 'at_risk' | 'overdue'
  dueAt: string | null
  assigneeUserId: string | null
  giverUserId: string | null
  projectTitle: string | null
  checklistTotal: number
  checklistDone: number
  commentCount: number
  canEdit: boolean
  version: number
}

export type MiniPerson = {
  userId: string
  givenName: string
  familyName: string
  title: string | null
  unitName: string | null
  role: 'head' | 'member'
  openCards: number
  overdueCards: number
  doneLast7d: number
}

export type BoardPeek = {
  mine: MiniCard[]
  team: MiniPerson[]
  departmentOpenCards: number
  departmentOverdueCards: number
}

type CardRow = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: MiniCard['priority']
  due_at: Date | null
  assignee_user_id: string | null
  giver_user_id: string | null
  created_by_user_id: string
  project_title: string | null
  checklist_total: number
  checklist_done: number
  comment_count: number
  version: number
}

/** Same rule as `work/repo.ts`'s `computeRisk`, kept identical on purpose: the Mini App must not
 * invent a second definition of "at risk" that disagrees with the board the same person sees on the
 * web (WALKTHROUGH-FINDINGS: two screens, two numbers, one truth). */
function riskOf(row: Pick<CardRow, 'status' | 'due_at'>): MiniCard['risk'] {
  if (row.status !== 'active' || !row.due_at) return 'none'
  const due = new Date(row.due_at).getTime()
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now <= 2 * 24 * 60 * 60 * 1000) return 'at_risk'
  return 'none'
}

function toMiniCard(row: CardRow, viewerUserId: string, isHead: boolean): MiniCard {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    risk: riskOf(row),
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    assigneeUserId: row.assignee_user_id,
    giverUserId: row.giver_user_id,
    projectTitle: row.project_title,
    checklistTotal: Number(row.checklist_total ?? 0),
    checklistDone: Number(row.checklist_done ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    // v1.1 SPEC §2.1 `{kind:'owned'}`: giver, assignee and creator, or the boshqarma boshligʻi. The
    // server answers this so the Mini App never guesses a permission (I-6).
    canEdit:
      isHead ||
      row.assignee_user_id === viewerUserId ||
      row.giver_user_id === viewerUserId ||
      row.created_by_user_id === viewerUserId,
    version: row.version,
  }
}

const MINI_CARD_SELECT = sql`
  select c.id, c.title, c.status, c.priority, c.due_at, c.assignee_user_id, c.giver_user_id,
         c.created_by_user_id, c.version, p.title as project_title,
         coalesce(cl.total, 0) as checklist_total, coalesce(cl.done, 0) as checklist_done,
         coalesce(cm.cnt, 0) as comment_count
  from app.cards c
  left join app.projects p on p.id = c.project_id and p.deleted_at is null
  left join lateral (
    select count(*) as total, count(*) filter (where done_at is not null) as done
    from app.card_checklist_items where card_id = c.id and deleted_at is null
  ) cl on true
  left join lateral (
    select count(*) as cnt from app.card_comments where card_id = c.id and deleted_at is null
  ) cm on true
`

/**
 * "My column, and how the team is doing" in two queries.
 *
 * `mine` is every live card assigned to the viewer (plus the ones they gave that are still open, so
 * a boshqarma boshligʻi who assigns work sees it come back), capped and ordered the way the phone
 * wants to read it: overdue first, then by due date, then by priority.
 *
 * `team` is one grouped aggregate over the whole department -- a single `group by` over
 * `app.memberships left join app.cards`, never one count per person.
 */
export async function boardPeek(
  ctx: RequestContext,
  departmentId: string,
  viewerUserId: string,
  isHead: boolean,
): Promise<BoardPeek> {
  return withContext(ctx, async (tx) => {
    const [cardRows, teamRows] = await Promise.all([
      tx.raw<CardRow>(sql`
        ${MINI_CARD_SELECT}
        where c.department_id = ${departmentId}
          and c.deleted_at is null
          and c.status <> 'archived'
          and (c.assignee_user_id = ${viewerUserId} or (c.giver_user_id = ${viewerUserId} and c.status = 'active'))
        order by
          (c.status = 'active' and c.due_at is not null and c.due_at < now()) desc,
          c.due_at asc nulls last,
          case c.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2
                          when 'low' then 3 else 4 end asc,
          c.order_key asc
        limit 60
      `),
      tx.raw<{
        user_id: string
        given_name: string
        family_name: string
        title: string | null
        unit_name: string | null
        role: 'head' | 'member'
        open_cards: number
        overdue_cards: number
        done_last_7d: number
      }>(sql`
        select u.id as user_id, u.given_name, u.family_name, u.title, m.role,
               un.name as unit_name,
               count(c.id) filter (where c.status = 'active')::int as open_cards,
               count(c.id) filter (where c.status = 'active' and c.due_at is not null and c.due_at < now())::int as overdue_cards,
               count(c.id) filter (where c.status = 'done' and c.done_at >= now() - interval '7 days')::int as done_last_7d
        from app.memberships m
        join app.users u on u.id = m.user_id and u.deleted_at is null
        left join app.unit_roles ur
          on ur.user_id = u.id and ur.department_id = m.department_id and ur.deleted_at is null
        left join app.units un on un.id = ur.unit_id and un.deleted_at is null
        left join app.cards c
          on c.assignee_user_id = u.id and c.department_id = m.department_id
             and c.deleted_at is null and c.status <> 'archived'
        where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null
        group by u.id, u.given_name, u.family_name, u.title, m.role, un.name
        order by (m.role = 'head') desc, u.given_name asc, u.family_name asc
      `),
    ])

    const team: MiniPerson[] = teamRows.map((r) => ({
      userId: r.user_id,
      givenName: r.given_name,
      familyName: r.family_name,
      title: r.title,
      unitName: r.unit_name,
      role: r.role,
      openCards: Number(r.open_cards ?? 0),
      overdueCards: Number(r.overdue_cards ?? 0),
      doneLast7d: Number(r.done_last_7d ?? 0),
    }))

    return {
      mine: cardRows.map((row) => toMiniCard(row, viewerUserId, isHead)),
      team,
      departmentOpenCards: team.reduce((sum, p) => sum + p.openCards, 0),
      departmentOverdueCards: team.reduce((sum, p) => sum + p.overdueCards, 0),
    }
  })
}

// --- The head's setup checklist --------------------------------------------------------------------

export type SetupCounts = {
  memberCount: number
  linkedMemberCount: number
  groupCount: number
}

/** One query, three counts. Feeds `GET /telegram/departments/:id/setup-checklist` (head-only) and the
 * Mini App's own "Sozlash" screen. `app.telegram_links` is a `global` table (see
 * `packages/db/src/tenancy.ts`), so the department scoping is the membership join, not RLS. */
export async function setupCounts(ctx: RequestContext, departmentId: string): Promise<SetupCounts> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      member_count: number
      linked_member_count: number
      group_count: number
    }>(sql`
      select
        (select count(*)::int from app.memberships m
          where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null)
          as member_count,
        (select count(*)::int from app.memberships m
          join app.telegram_links tl on tl.user_id = m.user_id and tl.unlinked_at is null
          where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null)
          as linked_member_count,
        (select count(*)::int from app.telegram_groups g
          where g.department_id = ${departmentId} and g.disconnected_at is null)
          as group_count
    `)
    const row = rows[0]
    return {
      memberCount: Number(row?.member_count ?? 0),
      linkedMemberCount: Number(row?.linked_member_count ?? 0),
      groupCount: Number(row?.group_count ?? 0),
    }
  })
}

// --- Person custom fields (SPEC §5), feature-detected ----------------------------------------------

/** Mirrors `FieldValue` in `@devon/contracts`. A jsonb column can physically hold anything, so every
 * value read back is narrowed here rather than trusted -- an object or a nested array left over from
 * a future field type becomes `null` instead of escaping into a response the schema then rejects. */
