// EPIC-004 demo seed: the rest of the department roster (see `work-fixtures.ts`'s header for why),
// labels, and ~180 standalone cards spread across every member's column, each with a believable mix
// of checklist items, comments (with @mentions) and an activity timeline.
//
// `order: 90` -- after `core.ts` (order 0, which this module's users/memberships/cards all reference)
// and strictly before `projects.ts` (order 100): a project's `owner_user_id` references a user this
// module inserts, so the roster has to exist first (found the hard way, running this seed against a
// real Postgres via Testcontainers: `projects_owner_user_id_fkey` violation when `projects.ts` ran
// first with `work.ts`'s users not yet inserted).
import * as usersSchema from '../../schema/app.js'
import * as workSchema from '../../schema/work.js'
import { demoId } from '../ids.js'
import { demoPasswordHash } from '../fixtures.js'
import {
  ALL_WORK_MEMBER_IDS,
  CARD_TITLE_POOL,
  CHECKLIST_ITEM_POOL,
  COMMENT_POOL,
  DEMO_LABELS,
  DEPARTMENT_ID,
  WORK_DEMO_USERS,
  labelId,
} from '../work-fixtures.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 90

const NOW = new Date('2026-09-06T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS)
}

type NewCard = typeof workSchema.cards.$inferInsert
type NewChecklistItem = typeof workSchema.cardChecklistItems.$inferInsert
type NewComment = typeof workSchema.cardComments.$inferInsert
type NewActivity = typeof workSchema.cardActivity.$inferInsert

/**
 * One standalone card for `assigneeIndex`'s column, deterministic in every field except wall-clock
 * "now" (`NOW` above is itself fixed, so two runs of this function for the same `(assigneeIndex, n)`
 * produce byte-identical rows -- required for `ON CONFLICT DO NOTHING` to actually recognise a repeat
 * run as a repeat, not as ~180 new near-duplicates).
 */
