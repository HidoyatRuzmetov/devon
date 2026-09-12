// Typed endpoint functions for `/api/v1/people/*` (MODULE-GUIDE.md "Web features"). This feature's
// own copy of `apps/api/src/modules/people/schemas.ts`'s shapes, validated at the fetch boundary --
// the same "no shared DTO package" tradeoff every other feature's `api.ts` documents.
//
// Two things are NOT copied, because both sides importing one definition is the whole point:
//  * the indicator registry (`@devon/contracts`) -- a label key or a format that drifted between
//    client and server would show the head a number with the wrong unit;
//  * the saved-view config (`@devon/contracts`) -- the URL, the stored row and the CSV export all
//    describe the same table, so they parse with the same schema.
import { z } from 'zod'
import { peopleViewSchema, type PeopleView, type PeopleViewConfig } from '@devon/contracts'
import { apiClient } from '../../lib/api-client.js'

const indicatorValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])

export const personIndicatorsSchema = z.object({
  userId: z.string(),
  values: z.record(z.string(), indicatorValueSchema),
})
export type PersonIndicators = z.infer<typeof personIndicatorsSchema>

export const indicatorsResponseSchema = z.object({
  people: z.array(personIndicatorsSchema),
  capacityCards: z.number(),
})
export type IndicatorsResponse = z.infer<typeof indicatorsResponseSchema>

/** `keys` narrows the request to the columns actually on screen, so a three-column table costs three
 * aggregate queries instead of twelve (the server skips any source nobody asked for). */
export function fetchIndicators(keys: readonly string[]): Promise<IndicatorsResponse> {
  const query = keys.length > 0 ? `?keys=${encodeURIComponent(keys.join(','))}` : ''
  return apiClient.get(`/api/v1/people/indicators${query}`, indicatorsResponseSchema)
}

// -- Saved views ------------------------------------------------------------------------------------

const viewListSchema = z.object({ views: z.array(peopleViewSchema) })

export function fetchPeopleViews(): Promise<PeopleView[]> {
  return apiClient.get('/api/v1/people/views', viewListSchema).then((r) => r.views)
}

export type CreateViewInput = {
  name: string
  config: PeopleViewConfig
  shared: boolean
  makeDepartmentDefault: boolean
}

export function createPeopleView(input: CreateViewInput, csrf: string): Promise<PeopleView> {
  return apiClient.post('/api/v1/people/views', input, peopleViewSchema, csrf)
}

export type PatchViewInput = {
  name?: string
  config?: PeopleViewConfig
  shared?: boolean
  makeDepartmentDefault?: boolean
  version: number
}

export function patchPeopleView(
  id: string,
  input: PatchViewInput,
  csrf: string,
): Promise<PeopleView> {
  return apiClient.patch(`/api/v1/people/views/${id}`, input, peopleViewSchema, csrf)
}

export function deletePeopleView(id: string, csrf: string): Promise<void> {
  return apiClient.delete(`/api/v1/people/views/${id}`, csrf)
}

/** A plain `<a href>` download, not a fetch: the browser carries the session cookie automatically and
 * the server answers with `content-disposition: attachment`. */
export function peopleExportUrl(keys: readonly string[], ids: readonly string[]): string {
  const params = new URLSearchParams()
  if (keys.length > 0) params.set('keys', keys.join(','))
  if (ids.length > 0) params.set('ids', ids.join(','))
  const query = params.toString()
  return `/api/v1/people/export.csv${query ? `?${query}` : ''}`
}

// -- Person page ------------------------------------------------------------------------------------

export const personCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['active', 'done', 'archived']),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  risk: z.enum(['none', 'at_risk', 'overdue']),
  dueAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  projectId: z.string().nullable(),
  projectTitle: z.string().nullable(),
  giverUserId: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  createdAt: z.string(),
})
export type PersonCard = z.infer<typeof personCardSchema>

