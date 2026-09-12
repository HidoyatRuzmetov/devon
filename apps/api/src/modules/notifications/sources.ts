// SPEC §11 -- the database half of the notification registry: turn one outbox row into the
// `EventFacts` a registry builder needs, plus the concrete user ids each `RecipientRule` names.
//
// Split from `registry.ts` on purpose: that file is a pure table (unit-testable with literals, no
// Postgres), this file is the only place that queries. One loader per `SubjectSource`, each a single
// query -- never one query per recipient (I-14 / TECH-SPEC §16 "no query in a loop").
//
// Reads run as a department-scoped system context, the same shape `repo.ts`'s
// `listActiveMemberUserIds` already uses (`departmentAuditCtx()` + the department GUC): RLS on every
// `department_owned` table compares `department_id = app.current_department_id()` and does not branch
// on the actor's role, so setting the department the event was emitted in is exactly the right lens
// -- no wider, no narrower. Personal-workspace tables are never read here at all (I-1).
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { systemAuditCtx } from './repo.js'
import type { EventFacts, RecipientRule, SubjectSource } from './registry.js'

type Extra = Record<string, string | number | null>

/** The resolved half of an event: the facts a builder reads, and the ids each rule names. */
export type ResolvedEvent = {
  facts: EventFacts
  /** `rule -> user ids`. A rule with nobody behind it is simply absent. */
  byRule: Partial<Record<RecipientRule, string[]>>
}

