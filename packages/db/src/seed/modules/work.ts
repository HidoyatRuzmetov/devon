// EPIC-004 demo seed: the rest of the department roster (see `work-fixtures.ts`'s header for why),
// labels, and ~230 standalone cards spread across every member's column, each with a believable mix
// of checklist items, comments (with @mentions) and an activity timeline.
//
// `order: 90` -- after `core.ts` (order 0, which this module's users/memberships/cards all reference)
// and strictly before `projects.ts` (order 100): a project's `owner_user_id` references a user this
// module inserts, so the roster has to exist first (found the hard way, running this seed against a
// real Postgres via Testcontainers: `projects_owner_user_id_fkey` violation when `projects.ts` ran
// first with `work.ts`'s users not yet inserted).
import { inArray } from 'drizzle-orm'
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

/** The department's real subjects, used to tell two cards cut from the same template apart. Cycled
 * alongside the title pool, so the pairing is deterministic and a re-seed writes the same rows. */
const CARD_SUBJECT_POOL: readonly string[] = [
  'e-xizmatlar',
  'litsenziyalash',
  'fuqarolar qabuli',
  'ichki portal',
  'Telegram bot',
  'hisobot tizimi',
  'arxiv',
  'xaridlar',
  'kadrlar boʻlimi',
  'monitoring paneli',
]

/**
 * v1.1 critique SEV2 #24. `CARD_TITLE_POOL` is 35 sentences and the seed writes several hundred
 * cards, so a title necessarily repeats. What made that read as a bug rather than as a busy
 * department was that the repeats were *identical*: the same sentence, twice, on one dashboard.
 *
 * The n-th use of a title gets the n-th subject appended. The first use is left bare -- a department
 * whose every card is "X — y" reads as generated, and most titles are used once.
 */
function titleFor(assigneeIndex: number, n: number): string {
  const index = (assigneeIndex * 7 + n) % CARD_TITLE_POOL.length
  const title = CARD_TITLE_POOL[index]!
  const repeat = Math.floor((assigneeIndex * 7 + n) / CARD_TITLE_POOL.length)
  if (repeat === 0) return title
  return `${title} — ${CARD_SUBJECT_POOL[(repeat - 1) % CARD_SUBJECT_POOL.length]!}`
}

type NewCard = typeof workSchema.cards.$inferInsert
type NewChecklistItem = typeof workSchema.cardChecklistItems.$inferInsert
type NewComment = typeof workSchema.cardComments.$inferInsert
type NewActivity = typeof workSchema.cardActivity.$inferInsert

const workMembershipId = (login: string): string => demoId(`work.membership.${login}`)

/**
 * One standalone card for `assigneeIndex`'s column, deterministic in every field except wall-clock
 * "now" (`NOW` above is itself fixed, so two runs of this function for the same `(assigneeIndex, n)`
 * produce byte-identical rows -- required for `ON CONFLICT DO NOTHING` to actually recognise a repeat
 * run as a repeat, not as ~230 new near-duplicates).
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
  // v1.1 critique SEV2 #24: the pool cycles, so the same sentence came back on several cards --
  // "Yangi loyiha uchun byudjet hisob-kitobi" appeared twice on the head's own dashboard under two
  // different ids (Qaror kutmoqda and Xavf ostida), and "API hujjatlarini yangilash" three times
  // across three people. A head reading one screen saw what looked like duplicates of one task.
  //
  // Every repeat now carries the subject it is actually about, so two cards from the same template
  // are two readable, different pieces of work ("API hujjatlarini yangilash — e-xizmatlar"). The
  // first use of a title stays bare, which is what keeps the board reading like a board rather than
  // like a generated list.
  const title = titleFor(assigneeIndex, n)
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

type StandaloneRows = {
  cards: NewCard[]
  checklist: NewChecklistItem[]
  comments: NewComment[]
  activity: NewActivity[]
}

/** Every standalone card row this module writes, ~14 per person across all 16 members (12..17 cards
 * each: ~230 standalone + ~40 project cards ≈ 250 total, TECH-SPEC §14). Deterministic, so `seed()`
 * inserts exactly the ids `reset()` deletes. */