export const personOverviewSchema = z.object({
  header: z.object({
    userId: z.string(),
    givenName: z.string(),
    familyName: z.string(),
    patronymic: z.string().nullable(),
    title: z.string().nullable(),
    avatarKey: z.string().nullable(),
    unitId: z.string().nullable(),
    unit: z.string().nullable(),
    unitRole: z.string().nullable(),
    membershipRole: z.enum(['head', 'member']),
    joinedAt: z.string(),
    lastActiveAt: z.string().nullable(),
    telegramLinked: z.boolean(),
    telegramDeepLink: z.string().nullable(),
    locale: z.string(),
    timezone: z.string(),
  }),
  indicators: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  capacityCards: z.number(),
  throughput: z.array(z.object({ week: z.string(), done: z.number(), created: z.number() })),
  onTime: z.array(
    z.object({ week: z.string(), rate: z.number().nullable(), finished: z.number() }),
  ),
  load: z.array(
    z.object({
      projectId: z.string().nullable(),
      title: z.string().nullable(),
      colour: z.string().nullable(),
      open: z.number(),
      overdue: z.number(),
    }),
  ),
  risks: z.array(personCardSchema),
  projects: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      colour: z.string(),
      status: z.string(),
      role: z.enum(['owner', 'member']),
      targetOn: z.string().nullable(),
      totalCards: z.number(),
      doneCards: z.number(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      startsAt: z.string(),
      category: z.string(),
      rsvp: z.string().nullable(),
      guests: z.number(),
      drivesCarpool: z.boolean(),
      claimedSeat: z.boolean(),
    }),
  ),
  polls: z.object({ voted: z.number(), total: z.number() }),
  onboarding: z.object({
    hasRun: z.boolean(),
    percent: z.number(),
    steps: z.array(z.object({ key: z.string(), done: z.boolean() })),
  }),
  canManage: z.boolean(),
})
export type PersonOverview = z.infer<typeof personOverviewSchema>

export function fetchPersonOverview(userId: string): Promise<PersonOverview> {
  return apiClient.get(`/api/v1/people/${userId}/overview`, personOverviewSchema)
}

const personCardsSchema = z.object({ cards: z.array(personCardSchema) })

export function fetchPersonCards(
  userId: string,
  query: { role?: 'assignee' | 'giver'; status?: 'active' | 'done' | 'all' } = {},
): Promise<PersonCard[]> {
  const params = new URLSearchParams()
  if (query.role) params.set('role', query.role)
  if (query.status) params.set('status', query.status)
  const qs = params.toString()
  return apiClient
    .get(`/api/v1/people/${userId}/cards${qs ? `?${qs}` : ''}`, personCardsSchema)
    .then((r) => r.cards)
}

export const activityEntrySchema = z.object({
  at: z.string(),
  kind: z.string(),
  cardId: z.string().nullable(),
  cardTitle: z.string().nullable(),
  eventId: z.string().nullable(),
  eventTitle: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
})
export type ActivityEntry = z.infer<typeof activityEntrySchema>

const activitySchema = z.object({ entries: z.array(activityEntrySchema) })

export function fetchPersonActivity(userId: string): Promise<ActivityEntry[]> {
  return apiClient.get(`/api/v1/people/${userId}/activity`, activitySchema).then((r) => r.entries)
}

// -- Contacts (SPEC §4.3 row action "message via Telegram deep link") -------------------------------

const contactsResponseSchema = z.object({
  contacts: z.array(
    z.object({
      userId: z.string(),
      telegramDeepLink: z.string().nullable(),
    }),
  ),
})
export type PersonContact = z.infer<typeof contactsResponseSchema>['contacts'][number]

/** Head-only, and batched for the whole cohort -- the row action needs a real `tg://` link, not a
 * boolean, and one request answers for every row on screen. */
export function fetchPeopleContacts(): Promise<PersonContact[]> {
  return apiClient.get('/api/v1/people/contacts', contactsResponseSchema).then((r) => r.contacts)
}
