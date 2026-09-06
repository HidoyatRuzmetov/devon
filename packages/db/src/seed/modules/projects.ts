// EPIC-005 demo seed: 6 group projects (members, milestones) plus their objective/subjective cards.
// `order: 100` -- strictly after `work.ts` (order 90), which inserts every user a project's
// `owner_user_id`/`members` can reference (found running this against a real Postgres via
// Testcontainers: `projects_owner_user_id_fkey` violation when this ran first).
import { inArray } from 'drizzle-orm'
import * as workSchema from '../../schema/work.js'
import * as projectsSchema from '../../schema/projects.js'
import { demoId } from '../ids.js'
import {
  ALL_WORK_MEMBER_IDS,
  CARD_TITLE_POOL,
  DEPARTMENT_ID,
  PROJECT_FIXTURES,
  projectIdFor,
} from '../work-fixtures.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 100

const NOW = new Date('2026-09-06T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS)
}

type NewProject = typeof projectsSchema.projects.$inferInsert
type NewCard = typeof workSchema.cards.$inferInsert
type NewActivity = typeof workSchema.cardActivity.$inferInsert

function buildProjectCard(
  projectKey: string,
  scope: 'objective' | 'subjective',
  assigneeId: string,
  giverId: string,
  n: number,
): { card: NewCard; activity: NewActivity } {
  const cardId = demoId(`work.card.project.${projectKey}.${scope}.${n}`)
  const title = CARD_TITLE_POOL[(n * 11) % CARD_TITLE_POOL.length]!
  const dueOffsetDays = (n % 5) * 6 + 3
  const done = n % 3 === 0
  const status: NewCard['status'] = done ? 'done' : 'active'

  const card: NewCard = {
    id: cardId,
    departmentId: DEPARTMENT_ID,
    kind: 'project_task',
    title,
    description: null,
    assigneeUserId: assigneeId,
    giverUserId: giverId,
    projectId: projectIdFor(projectKey),
    projectScope: scope,
    status,
    priority: scope === 'objective' ? 'high' : 'medium',
    dueAt: daysFromNow(dueOffsetDays),
    doneAt: done ? daysFromNow(dueOffsetDays - 2) : null,
    orderKey: `a${String(n).padStart(4, '0')}`,
    labels: [],
    watchers: [],
    links: [],
    source: 'manual',
    createdByUserId: giverId,
    createdAt: daysFromNow(-14),
  }

  const activity: NewActivity = {
    id: demoId(`work.activity.project.${projectKey}.${scope}.${n}.created`),
    departmentId: DEPARTMENT_ID,
    cardId,
    actorUserId: giverId,
    kind: 'created',
    data: { title, project: projectKey },
    at: daysFromNow(-14),
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
    startOn: '2026-09-01',
    targetOn: p.milestones.at(-1)?.dueOn ?? '2026-12-31',
    milestones: p.milestones.map((m, i) => ({
      id: `${p.key}-m${i}`,
      title: m.title,
      dueOn: m.dueOn,
      doneAt: m.done ? `${m.dueOn}T10:00:00.000Z` : null,
    })),
  }))

  // Objective (shared, assignee = owner) + subjective (one per other member) cards.
  const cards: NewCard[] = []
  const activity: NewActivity[] = []
  for (const p of PROJECT_FIXTURES) {
    const ownerId = ALL_WORK_MEMBER_IDS[p.ownerIndex]!
    for (let n = 0; n < 4; n += 1) {
      const otherMemberId = ALL_WORK_MEMBER_IDS[p.memberIndexes[(n + 1) % p.memberIndexes.length]!]!
      const built = buildProjectCard(p.key, 'objective', ownerId, otherMemberId, n)
      cards.push(built.card)
      activity.push(built.activity)
    }
    for (let mi = 0; mi < p.memberIndexes.length; mi += 1) {
      const memberId = ALL_WORK_MEMBER_IDS[p.memberIndexes[mi]!]!
      if (memberId === ownerId) continue
      const built = buildProjectCard(p.key, 'subjective', memberId, ownerId, mi)
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