function buildAllStandaloneRows(): StandaloneRows {
  const all: StandaloneRows = { cards: [], checklist: [], comments: [], activity: [] }
  for (let i = 0; i < ALL_WORK_MEMBER_IDS.length; i += 1) {
    const cardCount = 12 + (i % 6)
    for (let n = 0; n < cardCount; n += 1) {
      const built = buildStandaloneCard(i, n)
      all.cards.push(built.card)
      all.checklist.push(...built.checklist)
      all.comments.push(...built.comments)
      all.activity.push(...built.activity)
    }
    all.cards.push(...buildHistoryCards(i))
  }
  return all
}

/** How many weeks of finished work every person carries behind them. Twelve is the person page's own
 * chart window, so a demo department has a full one. */
const HISTORY_WEEKS = 14

/**
 * v1.1 critique SEV2 #13 / #24 -- "the person page opens on two empty charts ... the demo dataset
 * only carries about four weeks of history".
 *
 * `buildStandaloneCard` above spreads its due dates over a three-week window around "now", which is
 * right for a board -- a board is about the next fortnight. It is wrong for a *report*: "Haftalik
 * natija" plots twelve weeks and had data in four of them, and "Oʻz vaqtida bajarish" drew two
 * points at the far right of an empty axis. A head clicking through from "Kechikayotgan ishlar"
 * landed on what looked like a broken page.
 *
 * So every person also gets a tail of finished work, two or three cards per week going back
 * fourteen weeks, most of them closed on time and a deterministic minority late -- which is what
 * gives the on-time trend a line with a shape rather than a flat 100%. These are `done` and
 * archived-free: they never reach the board, only the reports.
 *
 * Deterministic in every field, like everything else here, so `seed()` writes exactly the ids
 * `reset()` deletes (`idsOf(rows.cards)` already covers them -- they are ordinary standalone cards).
 */
function buildHistoryCards(assigneeIndex: number): NewCard[] {
  const assigneeId = ALL_WORK_MEMBER_IDS[assigneeIndex]!
  const rows: NewCard[] = []
  for (let week = 1; week <= HISTORY_WEEKS; week += 1) {
    // Two or three a week, varying by person and week so no two columns have the same shape.
    const perWeek = 2 + ((assigneeIndex + week) % 2)
    for (let k = 0; k < perWeek; k += 1) {
      const n = week * 10 + k
      const giverId = ALL_WORK_MEMBER_IDS[(assigneeIndex + 2 + week) % ALL_WORK_MEMBER_IDS.length]!
      // Monday-ish of that week, then a weekday inside it.
      const dueOffsetDays = -(week * 7) + (k % 5)
      const dueAt = daysFromNow(dueOffsetDays)
      // Roughly one in five finished late -- enough for the on-time line to move, not so many that
      // the department looks incompetent.
      const late = (assigneeIndex + week * 3 + k) % 5 === 0
      const doneAt = daysFromNow(dueOffsetDays + (late ? 2 : -1))
      rows.push({
        id: demoId(`work.card.history.${assigneeIndex}.${n}`),
        departmentId: DEPARTMENT_ID,
        kind: 'task',
        title: titleFor(assigneeIndex + week, n),
        description: null,
        assigneeUserId: assigneeId,
        giverUserId: giverId,
        projectId: null,
        projectScope: 'none',
        status: 'done',
        priority: PRIORITIES[(assigneeIndex + week + k) % PRIORITIES.length]!,
        dueAt,
        startAt: null,
        doneAt,
        archivedAt: null,
        labels: [],
        watchers: [],
        links: [],
        createdByUserId: giverId,
        createdAt: daysFromNow(dueOffsetDays - 5),
        updatedAt: doneAt,
      })
    }
  }
  return rows
}

