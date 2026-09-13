// Assembles the indicator registry's values for a cohort (v1.1 SPEC §4.2), and caches the result per
// department for 60 seconds.
//
// Why a cache at all: the people table, the person page and the head's dashboard all ask the same
// question about the same department within the same second (three screens, one head, one morning),
// and every source query here is an aggregate over the department's whole card/event history. 60 s is
// long enough to collapse that burst and short enough that a card closed during a standup shows up
// before the meeting ends. The cache key includes the requested keys, never the viewer, because the
// endpoint is head-only and every head of a department sees the same numbers.
import { withContext, type RequestContext } from '@devon/db'
import {
  DEFAULT_WEEKLY_CAPACITY_HOURS,
  INDICATORS,
  type IndicatorKey,
  type IndicatorValue,
  type PersonIndicators,
} from '@devon/contracts'
import * as repo from './repo.js'
import * as personRepo from './person-repo.js'

/** SPEC §7 (A3/A4) adds `estimate_min` and per-person capacity; until they exist, load is measured in
 * open cards against this default weekly capacity, which is what the board already shows a head. The
 * unit is declared in the registry (`workloadPct`) so the UI never invents a meaning for the number,
 * and `workloadHours` stays `null` rather than pretending estimates exist. */
export const DEFAULT_WEEKLY_CARD_CAPACITY = 8

const CACHE_TTL_MS = 60_000

type CacheEntry = { expiresAt: number; value: PersonIndicators[] }
const cache = new Map<string, CacheEntry>()