function systemContext(departmentId: string | null): RequestContext {
  const ctx = systemAuditCtx(null)
  return {
    requestId: ctx.requestId,
    userId: null,
    actorRole: 'super_admin',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function pickString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

function pickStringArray(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function fullName(given: string | null, family: string | null): string {
  return [given, family].filter(Boolean).join(' ').trim()
}

function toDate(v: Date | string | null): Date | null {
  if (v === null) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// --- shared lookups ---------------------------------------------------------------------------------

type NameRow = { id: string; given_name: string | null; family_name: string | null }

/** One query for every name any loader below needs -- never one per id. */
async function namesOf(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const rows = await tx.raw<NameRow>(
    sql`select id, given_name, family_name from app.users where id in ${unique}`,
  )
  return new Map(rows.map((r) => [r.id, fullName(r.given_name, r.family_name)]))
}

async function departmentName(tx: Tx, departmentId: string | null): Promise<string> {
  if (!departmentId) return ''
  const rows = await tx.raw<{ name: string }>(
    sql`select name from app.departments where id = ${departmentId}`,
  )
  return rows[0]?.name ?? ''
}

async function headsOf(tx: Tx, departmentId: string | null): Promise<string[]> {
  if (!departmentId) return []
  const rows = await tx.raw<{ user_id: string }>(
    sql`select user_id from app.memberships
        where department_id = ${departmentId} and role = 'head' and status = 'active'
          and deleted_at is null`,
  )
  return rows.map((r) => r.user_id)
}

async function membersOf(tx: Tx, departmentId: string | null): Promise<string[]> {
  if (!departmentId) return []
  const rows = await tx.raw<{ user_id: string }>(
    sql`select user_id from app.memberships
        where department_id = ${departmentId} and status = 'active' and deleted_at is null`,
  )
  return rows.map((r) => r.user_id)
}

async function superAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx.raw<{ id: string }>(
    sql`select id from app.users where role = 'super_admin' and deleted_at is null`,
  )
  return rows.map((r) => r.id)
}

// --- per-source loaders ------------------------------------------------------------------------------
// Each returns the subject-specific half; the caller adds the department-wide rules and the actor name.

type Partial_ = {
  subjectId: string | null
  subjectTitle: string
  at: Date | null
  extra: Extra
  byRule: Partial<Record<RecipientRule, string[]>>
  /** Extra ids whose display names the caller should resolve alongside the actor's. */
  nameIds?: string[]
}

async function loadCard(
  tx: Tx,
  payload: Record<string, unknown>,
  commentToo: boolean,
): Promise<Partial_ | null> {
  const cardId = pickString(payload, 'cardId')
  if (!cardId) return null
  const rows = await tx.raw<{
    id: string
    title: string
    assignee_user_id: string | null
    giver_user_id: string | null
    created_by_user_id: string
    watchers: string[]
    due_at: Date | string | null
  }>(sql`
    select id, title, assignee_user_id, giver_user_id, created_by_user_id, watchers, due_at
    from app.cards where id = ${cardId} and deleted_at is null
  `)
  const card = rows[0]
  if (!card) return null

  const extra: Extra = {}
  const changes = pickStringArray(payload, 'changes')
  if (changes.length > 0) extra['changes'] = changes.join(',')

  if (commentToo) {
    const commentId = pickString(payload, 'commentId')
    if (commentId) {
      const c = await tx.raw<{ body: unknown }>(
        sql`select body from app.card_comments where id = ${commentId} and deleted_at is null`,
      )
      const excerpt = commentExcerpt(c[0]?.body)
      if (excerpt) extra['excerpt'] = excerpt
    }
  }

  return {
    subjectId: card.id,
    subjectTitle: card.title,
    at: toDate(card.due_at),
    extra,
    byRule: {
      assignee: card.assignee_user_id ? [card.assignee_user_id] : [],
      giver: card.giver_user_id ? [card.giver_user_id] : [],
      creator: [card.created_by_user_id],
      watchers: Array.isArray(card.watchers) ? card.watchers : [],
      mentioned: pickStringArray(payload, 'mentions'),
    },
  }
}

/** Card comment bodies are rich-text JSON (`{format, text}` or a TipTap doc). Take the first ~140
 * characters of plain text; anything we cannot read degrades to no excerpt, never to `[object
 * Object]`. */
function commentExcerpt(body: unknown): string | null {
  const flat = flattenText(body).replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat
}

function flattenText(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flattenText).join(' ')
  if (!isRecord(node)) return ''
  const parts: string[] = []
  if (typeof node['text'] === 'string') parts.push(node['text'])
  if (Array.isArray(node['content'])) parts.push(flattenText(node['content']))
  return parts.join(' ')
}

async function loadEvent(tx: Tx, payload: Record<string, unknown>): Promise<Partial_ | null> {
  const eventId = pickString(payload, 'eventId')
  if (!eventId) return null
  const rows = await tx.raw<{
    id: string
    title: string
    organizer_user_id: string
    starts_at: Date | string
    place: string | null
  }>(sql`
    select id, title, organizer_user_id, starts_at, place
    from app.events where id = ${eventId} and deleted_at is null
  `)
  const event = rows[0]
  if (!event) return null

  const rsvps = await tx.raw<{ user_id: string }>(
    sql`select user_id from app.event_rsvps
        where event_id = ${eventId} and status in ('yes', 'maybe', 'waitlist')`,
  )

  const extra: Extra = {}
  if (event.place) extra['place'] = event.place
  const status = pickString(payload, 'status')
  if (status) extra['status'] = status
  const reason = pickString(payload, 'reason')
  if (reason) extra['reason'] = reason
  const changes = pickStringArray(payload, 'changes')
  if (changes.length > 0) extra['changes'] = changes.join(', ')

  return {
    subjectId: event.id,
    subjectTitle: event.title,
    at: toDate(event.starts_at),
    extra,
    byRule: {
      organizer: [event.organizer_user_id],
      rsvped: rsvps.map((r) => r.user_id),
      // `events.rsvp.changed` / `events.comment.created` name the person who acted.
      target_user: [pickString(payload, 'userId')].filter((x): x is string => x !== null),
    },
  }
}

async function loadCarpool(tx: Tx, payload: Record<string, unknown>): Promise<Partial_ | null> {
  const carpoolId = pickString(payload, 'carpoolId')
  if (!carpoolId) return null
  const rows = await tx.raw<{
    id: string
    event_id: string
    driver_user_id: string
    seats: number
    title: string
    starts_at: Date | string
  }>(sql`
    select c.id, c.event_id, c.driver_user_id, c.seats, e.title, e.starts_at
    from app.carpools c join app.events e on e.id = c.event_id
    where c.id = ${carpoolId}
  `)
  const carpool = rows[0]
  if (!carpool) return null

  const rsvps = await tx.raw<{ user_id: string }>(
    sql`select user_id from app.event_rsvps
        where event_id = ${carpool.event_id} and status in ('yes', 'maybe', 'waitlist')`,
  )

  const extra: Extra = { seats: carpool.seats }
  const status = pickString(payload, 'status')
  if (status) extra['status'] = status

  return {
    // The deep link is the event sheet -- a carpool has no route of its own.
    subjectId: carpool.event_id,
    subjectTitle: carpool.title,
    at: toDate(carpool.starts_at),
    extra,
    byRule: {
      carpool_driver: [carpool.driver_user_id],
      rsvped: rsvps.map((r) => r.user_id),
    },
  }
}

async function loadPoll(tx: Tx, payload: Record<string, unknown>): Promise<Partial_ | null> {
  const pollId = pickString(payload, 'pollId')
  if (!pollId) return null
  const rows = await tx.raw<{
    id: string
    event_id: string | null
    question: string
    title: string | null
    organizer_user_id: string | null
    starts_at: Date | string | null
  }>(sql`
    select p.id, p.event_id, p.question, e.title, e.organizer_user_id, e.starts_at
    from app.polls p left join app.events e on e.id = p.event_id
    where p.id = ${pollId}
  `)
  const poll = rows[0]
  if (!poll) return null

  const rsvps = poll.event_id
    ? await tx.raw<{ user_id: string }>(
        sql`select user_id from app.event_rsvps
            where event_id = ${poll.event_id} and status in ('yes', 'maybe', 'waitlist')`,
      )
    : []

  return {
    subjectId: poll.event_id,
    subjectTitle: poll.title ?? poll.question,
    at: toDate(poll.starts_at),
    extra: { question: poll.question },
    byRule: {
      organizer: poll.organizer_user_id ? [poll.organizer_user_id] : [],
      rsvped: rsvps.map((r) => r.user_id),
    },
  }
}

async function loadProject(tx: Tx, payload: Record<string, unknown>): Promise<Partial_ | null> {
  const projectId = pickString(payload, 'projectId')
  if (!projectId) return null
  const rows = await tx.raw<{
    id: string
    title: string
    owner_user_id: string
    members: string[]
    target_on: Date | string | null
  }>(sql`
    select id, title, owner_user_id, members, target_on
    from app.projects where id = ${projectId} and deleted_at is null
  `)
  const project = rows[0]
  if (!project) return null
  return {
    subjectId: project.id,
    subjectTitle: project.title,
    at: toDate(project.target_on),
    extra: {},
    byRule: {
      project_members: [
        project.owner_user_id,
        ...(Array.isArray(project.members) ? project.members : []),
      ],
    },
  }
}

async function loadMembership(tx: Tx, payload: Record<string, unknown>): Promise<Partial_ | null> {
  const userId = pickString(payload, 'userId') ?? pickString(payload, 'headUserId')
  if (!userId) return null
  const names = await namesOf(tx, [userId])
  const extra: Extra = {}
  const status = pickString(payload, 'status')
  if (status) extra['status'] = status
  const decision = pickString(payload, 'decision')
  if (decision) extra['decision'] = decision
  return {
    subjectId: userId,
    subjectTitle: names.get(userId) ?? '',
    at: null,
    extra,
    byRule: { target_user: [userId] },
    nameIds: [userId],
  }
}

async function loadDepartmentRequest(
  tx: Tx,
  payload: Record<string, unknown>,
): Promise<Partial_ | null> {
  const requestId = pickString(payload, 'requestId')
  if (!requestId) return null
  const rows = await tx.raw<{ id: string; name: string; requester_user_id: string }>(
    sql`select id, name, requester_user_id from app.department_requests where id = ${requestId}`,
  )
  const request = rows[0]
  if (!request) return null
  return {
    subjectId: request.id,
    subjectTitle: request.name,
    at: null,
    extra: {},
    byRule: { target_user: [request.requester_user_id] },
  }
}

async function loadUnitRole(tx: Tx, payload: Record<string, unknown>): Promise<Partial_ | null> {
  const unitId = pickString(payload, 'unitId')
  const userId = pickString(payload, 'userId')
  if (!unitId || !userId) return null
  const rows = await tx.raw<{ name: string }>(
    sql`select name from app.units where id = ${unitId} and deleted_at is null`,
  )
  const role = pickString(payload, 'role') ?? 'member'
  return {
    subjectId: unitId,
    subjectTitle: rows[0]?.name ?? '',
    at: null,
    extra: { role },
    byRule: { target_user: [userId] },
  }
}

async function loadAccount(tx: Tx, payload: Record<string, unknown>): Promise<Partial_ | null> {
  const userId = pickString(payload, 'userId') ?? pickString(payload, 'targetUserId')
  if (!userId) return null
  const names = await namesOf(tx, [userId])
  return {
    subjectId: userId,
    subjectTitle: names.get(userId) ?? '',
    at: null,
    extra: {},
    byRule: { target_user: [userId] },
  }
}

// --- the entry point ----------------------------------------------------------------------------------

/**
 * Loads everything the registry entry for `eventType` may ask for. Returns `null` when the subject no
 * longer exists (a card deleted between the write and the outbox drain) -- the handler then records
 * nothing rather than inventing a notification about a row nobody can open.
 */
export async function resolveEvent(input: {
  eventType: string
  source: SubjectSource
  departmentId: string | null
  payload: unknown
}): Promise<ResolvedEvent | null> {
  const payload = isRecord(input.payload) ? input.payload : {}
  return withContext(systemContext(input.departmentId), async (tx) => {
    let part: Partial_ | null
    switch (input.source) {
      case 'card':
        part = await loadCard(tx, payload, false)
        break
      case 'card_comment':
        part = await loadCard(tx, payload, true)
        break
      case 'event':
        part = await loadEvent(tx, payload)
        break
      case 'carpool':
        part = await loadCarpool(tx, payload)
        break
      case 'poll':
        part = await loadPoll(tx, payload)
        break
      case 'project':
        part = await loadProject(tx, payload)
        break
      case 'membership':
        part = await loadMembership(tx, payload)
        break
      case 'department_request':
        part = await loadDepartmentRequest(tx, payload)
        break
      case 'unit_role':
        part = await loadUnitRole(tx, payload)
        break
      case 'account':
        part = await loadAccount(tx, payload)
        break
      default:
        part = null
    }
    if (!part) return null

    const actorUserId = pickString(payload, 'actorUserId')
    const names = await namesOf(tx, [actorUserId ?? '', ...(part.nameIds ?? [])])

    const [heads, members, admins, deptName] = await Promise.all([
      headsOf(tx, input.departmentId),
      membersOf(tx, input.departmentId),
      superAdmins(tx),
      departmentName(tx, input.departmentId),
    ])

    const facts: EventFacts = {
      eventType: input.eventType,
      departmentId: input.departmentId,
      subjectId: part.subjectId,
      subjectTitle: part.subjectTitle,
      actorUserId,
      actorName: actorUserId ? (names.get(actorUserId) ?? '') : '',
      departmentName: deptName,
      at: part.at,
      extra: Object.freeze({ ...part.extra }),
    }

    return {
      facts,
      byRule: {
        ...part.byRule,
        head: heads,
        department: members,
        super_admins: admins,
      },
    }
  })
}
