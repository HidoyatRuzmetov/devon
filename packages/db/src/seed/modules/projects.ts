// The quarter's four group projects (members, milestones) and their objective/subjective cards.
// `order: 100` -- strictly after `work.ts` (order 90), which inserts every user a project's
// `owner_user_id`/`members` can reference (found running this against a real Postgres via
// Testcontainers: `projects_owner_user_id_fkey` violation when this ran first).
//
// The four are chosen to be four *shapes* rather than four names (see `work-fixtures.ts`'s
// `PROJECT_FIXTURES` header): on track, slipping, finished, just started. A project's own status is
// what its cards follow -- a "done" project with half its cards still open is the kind of detail that
// makes a manager stop trusting the screen, and it is the kind of detail a generated dataset gets
// wrong by default.
import { inArray } from 'drizzle-orm'
import * as workSchema from '../../schema/work.js'
import * as projectsSchema from '../../schema/projects.js'
import { demoId } from '../ids.js'
import {
  ALL_WORK_MEMBER_IDS,
  DEPARTMENT_ID,
  PROJECT_CARD_TITLES,
  PROJECT_FIXTURES,
  projectIdFor,
} from '../work-fixtures.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 100

/** The same fixed "today" `work.ts` builds its cards around. */
const NOW = new Date('2026-09-06T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS)
}
/** A project's own dates are plain `date` strings; its cards need instants. */
function atNoon(isoDate: string): Date {
  return new Date(`${isoDate}T09:00:00.000Z`)
}
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

type ProjectFixture = (typeof PROJECT_FIXTURES)[number]
type NewProject = typeof projectsSchema.projects.$inferInsert
type NewCard = typeof workSchema.cards.$inferInsert
type NewActivity = typeof workSchema.cardActivity.$inferInsert

/**
 * One project card. `n` indexes within its scope; `slot` spreads the card's dates across the
 * project's own window so a finished project's cards all closed before it closed and a project that
 * opened this week has nothing behind it.
 */
function buildProjectCard(
  project: ProjectFixture,
  scope: 'objective' | 'subjective',
  assigneeId: string,
  giverId: string,
  n: number,
  slot: number,
  slots: number,
): { card: NewCard; activity: NewActivity } {
  const cardId = demoId(`work.card.project.${project.key}.${scope}.${n}`)
  const pool = PROJECT_CARD_TITLES[project.key]![scope]
  const title = pool[n % pool.length]!

  const startedAt = atNoon(project.startOn)
  const startOffset = daysBetween(NOW, startedAt) // negative: days before today
  const targetOffset = daysBetween(NOW, atNoon(project.targetOn))
  const span = Math.max(1, targetOffset - startOffset)
  const position = slots <= 1 ? 0.4 : slot / (slots - 1)

  // A card is created a little after the project opened and is due a little before its target.
  const createdOffset = Math.round(startOffset + span * 0.1 * (1 + position))
  const dueOffset = Math.round(startOffset + span * (0.35 + 0.5 * position))

  // A project's status decides its cards' statuses. `done` closed everything; `planning` has opened
  // nothing yet; an `active` project is part-way, with the objective cards lagging the subjective
  // ones exactly the way shared deliverables do.
  const done =
    project.status === 'done'
      ? true
      : project.status === 'planning'
        ? false
        : scope === 'subjective'
          ? n % 2 === 0
          : n === 0 && project.key === 'egov-portal'

  const doneOffset = Math.min(-1, dueOffset - 1)

  const card: NewCard = {
    id: cardId,
    departmentId: DEPARTMENT_ID,
    kind: 'project_task',
    title,
    description: null,
    assigneeUserId: assigneeId,
    giverUserId: giverId,
    projectId: projectIdFor(project.key),
    projectScope: scope,
    status: done ? 'done' : 'active',
    priority: scope === 'objective' ? 'high' : 'medium',
    dueAt: daysFromNow(dueOffset),
    doneAt: done ? daysFromNow(doneOffset) : null,
    orderKey: `a${String(n).padStart(4, '0')}`,
    labels: [],
    watchers: [],
    links: [],
    source: 'manual',
    createdByUserId: giverId,
    createdAt: daysFromNow(createdOffset),
  }

  const activity: NewActivity = {
    id: demoId(`work.activity.project.${project.key}.${scope}.${n}.created`),
    departmentId: DEPARTMENT_ID,
    cardId,
    actorUserId: giverId,
    kind: 'created',
    data: { title, project: project.key },
    at: daysFromNow(createdOffset),
  }

  return { card, activity }
}