/** Exported for tests and for the "recompute now" path a later epic may add. */
export function invalidateIndicatorCache(departmentId?: string): void {
  if (!departmentId) {
    cache.clear()
    return
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${departmentId}:`)) cache.delete(key)
  }
}

/**
 * The viewer's *role* is part of the key, not only the department and the columns.
 *
 * The header above says the cache deliberately ignores the viewer because every head of a
 * department sees the same numbers -- true, but a xodim reading their own `/people/me` is not a head
 * and `focusMinutes7d` is computed for one of them and not the other (see `compute`). Sharing one
 * entry between the two would hand whichever request arrived second the other's answer: a head
 * seeing empty focus figures for a minute, or a member seeing a column the matrix does not give
 * them. One extra segment removes the whole class of question.
 */
function cacheKey(
  departmentId: string,
  role: string,
  userIds: readonly string[],
  keys: readonly IndicatorKey[],
) {
  return `${departmentId}:${role}:${[...userIds].sort().join(',')}:${[...keys].sort().join(',')}`
}

const ALL_KEYS: readonly IndicatorKey[] = INDICATORS.map((i) => i.id)

export type IndicatorsRequest = {
  departmentId: string
  /** Empty means "every active member of the department". */
  userIds: readonly string[]
  /** Empty means "every indicator in the registry". */
  keys: readonly IndicatorKey[]
}

export async function getIndicators(
  ctx: RequestContext,
  request: IndicatorsRequest,
): Promise<PersonIndicators[]> {
  const userIds =
    request.userIds.length > 0
      ? request.userIds
      : await repo.activeMemberIds(ctx, request.departmentId)
  const keys = request.keys.length > 0 ? request.keys : ALL_KEYS

  const viewerRole = ctx.departmentRole === 'head' && !ctx.viewAs ? 'head' : 'member'
  const key = cacheKey(request.departmentId, viewerRole, userIds, keys)
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && hit.expiresAt > now) return hit.value

  const value = await compute(ctx, request.departmentId, userIds, keys)
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value })
  // Bounded (H11.1): a department that asks for many different column sets must not grow this map
  // without limit. Oldest-first eviction is enough for a 60 s window.
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
    if (oldest) cache.delete(oldest[0])
  }
  return value
}

function wants(keys: readonly IndicatorKey[], ...ids: IndicatorKey[]): boolean {
  return ids.some((id) => keys.includes(id))
}

async function compute(
  ctx: RequestContext,
  departmentId: string,
  userIds: readonly string[],
  keys: readonly IndicatorKey[],
): Promise<PersonIndicators[]> {
  return withContext(ctx, async (tx) => {
    // One query per SOURCE, in parallel -- never one per person (I-14). A source nobody asked for is
    // not queried at all, so a table showing three columns costs three statements, not twelve.
    const needCards = wants(
      keys,
      'openCards',
      'overdueCards',
      'dueThisWeek',
      'doneLast30d',
      'onTimeRate90d',
      'workloadHours',
      'workloadPct',
      'cardsGivenOpen',
      'onboardingPct',
    )
    const needProjects = wants(keys, 'projects', 'projectsOwned')
    const needEvents = wants(keys, 'eventsRsvpRate90d', 'pollsTurnout', 'onboardingPct')
    const needDirectory = wants(
      keys,
      'unit',
      'unitRole',
      'title',
      'joinedAt',
      'telegramLinked',
      'lastActiveAt',
      'onboardingPct',
    )
    // `app.focus_minutes_by_user` is a `security definer` function that raises (42501) unless the
    // caller is this department's head and is not under view-as -- migration 0904 says so out loud,
    // and that rule is right: it is the one window into a colleague's personal workspace the matrix
    // allows, and it is the head's window. So the caller's own role, not just the requested key,
    // decides whether the query runs at all. Without this a xodim opening their own `/people/me`
    // asked for their own focus figure (a number about themselves, so `indicatorsVisibleTo` allows
    // it) and the whole overview 500'd on the database's refusal.
    const isDepartmentHead = ctx.departmentRole === 'head' && !ctx.viewAs
    const needFocus = wants(keys, 'focusMinutes7d') && isDepartmentHead
    const needOnboarding = wants(keys, 'onboardingPct')

    const [cards, projects, events, directory, focus, started] = await Promise.all([
      needCards ? repo.cardIndicators(tx, departmentId, userIds) : Promise.resolve(null),
      needProjects ? repo.projectIndicators(tx, departmentId, userIds) : Promise.resolve(null),
      needEvents ? repo.eventIndicators(tx, departmentId, userIds) : Promise.resolve(null),
      needDirectory ? repo.directoryRows(tx, departmentId, userIds) : Promise.resolve(null),
      needFocus ? repo.focusMinutes7d(tx, departmentId, userIds) : Promise.resolve(null),
      needOnboarding ? repo.onboardingStarted(tx, departmentId, userIds) : Promise.resolve(null),
    ])

    const directoryById = new Map((directory ?? []).map((row) => [row.userId, row]))

    return userIds.map((userId) => {
      const values: Partial<Record<IndicatorKey, IndicatorValue>> = {}
      const row = directoryById.get(userId)
      const open = cards?.openCards.get(userId) ?? 0

      const set = (id: IndicatorKey, value: IndicatorValue): void => {
        if (keys.includes(id)) values[id] = value
      }

      if (cards) {
        set('openCards', open)
        set('overdueCards', cards.overdueCards.get(userId) ?? 0)
        set('dueThisWeek', cards.dueThisWeek.get(userId) ?? 0)
        set('doneLast30d', cards.doneLast30d.get(userId) ?? 0)
        set('onTimeRate90d', cards.onTimeRate90d.get(userId) ?? 100)
        set('cardsGivenOpen', cards.cardsGivenOpen.get(userId) ?? 0)
        // v1.1 HANDOFFS #5. Estimates ship now (SPEC §7 A3), so Yuklama is hours against this
        // person's own weekly capacity -- which is what a boshliq actually allocates. The `null`
        // is kept for the one case it was always for: a department that does not estimate. Nobody
        // has put an estimate on any of this person's open cards, so an hours figure would be
        // invented, and the registry's "—" is the honest render.
        //
        // `workloadPct` follows the same two worlds and says so in one number: hours-vs-hours where
        // estimates exist, the old cards-vs-`DEFAULT_WEEKLY_CARD_CAPACITY` where they do not. Both
        // are "how full is this week", which is why they are one column and not two.
        const estimatedCards = cards.estimatedCardsOpen.get(userId) ?? 0
        const estimatedHours = cards.estimatedHoursOpen.get(userId) ?? 0
        const capacityHours =
          cards.weeklyCapacityHours.get(userId) ?? DEFAULT_WEEKLY_CAPACITY_HOURS
        set('workloadHours', estimatedCards > 0 ? Math.round(estimatedHours * 10) / 10 : null)
        set(
          'workloadPct',
          estimatedCards > 0 && capacityHours > 0
            ? Math.round((estimatedHours / capacityHours) * 100)
            : Math.round((open / DEFAULT_WEEKLY_CARD_CAPACITY) * 100),
        )
      }
      if (projects) {
        set('projects', projects.projects.get(userId) ?? 0)
        set('projectsOwned', projects.projectsOwned.get(userId) ?? 0)
      }
      if (events) {
        set('eventsRsvpRate90d', events.eventsRsvpRate90d.get(userId) ?? 0)
        set('pollsTurnout', events.pollsTurnout.get(userId) ?? 0)
      }
      if (row) {
        set('unit', row.unit)
        set('unitRole', row.unitRole)
        set('title', row.title)
        set('joinedAt', row.joinedAt)
        set('telegramLinked', row.telegramLinked)
        set('lastActiveAt', row.lastActiveAt)
      }
      if (focus) set('focusMinutes7d', focus.get(userId) ?? 0)
      if (needOnboarding) {
        // The four department-visible steps the newcomer's own Home checklist shows them. See
        // `repo.onboardingStarted` for why this is not read out of their personal tasks (I-1).
        const steps = [
          row?.hasAvatar === true,
          (cards?.openCards.get(userId) ?? 0) + (cards?.doneLast30d.get(userId) ?? 0) > 0,
          (events?.eventsRsvpRate90d.get(userId) ?? 0) > 0,
          row?.telegramLinked === true,
        ]
        const done = steps.filter(Boolean).length
        const hasRun = started?.has(userId) ?? false
        set(
          'onboardingPct',
          hasRun || done < steps.length ? Math.round((done / steps.length) * 100) : 100,
        )
      }
      return { userId, values }
    })
  })
}

// -- Person-page and export helpers (SPEC §4.3, §6) ------------------------------------------------

export type PersonName = {
  userId: string
  givenName: string
  familyName: string
  patronymic: string | null
  title: string | null
  unit: string | null
}

/** Names for a cohort, in the same board order `activeMemberIds` uses, so the CSV's row order
 * matches what the head is looking at on screen. One query. */
export async function getNames(
  ctx: RequestContext,
  departmentId: string,
  userIds: readonly string[],
): Promise<PersonName[]> {
  const ids = userIds.length > 0 ? userIds : await repo.activeMemberIds(ctx, departmentId)
  return withContext(ctx, (tx) => repo.nameRows(tx, departmentId, ids))
}

/** SPEC §4.3: a CSV of everyone's numbers leaving the product is an event the department can account
 * for later. Audited, never silent. */
export async function auditExport(
  ctx: RequestContext,
  departmentId: string,
  detail: { rows: number; keys: readonly string[] },
): Promise<void> {
  await withContext(ctx, async (tx) => {
    tx.audit({
      action: 'people.table.exported',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      after: { rows: detail.rows, columns: [...detail.keys] },
    })
    tx.emit({
      type: 'people.table.exported',
      departmentId,
      payload: { rows: detail.rows, columns: [...detail.keys] },
    })
  })
}

export async function personCards(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  options: { role: 'assignee' | 'giver'; status: 'active' | 'done' | 'all'; limit: number },
): Promise<personRepo.PersonCard[]> {
  return withContext(ctx, (tx) => personRepo.personCards(tx, departmentId, userId, options))
}

export async function personActivity(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  limit: number,
): Promise<personRepo.ActivityEntry[]> {
  return withContext(ctx, (tx) => personRepo.personActivity(tx, departmentId, userId, limit))
}

/** SPEC §4.3's "message via Telegram deep link" row action, for the whole cohort at once. Head-only
 * at the route; this is the batched read behind it. */
export async function getContacts(
  ctx: RequestContext,
  departmentId: string,
  userIds: readonly string[],
): Promise<personRepo.PersonContact[]> {
  const ids = userIds.length > 0 ? userIds : await repo.activeMemberIds(ctx, departmentId)
  return withContext(ctx, (tx) => personRepo.departmentContacts(tx, departmentId, ids))
}