function buildStandaloneCard(
  assigneeIndex: number,
  n: number,
): {
  card: NewCard
  checklist: NewChecklistItem[]
  comments: NewComment[]
  activity: NewActivity[]
} {
  const assigneeId = ALL_WORK_MEMBER_IDS[assigneeIndex]!
  const giverId = ALL_WORK_MEMBER_IDS[(assigneeIndex + 3 + n) % ALL_WORK_MEMBER_IDS.length]!
  const cardId = demoId(`work.card.standalone.${assigneeIndex}.${n}`)
  const title = CARD_TITLE_POOL[(assigneeIndex * 7 + n) % CARD_TITLE_POOL.length]!
  const priority = PRIORITIES[(assigneeIndex + n) % PRIORITIES.length]!

  const bucket = n % 10
  const status: NewCard['status'] = bucket < 6 ? 'active' : bucket < 8.5 ? 'done' : 'archived'
  const dueOffsetDays = ((assigneeIndex * 5 + n * 3) % 21) - 6 // spans overdue (-6) .. three weeks out
  const hasDue = n % 4 !== 3 // 3/4 of cards carry a due date
  const dueAt = hasDue ? daysFromNow(dueOffsetDays) : null
  const doneAt = status !== 'active' ? daysFromNow(Math.min(dueOffsetDays, -1)) : null
  const archivedAt = status === 'archived' ? daysFromNow(Math.min(dueOffsetDays, -1) + 1) : null

  const cardLabels =
    n % 3 === 0
      ? [labelId(DEMO_LABELS[n % DEMO_LABELS.length]!.key)]
      : n % 3 === 1
        ? [labelId(DEMO_LABELS[0]!.key), labelId(DEMO_LABELS[2]!.key)]
        : []
  const watchers = n % 3 === 0 ? [giverId] : []
  const links =
    n % 5 === 0 ? [{ url: 'https://digital.egov.uz', title: 'Yagona portal', favicon: null }] : []
  const description =
    n % 2 === 0
      ? {
          format: 'markdown' as const,
          text: `${title} boʻyicha batafsil maʼlumot va kutilayotgan natija.`,
        }
      : null

  const card: NewCard = {
    id: cardId,
    departmentId: DEPARTMENT_ID,
    kind: 'task',
    title,
    description,
    assigneeUserId: assigneeId,
    giverUserId: giverId,
    projectId: null,
    projectScope: 'none',
    status,
    priority,
    dueAt,
    doneAt,
    archivedAt,
    orderKey: `a${String(n).padStart(4, '0')}`,
    labels: cardLabels,
    watchers,
    links,
    source: 'manual',
    createdByUserId: giverId,
    createdAt: daysFromNow(dueOffsetDays - 10),
  }

  const checklist: NewChecklistItem[] = []
  if (n % 5 < 2) {
    const count = 2 + (n % 3)
    for (let i = 0; i < count; i += 1) {
      checklist.push({
        id: demoId(`work.checklist.standalone.${assigneeIndex}.${n}.${i}`),
        departmentId: DEPARTMENT_ID,
        cardId,
        text: CHECKLIST_ITEM_POOL[(n + i) % CHECKLIST_ITEM_POOL.length]!,
        doneAt: i === 0 && status !== 'active' ? daysFromNow(dueOffsetDays - 2) : null,
        orderKey: `a${String(i).padStart(4, '0')}`,
      })
    }
  }

  const comments: NewComment[] = []
  const activity: NewActivity[] = [
    {
      id: demoId(`work.activity.standalone.${assigneeIndex}.${n}.created`),
      departmentId: DEPARTMENT_ID,
      cardId,
      actorUserId: giverId,
      kind: 'created',
      data: { title },
      at: daysFromNow(dueOffsetDays - 10),
    },
  ]
  if (n % 3 === 0) {
    const commentAuthor = n % 6 === 0 ? assigneeId : giverId
    const mentioned = commentAuthor === assigneeId ? giverId : assigneeId
    comments.push({
      id: demoId(`work.comment.standalone.${assigneeIndex}.${n}`),
      departmentId: DEPARTMENT_ID,
      cardId,
      authorUserId: commentAuthor,
      body: { format: 'markdown', text: COMMENT_POOL[n % COMMENT_POOL.length]! },
      mentions: n % 2 === 0 ? [mentioned] : [],
      createdAt: daysFromNow(dueOffsetDays - 3),
    })
    activity.push({
      id: demoId(`work.activity.standalone.${assigneeIndex}.${n}.commented`),
      departmentId: DEPARTMENT_ID,
      cardId,
      actorUserId: commentAuthor,
      kind: 'comment',
      data: {},
      at: daysFromNow(dueOffsetDays - 3),
    })
  }
  if (status !== 'active') {
    activity.push({
      id: demoId(`work.activity.standalone.${assigneeIndex}.${n}.status`),
      departmentId: DEPARTMENT_ID,
      cardId,
      actorUserId: assigneeId,
      kind: 'status',
      data: { to: status },
      at: doneAt ?? daysFromNow(dueOffsetDays - 1),
    })
  }

  return { card, checklist, comments, activity }
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let written = 0

  // --- roster -------------------------------------------------------------------------------
  const passwordHash = await demoPasswordHash()
  const insertedUsers = await tx.drizzle
    .insert(usersSchema.users)
    .values(
      WORK_DEMO_USERS.map((u) => ({
        id: u.id,
        login: u.login,
        passwordHash,
        givenName: u.givenName,
        familyName: u.familyName,
        patronymic: u.patronymic,
        title: u.title,
        role: 'member' as const,
        locale: 'uz-Latn' as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: usersSchema.users.id })
  written += insertedUsers.length

  const insertedMemberships = await tx.drizzle
    .insert(usersSchema.memberships)
    .values(
      WORK_DEMO_USERS.map((u) => ({
        id: demoId(`work.membership.${u.login}`),
        departmentId: DEPARTMENT_ID,
        userId: u.id,
        role: 'member' as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: usersSchema.memberships.id })
  written += insertedMemberships.length

  // --- labels ---------------------------------------------------------------------------------
  const insertedLabels = await tx.drizzle
    .insert(workSchema.labels)
    .values(
      DEMO_LABELS.map((l) => ({
        id: labelId(l.key),
        departmentId: DEPARTMENT_ID,
        name: l.name,
        colour: l.colour,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: workSchema.labels.id })
  written += insertedLabels.length

  // --- standalone cards, ~10 per person across all 16 members ----------------------------------
  const allCards: NewCard[] = []
  const allChecklist: NewChecklistItem[] = []
  const allComments: NewComment[] = []
  const allActivity: NewActivity[] = []

  for (let i = 0; i < ALL_WORK_MEMBER_IDS.length; i += 1) {
    const cardCount = 8 + (i % 4) // 8..11 cards per person
    for (let n = 0; n < cardCount; n += 1) {
      const built = buildStandaloneCard(i, n)
      allCards.push(built.card)
      allChecklist.push(...built.checklist)
      allComments.push(...built.comments)
      allActivity.push(...built.activity)
    }
  }

  const insertedCards = await tx.drizzle
    .insert(workSchema.cards)
    .values(allCards)
    .onConflictDoNothing()
    .returning({ id: workSchema.cards.id })
  written += insertedCards.length

  if (allChecklist.length > 0) {
    const insertedChecklist = await tx.drizzle
      .insert(workSchema.cardChecklistItems)
      .values(allChecklist)
      .onConflictDoNothing()
      .returning({ id: workSchema.cardChecklistItems.id })
    written += insertedChecklist.length
  }

  if (allComments.length > 0) {
    const insertedComments = await tx.drizzle
      .insert(workSchema.cardComments)
      .values(allComments)
      .onConflictDoNothing()
      .returning({ id: workSchema.cardComments.id })
    written += insertedComments.length
  }

  if (allActivity.length > 0) {
    const insertedActivity = await tx.drizzle
      .insert(workSchema.cardActivity)
      .values(allActivity)
      .onConflictDoNothing()
      .returning({ id: workSchema.cardActivity.id })
    written += insertedActivity.length
  }

  return written
}
