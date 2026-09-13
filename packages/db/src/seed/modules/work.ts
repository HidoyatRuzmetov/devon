// The department's own work: the roster, the five labels, and one quarter of standalone cards spread
// across every member's column, each with a believable mix of checklist items, comments (with
// @mentions) and an activity timeline.
//
// Two things this module is deliberate about, because the demo lives or dies on them:
//
//  1. **Volume.** ~65 standalone cards, 2-7 per person (`work-fixtures.ts`'s `standaloneCardCount`),
//     not the ~230 this used to write. A column a presenter has to scroll is a column nobody reads,
//     and a board that needs scrolling in both axes looks like a load test rather than a week of
//     work. Everything the product can do is still demonstrated -- by one card each, in the open.
//  2. **Time.** Cards are created across the whole quarter (up to 88 days back, weighted towards the
//     recent weeks the way a real backlog is), not inside one 3-week window. `analytics.ts` rebuilds
//     `app.analytics_daily` from exactly these rows, so a flat 12-week chart and a spiky one are the
//     same decision made here: give the cards a history and the charts have trends to show.
//
// `order: 90` -- after `core.ts` (order 0, which this module's users/memberships/cards all reference)
// and strictly before `structure.ts`/`projects.ts` (100): a project's `owner_user_id` and a unit role's
// `user_id` both reference a user this module inserts, so the roster has to exist first (found the
// hard way, running this seed against a real Postgres via Testcontainers:
// `projects_owner_user_id_fkey` violation when `projects.ts` ran first with `work.ts`'s users not yet
// inserted).
import { inArray } from 'drizzle-orm'
import * as usersSchema from '../../schema/app.js'
import * as workSchema from '../../schema/work.js'
import { demoId } from '../ids.js'
import { demoPasswordHash } from '../fixtures.js'
import {
  ALL_WORK_MEMBER_IDS,
  CHECKLIST_ITEM_POOL,
  COMMENT_POOL,
  DEMO_LABELS,
  DEPARTMENT_ID,
  NEWCOMER_INDEX,
  NEWCOMER_JOINED_AT,
  WORK_DEMO_USERS,
  labelId,
  standaloneCardCount,
  standaloneCardId,
  standaloneCardTitle,
} from '../work-fixtures.js'
import type { SeedModuleContext } from '../module-loader.js'
import type { DemoScope } from '../reset-sweep.js'
import { DEMO_NOW } from '../clock.js'

export const order = 90

/** "Today" in the demo dataset, from the one place it is decided (`../clock.ts`). Every other seed
 * module reads the same constant, so a due date written here lands where `events.ts`'s dates and
 * `analytics.ts`'s last history day do, rather than drifting with the clock of whichever machine runs
 * the seed -- and moving the demo forward is one line, not eight. */
const NOW = DEMO_NOW
const DAY_MS = 24 * 60 * 60 * 1000
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

/** How far back the quarter reaches: four days more than `analytics.ts`'s 84-day window, so the
 * oldest cards are already open on the chart's first day instead of the chart opening at zero. */
const QUARTER_DAYS = 88

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS)
}

type NewCard = typeof workSchema.cards.$inferInsert
type NewChecklistItem = typeof workSchema.cardChecklistItems.$inferInsert
type NewComment = typeof workSchema.cardComments.$inferInsert
type NewActivity = typeof workSchema.cardActivity.$inferInsert

const workMembershipId = (login: string): string => demoId(`work.membership.${login}`)

/** The one deterministic "die roll" every per-card decision below reads, so the same `(member, n)`
 * always produces the same card on every machine, forever -- which is what lets `ON CONFLICT DO
 * NOTHING` recognise a repeat `seed:demo` as a repeat rather than as 65 near-duplicates. */
const rollFor = (assigneeIndex: number, n: number): number => (assigneeIndex * 7 + n * 13) % 10