const idsOf = (rows: ReadonlyArray<{ id?: string | undefined }>): string[] => rows.map((r) => r.id!)

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
        id: workMembershipId(u.login),
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

  // --- standalone cards ------------------------------------------------------------------------
  const rows = buildAllStandaloneRows()

  const insertedCards = await tx.drizzle
    .insert(workSchema.cards)
    .values(rows.cards)
    .onConflictDoNothing()
    .returning({ id: workSchema.cards.id })
  written += insertedCards.length

  if (rows.checklist.length > 0) {
    const insertedChecklist = await tx.drizzle
      .insert(workSchema.cardChecklistItems)
      .values(rows.checklist)
      .onConflictDoNothing()
      .returning({ id: workSchema.cardChecklistItems.id })
    written += insertedChecklist.length
  }

  if (rows.comments.length > 0) {
    const insertedComments = await tx.drizzle
      .insert(workSchema.cardComments)
      .values(rows.comments)
      .onConflictDoNothing()
      .returning({ id: workSchema.cardComments.id })
    written += insertedComments.length
  }

  if (rows.activity.length > 0) {
    const insertedActivity = await tx.drizzle
      .insert(workSchema.cardActivity)
      .values(rows.activity)
      .onConflictDoNothing()
      .returning({ id: workSchema.cardActivity.id })
    written += insertedActivity.length
  }

  return written
}

/** Reverse of `seed()`: the cards' children, the cards, the labels, then the roster's memberships and
 * users. `projects.ts` (order 100) has already removed the project cards by the time this runs, so
 * nothing else points at these users any more. All department-scoped rows are in `DEMO_DEPARTMENT`,
 * so the shared context's GUC already matches them. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  const rows = buildAllStandaloneRows()
  let deleted = 0

  const deletedActivity = await tx.drizzle
    .delete(workSchema.cardActivity)
    .where(inArray(workSchema.cardActivity.id, idsOf(rows.activity)))
    .returning({ id: workSchema.cardActivity.id })
  deleted += deletedActivity.length

  const deletedComments = await tx.drizzle
    .delete(workSchema.cardComments)
    .where(inArray(workSchema.cardComments.id, idsOf(rows.comments)))
    .returning({ id: workSchema.cardComments.id })
  deleted += deletedComments.length

  const deletedChecklist = await tx.drizzle
    .delete(workSchema.cardChecklistItems)
    .where(inArray(workSchema.cardChecklistItems.id, idsOf(rows.checklist)))
    .returning({ id: workSchema.cardChecklistItems.id })
  deleted += deletedChecklist.length

  const deletedCards = await tx.drizzle
    .delete(workSchema.cards)
    .where(inArray(workSchema.cards.id, idsOf(rows.cards)))
    .returning({ id: workSchema.cards.id })
  deleted += deletedCards.length

  const deletedLabels = await tx.drizzle
    .delete(workSchema.labels)
    .where(
      inArray(
        workSchema.labels.id,
        DEMO_LABELS.map((l) => labelId(l.key)),
      ),
    )
    .returning({ id: workSchema.labels.id })
  deleted += deletedLabels.length

  const deletedMemberships = await tx.drizzle
    .delete(usersSchema.memberships)
    .where(
      inArray(
        usersSchema.memberships.id,
        WORK_DEMO_USERS.map((u) => workMembershipId(u.login)),
      ),
    )
    .returning({ id: usersSchema.memberships.id })
  deleted += deletedMemberships.length

  // Every demo account shares `DEMO_PASSWORD` and can be logged into -- sessions first, for the same
  // `sessions_user_id_fkey` reason `demo.ts` gives for the core accounts.
  const userIds = WORK_DEMO_USERS.map((u) => u.id)
  await tx.drizzle.delete(usersSchema.sessions).where(inArray(usersSchema.sessions.userId, userIds))

  const deletedUsers = await tx.drizzle
    .delete(usersSchema.users)
    .where(inArray(usersSchema.users.id, userIds))
    .returning({ id: usersSchema.users.id })
  deleted += deletedUsers.length

  return deleted
}