/**
 * Every row this module writes, built deterministically from `PROJECT_FIXTURES` (every field is fixed,
 * `NOW` included, so two calls produce byte-identical rows -- what `ON CONFLICT DO NOTHING` needs to
 * recognise a repeat run). `seed()` inserts these; `reset()` deletes exactly their ids.
 */
function buildProjectRows(): { projects: NewProject[]; cards: NewCard[]; activity: NewActivity[] } {
  const projects: NewProject[] = PROJECT_FIXTURES.map((p) => ({
    id: projectIdFor(p.key),
    departmentId: DEPARTMENT_ID,
    title: p.title,
    description: { format: 'markdown' as const, text: p.description },
    colour: p.colour,
    ownerUserId: ALL_WORK_MEMBER_IDS[p.ownerIndex]!,
    members: p.memberIndexes.map((i) => ALL_WORK_MEMBER_IDS[i]!),
    status: p.status,
    startOn: p.startOn,
    targetOn: p.targetOn,
    milestones: p.milestones.map((m, i) => ({
      id: `${p.key}-m${i}`,
      title: m.title,
      dueOn: m.dueOn,
      doneAt: m.doneOn ? `${m.doneOn}T10:00:00.000Z` : null,
    })),
  }))

  const cards: NewCard[] = []
  const activity: NewActivity[] = []
  for (const p of PROJECT_FIXTURES) {
    const ownerId = ALL_WORK_MEMBER_IDS[p.ownerIndex]!
    const others = p.memberIndexes.filter((i) => i !== p.ownerIndex)

    // Objective cards: the project's shared deliverables, carried by the owner, handed over by
    // whichever other member raised them.
    for (let n = 0; n < p.objectiveCount; n += 1) {
      const giverId = ALL_WORK_MEMBER_IDS[others[n % Math.max(1, others.length)] ?? p.ownerIndex]!
      const built = buildProjectCard(
        p,
        'objective',
        ownerId,
        giverId,
        n,
        n,
        Math.max(1, p.objectiveCount),
      )
      cards.push(built.card)
      activity.push(built.activity)
    }

    // Subjective cards: one slice each for every member who is not the owner, given out by the owner.
    for (let n = 0; n < others.length; n += 1) {
      const memberId = ALL_WORK_MEMBER_IDS[others[n]!]!
      const built = buildProjectCard(p, 'subjective', memberId, ownerId, n, n, others.length)
      cards.push(built.card)
      activity.push(built.activity)
    }
  }

  return { projects, cards, activity }
}

const idsOf = (rows: ReadonlyArray<{ id?: string | undefined }>): string[] => rows.map((r) => r.id!)

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  const rows = buildProjectRows()
  let written = 0

  const insertedProjects = await tx.drizzle
    .insert(projectsSchema.projects)
    .values(rows.projects)
    .onConflictDoNothing()
    .returning({ id: projectsSchema.projects.id })
  written += insertedProjects.length

  const insertedCards = await tx.drizzle
    .insert(workSchema.cards)
    .values(rows.cards)
    .onConflictDoNothing()
    .returning({ id: workSchema.cards.id })
  written += insertedCards.length

  const insertedActivity = await tx.drizzle
    .insert(workSchema.cardActivity)
    .values(rows.activity)
    .onConflictDoNothing()
    .returning({ id: workSchema.cardActivity.id })
  written += insertedActivity.length

  return written
}

/** Reverse of `seed()`: activity, the project cards (`cards_project_id_fkey`), then the projects. All
 * in `DEMO_DEPARTMENT`, so the shared context's GUC already matches every row. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  const rows = buildProjectRows()
  let deleted = 0

  const deletedActivity = await tx.drizzle
    .delete(workSchema.cardActivity)
    .where(inArray(workSchema.cardActivity.id, idsOf(rows.activity)))
    .returning({ id: workSchema.cardActivity.id })
  deleted += deletedActivity.length

  const deletedCards = await tx.drizzle
    .delete(workSchema.cards)
    .where(inArray(workSchema.cards.id, idsOf(rows.cards)))
    .returning({ id: workSchema.cards.id })
  deleted += deletedCards.length

  const deletedProjects = await tx.drizzle
    .delete(projectsSchema.projects)
    .where(inArray(projectsSchema.projects.id, idsOf(rows.projects)))
    .returning({ id: projectsSchema.projects.id })
  deleted += deletedProjects.length

  return deleted
}