/**
 * The two accounts the presenter actually signs in as (`demo.boshliq`, index 0, and `demo.xodim`,
 * index 1). Their columns are deliberately all-open and recent: every "open this card", "drag it to
 * done", "look at the focus list", "see the blocked chip" moment in docs/DEMO-SCRIPT.md happens in
 * one of these two columns, and `work-plus.ts` hangs its dependency, focus-pin, time-log, reminder
 * and recurrence fixtures off exactly these card ids. A finished card cannot be blocked, cannot be
 * pinned to a focus list and cannot be dragged to done on stage.
 */
const PERSONA_INDEXES: readonly number[] = [0, 1]

/**
 * How many days ago card `n` of `count` was created. `n = 0` is the newest (and so sits at the top of
 * the column, since `orderKey` ascends with `n`); the tail reaches back across the quarter, weighted
 * by `t²` so a real backlog shape comes out -- a thick recent layer and a handful of old stragglers,
 * not one card every twenty days.
 *
 * Two exceptions: the newcomer joined six days ago, so nothing of hers can predate that; and the two
 * persona columns stay inside the last three weeks, because a demo tells this week's story.
 */
function ageDaysFor(assigneeIndex: number, n: number, count: number): number {
  const oldest =
    assigneeIndex === NEWCOMER_INDEX
      ? Math.round((NOW.getTime() - NEWCOMER_JOINED_AT.getTime()) / DAY_MS)
      : PERSONA_INDEXES.includes(assigneeIndex)
        ? 20
        : QUARTER_DAYS
  if (count <= 1) return Math.min(4, oldest)
  const t = n / (count - 1)
  // Without the per-member phase shift, every column'''s newest card lands on the same day and the
  // analytics chart grows a sixteen-card spike on it -- an artefact of the generator, visible on the
  // very screen the demo uses to argue the numbers are real. Sixteen people do not all open a task on
  // the same morning, so the curve should not say they did.
  const phase = (assigneeIndex * 3 + n) % 7
  return Math.min(oldest, Math.max(1, Math.round((oldest - 2) * t ** 2) + 2 + phase))
}

/**
 * One standalone card for `assigneeIndex`'s column. Every field is a pure function of
 * `(assigneeIndex, n)` and the fixed `NOW` above -- no wall clock, no randomness.
 */
function buildStandaloneCard(
  assigneeIndex: number,
  n: number,
  count: number,
): {
  card: NewCard
  checklist: NewChecklistItem[]
  comments: NewComment[]
  activity: NewActivity[]
} {
  const assigneeId = ALL_WORK_MEMBER_IDS[assigneeIndex]!
  const giverId = ALL_WORK_MEMBER_IDS[(assigneeIndex + 3 + n) % ALL_WORK_MEMBER_IDS.length]!
  const cardId = standaloneCardId(assigneeIndex, n)
  const title = standaloneCardTitle(assigneeIndex, n)
  const roll = rollFor(assigneeIndex, n)
  const ageDays = ageDaysFor(assigneeIndex, n, count)
  const createdAt = daysFromNow(-ageDays)

  // Status follows age, the way a real column does: everything from the start of the quarter is
  // finished (a few of them archived out of the way), the middle weeks are mixed, this week is open.
  // A persona column is open all the way down except for its oldest card, which is there so the
  // "bajarildi" filter is not empty when the presenter switches to it.
  const status: NewCard['status'] = PERSONA_INDEXES.includes(assigneeIndex)
    ? n === count - 1
      ? 'done'
      : 'active'
    : ageDays > 30
      ? roll < 8
        ? 'done'
        : 'archived'
      : ageDays > 10
        ? roll < 6
          ? 'done'
          : 'active'
        : roll === 9
          ? 'done'
          : 'active'

  // Closed cards were due while they were still open and were mostly delivered on time -- `roll === 7`
  // is the one in ten that ran late, which is what stops the "muddatida bajarish" goal reading 100%.
  const workDays = 3 + (roll % 12)
  const closedDueOffset = Math.min(-1, -ageDays + workDays)
  const closedDoneOffset = Math.min(-1, closedDueOffset + (roll === 7 ? 4 : -(roll % 3)))

  // Open cards carry a date that is genuinely ahead of them, except for the roughly one in five that
  // has slipped past it -- the overdue count the head's dashboard opens on has to be a real number.
  const openDueOffset = ((assigneeIndex * 3 + n * 5) % 26) - 5
  const hasDue = roll !== 5 // ~9 in 10 carry a due date

  const isClosed = status !== 'active'
  const dueAt = isClosed ? daysFromNow(closedDueOffset) : hasDue ? daysFromNow(openDueOffset) : null
  const doneAt = isClosed ? daysFromNow(closedDoneOffset) : null
  const archivedAt = status === 'archived' ? daysFromNow(Math.min(-1, closedDoneOffset + 2)) : null

  const priority = PRIORITIES[(assigneeIndex + n) % PRIORITIES.length]!

  const cardLabels =
    roll < 3
      ? [labelId(DEMO_LABELS[n % DEMO_LABELS.length]!.key)]
      : roll < 5
        ? [labelId('urgent'), labelId('it')]
        : roll < 7
          ? [labelId('report')]
          : []
  const watchers = roll % 3 === 0 ? [giverId] : []
  const links =
    roll === 2 ? [{ url: 'https://digital.egov.uz', title: 'Yagona portal', favicon: null }] : []
  const description =
    n % 2 === 0
      ? {
          format: 'markdown' as const,
          text: `${title} boʻyicha batafsil maʼlumot va kutilayotgan natija.`,
        }
      : null

  // Where the card came from. Most work is typed in by hand; the demo also needs one card that a
  // template produced, one that arrived from the Telegram bot and one the AI helper turned into a
  // task, because "Devon meets people where they already are" is a claim a card has to back up.
  const source: NewCard['source'] =
    n === 0 && assigneeIndex % 3 === 0
      ? 'template'
      : roll === 4
        ? 'telegram'
        : roll === 8
          ? 'ai'
          : 'manual'

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
    source,
    createdByUserId: giverId,
    createdAt,
  }

  const checklist: NewChecklistItem[] = []
  if (roll < 4) {
    const itemCount = 2 + (roll % 3)
    for (let i = 0; i < itemCount; i += 1) {
      checklist.push({
        id: demoId(`work.checklist.standalone.${assigneeIndex}.${n}.${i}`),
        departmentId: DEPARTMENT_ID,
        cardId,
        text: CHECKLIST_ITEM_POOL[(n + i) % CHECKLIST_ITEM_POOL.length]!,
        // A closed card's checklist is fully ticked; an open one is part-way, which is what makes the
        // "3/5" chip on the card face mean something.
        doneAt: isClosed
          ? daysFromNow(closedDoneOffset)
          : i < itemCount - 1
            ? daysFromNow(-Math.max(1, ageDays - 2))
            : null,
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
      at: createdAt,
    },
  ]
  if (roll % 3 === 0) {
    const commentAuthor = roll % 6 === 0 ? assigneeId : giverId
    const mentioned = commentAuthor === assigneeId ? giverId : assigneeId
    const commentAt = daysFromNow(-Math.max(1, Math.round(ageDays / 2)))
    comments.push({
      id: demoId(`work.comment.standalone.${assigneeIndex}.${n}`),
      departmentId: DEPARTMENT_ID,
      cardId,
      authorUserId: commentAuthor,
      body: { format: 'markdown', text: COMMENT_POOL[(assigneeIndex + n) % COMMENT_POOL.length]! },
      mentions: roll % 2 === 0 ? [mentioned] : [],
      createdAt: commentAt,
    })
    activity.push({
      id: demoId(`work.activity.standalone.${assigneeIndex}.${n}.commented`),
      departmentId: DEPARTMENT_ID,
      cardId,
      actorUserId: commentAuthor,
      kind: 'comment',
      data: {},
      at: commentAt,
    })
  }
  if (isClosed) {
    activity.push({
      id: demoId(`work.activity.standalone.${assigneeIndex}.${n}.status`),
      departmentId: DEPARTMENT_ID,
      cardId,
      actorUserId: assigneeId,
      kind: 'status',
      data: { to: status },
      at: doneAt ?? daysFromNow(-1),
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

/** Every standalone card row this module writes: `standaloneCardCount(i)` per member, ~65 in total.
 * Deterministic, so `seed()` inserts exactly the ids `reset()` deletes. */
function buildAllStandaloneRows(): StandaloneRows {
  const all: StandaloneRows = { cards: [], checklist: [], comments: [], activity: [] }
  for (let i = 0; i < ALL_WORK_MEMBER_IDS.length; i += 1) {
    const cardCount = standaloneCardCount(i)
    for (let n = 0; n < cardCount; n += 1) {
      const built = buildStandaloneCard(i, n, cardCount)
      all.cards.push(built.card)
      all.checklist.push(...built.checklist)
      all.comments.push(...built.comments)
      all.activity.push(...built.activity)
    }
  }
  return all
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
      WORK_DEMO_USERS.map((u, i) => ({
        id: u.id,
        login: u.login,
        passwordHash,
        givenName: u.givenName,
        familyName: u.familyName,
        patronymic: u.patronymic,
        title: u.title,
        role: 'member' as const,
        locale: 'uz-Latn' as const,
        // The newcomer's account was created the day she joined; everybody else has been here since
        // before the quarter started.
        createdAt:
          i + 2 === NEWCOMER_INDEX ? NEWCOMER_JOINED_AT : daysFromNow(-(QUARTER_DAYS + 30)),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: usersSchema.users.id })
  written += insertedUsers.length

  const insertedMemberships = await tx.drizzle
    .insert(usersSchema.memberships)
    .values(
      WORK_DEMO_USERS.map((u, i) => ({
        id: workMembershipId(u.login),
        departmentId: DEPARTMENT_ID,
        userId: u.id,
        role: 'member' as const,
        joinedAt: i + 2 === NEWCOMER_INDEX ? NEWCOMER_JOINED_AT : daysFromNow(-(QUARTER_DAYS + 30)),
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

  // v1.1 critique SEV2 #24, found running the reseed the fix itself asks for. These three deletes
  // named only the ids this module *seeded* -- but a demo box is a box people (and agents driving
  // the real API) have used: every comment written on a seeded card, every checklist item ticked
  // onto one, and every activity row the engine appended when an automation fired belongs to a card
  // this module is about to delete, and none of them had an id any seed module could have predicted.
  // `card_activity_card_id_fkey` therefore blocked the card delete on any instance where the product
  // had actually been used, which is every instance worth reseeding.
  //
  // Deleting by `card_id` rather than by id is both correct and narrower than it looks: the cards
  // named here are exactly the ones about to be removed, so nothing survives that could refer to
  // them. Same shape as `accounts.ts`'s memberships sweep and `work-plus.ts`'s automation runs.
  const cardIds = idsOf(rows.cards)

  const deletedActivity = await tx.drizzle
    .delete(workSchema.cardActivity)
    .where(inArray(workSchema.cardActivity.cardId, cardIds))
    .returning({ id: workSchema.cardActivity.id })
  deleted += deletedActivity.length

  const deletedComments = await tx.drizzle
    .delete(workSchema.cardComments)
    .where(inArray(workSchema.cardComments.cardId, cardIds))
    .returning({ id: workSchema.cardComments.id })
  deleted += deletedComments.length

  const deletedChecklist = await tx.drizzle
    .delete(workSchema.cardChecklistItems)
    .where(inArray(workSchema.cardChecklistItems.cardId, cardIds))
    .returning({ id: workSchema.cardChecklistItems.id })
  deleted += deletedChecklist.length

  const deletedCards = await tx.drizzle
    .delete(workSchema.cards)
    .where(inArray(workSchema.cards.id, cardIds))
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
/** The fourteen roster accounts this module creates (the two fixture personas are `core.ts`'s), for
 * `reset-sweep.ts`. */
export const scope: DemoScope = {
  departmentIds: [],
  userIds: WORK_DEMO_USERS.map((u) => u.id),
}
