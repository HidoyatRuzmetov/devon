// Typed API client for the work module (MODULE-GUIDE.md "Web features"): this feature's own copy of
// the response shapes `apps/api/src/modules/work/schemas.ts` documents, built on `apiClient` exactly
// the way `src/lib/api-client.ts`'s own doc comment shows. Every response is validated at the fetch
// boundary -- a card is never trusted as `any` past this file.
import { z } from 'zod'
import { recurrenceRuleSchema } from '@devon/contracts'
import { apiClient } from '../../lib/api-client.js'

export const cardKindSchema = z.enum(['task', 'project_task'])
export const cardStatusSchema = z.enum(['active', 'done', 'archived'])
export const cardPrioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent'])
export const cardProjectScopeSchema = z.enum(['none', 'objective', 'subjective'])
export const cardRiskSchema = z.enum(['none', 'at_risk', 'overdue'])
export type CardStatus = z.infer<typeof cardStatusSchema>
export type CardPriority = z.infer<typeof cardPrioritySchema>
export type CardRisk = z.infer<typeof cardRiskSchema>

export const descriptionSchema = z
  .object({ format: z.literal('markdown'), text: z.string() })
  .nullable()

export const linkSchema = z.object({
  url: z.string(),
  title: z.string(),
  favicon: z.string().nullable(),
})
export type CardLink = z.infer<typeof linkSchema>

export const memberSummarySchema = z.object({
  userId: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  role: z.enum(['head', 'member']),
  unitId: z.string().nullable(),
  unitName: z.string().nullable(),
})
export type MemberSummary = z.infer<typeof memberSummarySchema>

export const cardSchema = z.object({
  id: z.string(),
  kind: cardKindSchema,
  title: z.string(),
  description: descriptionSchema,
  assigneeUserId: z.string().nullable(),
  giverUserId: z.string().nullable(),
  projectId: z.string().nullable(),
  projectScope: cardProjectScopeSchema,
  status: cardStatusSchema,
  priority: cardPrioritySchema,
  risk: cardRiskSchema,
  startAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  orderKey: z.string(),
  labels: z.array(z.string()),
  watchers: z.array(z.string()),
  links: z.array(linkSchema),
  checklistTotal: z.number().int(),
  checklistDone: z.number().int(),
  commentCount: z.number().int(),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
  /** v1.1 SPEC §2.1 (PERMISSIONS-AUDIT Step 5): the server's own answer to "may this viewer edit
   * this card?" -- true for its giver, its assignee, its creator and the boshqarma boshlig'i. The
   * client never recomputes it; it obeys it. Optional so a response from a server built before this
   * field existed still parses, and absent is treated as "yes" (the old behaviour) rather than as a
   * silent lock-out. */
  canEdit: z.boolean().optional(),

  // --- v1.1 SPEC §7 (work-plus). Every one of these is computed server-side in the same query that
  // loads the card, and every one is optional so a response from a pre-v1.1 server still parses.
  /** A3: the estimate in minutes; `null` = nobody has estimated this card. */
  estimateMin: z.number().int().nullable().optional(),
  /** A3: minutes logged against the card by everybody, summed. */
  loggedMin: z.number().int().optional(),
  /** A10: how many of the cards this one waits for are still open -- `> 0` paints the "Bloklangan"
   * chip on the tile, in the table and on the Gantt bar. */
  blockedByOpenCount: z.number().int().optional(),
  /** A10: how many cards wait for this one. */
  blocksCount: z.number().int().optional(),
  /** A7: the repeat rule, when this card heads a recurring series. */
  recurrence: recurrenceRuleSchema.nullable().optional(),
  recurrenceSeriesId: z.string().nullable().optional(),
  /** A9: true when *this viewer* has the card in their own focus list. Viewer-specific by design --
   * a focus list is personal and nobody else's pin ever shows here. */
  focusPinned: z.boolean().optional(),
})
export type Card = z.infer<typeof cardSchema>

export const checklistItemSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  parentItemId: z.string().nullable(),
  text: z.string(),
  doneAt: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  dueAt: z.string().nullable(),
  orderKey: z.string(),
  version: z.number().int(),
})
export type ChecklistItem = z.infer<typeof checklistItemSchema>

export const commentSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  authorUserId: z.string(),
  body: z.object({ format: z.literal('markdown'), text: z.string() }),
  mentions: z.array(z.string()),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type CardComment = z.infer<typeof commentSchema>

export const activitySchema = z.object({
  id: z.string(),
  cardId: z.string(),
  actorUserId: z.string().nullable(),
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
  at: z.string(),
})
export type CardActivity = z.infer<typeof activitySchema>

export const cardDetailSchema = cardSchema.extend({
  checklist: z.array(checklistItemSchema),
  comments: z.array(commentSchema),
  activity: z.array(activitySchema),
})
export type CardDetail = z.infer<typeof cardDetailSchema>

export const cardListSchema = z.object({
  items: z.array(cardSchema),
  nextCursor: z.string().nullable(),
})

export const boardColumnSchema = z.object({
  member: memberSummarySchema,
  cards: z.array(cardSchema),
})
export type BoardColumn = z.infer<typeof boardColumnSchema>

export const labelSchema = z.object({ id: z.string(), name: z.string(), colour: z.string() })
export type Label = z.infer<typeof labelSchema>

export const boardSchema = z.object({
  members: z.array(memberSummarySchema),
  columns: z.array(boardColumnSchema),
  unassigned: z.array(cardSchema),
  labels: z.array(labelSchema),
})
export type Board = z.infer<typeof boardSchema>

export const savedViewLayoutSchema = z.enum([
  'people_board',
  'table',
  'timeline',
  'calendar',
  'mine',
])
export type SavedViewLayout = z.infer<typeof savedViewLayoutSchema>

export const savedViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  filter: z.string(),
  layout: savedViewLayoutSchema,
  shared: z.boolean(),
  ownerUserId: z.string(),
})
export type SavedView = z.infer<typeof savedViewSchema>
export const savedViewListSchema = z.array(savedViewSchema)

export const archiveListSchema = z.object({
  member: memberSummarySchema,
  items: z.array(cardSchema),
})

export const unfurlResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  favicon: z.string().nullable(),
})
export type UnfurlResult = z.infer<typeof unfurlResultSchema>

const idResultSchema = z.object({ id: z.string() })

// --- endpoint functions -----------------------------------------------------------------------

export function fetchBoard(): Promise<Board> {
  return apiClient.get('/api/v1/board', boardSchema)
}

export type CardListQuery = {
  q?: string | undefined
  mine?: boolean | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

export function fetchCards(query: CardListQuery = {}): Promise<z.infer<typeof cardListSchema>> {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.mine) params.set('mine', 'true')
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit) params.set('limit', String(query.limit))
  const qs = params.toString()
  return apiClient.get(`/api/v1/cards${qs ? `?${qs}` : ''}`, cardListSchema)
}

export function fetchCard(id: string): Promise<CardDetail> {
  return apiClient.get(`/api/v1/cards/${encodeURIComponent(id)}`, cardDetailSchema)
}

export type CreateCardInput = {
  title: string
  description?: string
  kind?: Card['kind']
  assigneeUserId?: string | null
  giverUserId?: string | null
  priority?: CardPriority
  startAt?: string | null
  dueAt?: string | null
  labels?: string[]
  links?: CardLink[]
  projectId?: string | null
  projectScope?: Card['projectScope']
  orderKey?: string
  /** A3: quick-add and the composer both accept an estimate up front -- a card estimated when it is
   * created is the only kind that reliably gets estimated at all. */
  estimateMin?: number | null
  /** A7: create the card already repeating. */
  recurrence?: z.infer<typeof recurrenceRuleSchema> | null
}

export function createCard(input: CreateCardInput, csrfToken: string): Promise<CardDetail> {
  return apiClient.post('/api/v1/cards', input, cardDetailSchema, csrfToken)
}

export type PatchCardInput = Partial<{
  title: string
  description: string | null
  assigneeUserId: string | null
  giverUserId: string | null
  priority: CardPriority
  status: CardStatus
  startAt: string | null
  dueAt: string | null
  labels: string[]
  links: CardLink[]
  watchers: string[]
  orderKey: string
  version: number
  /** A3 / A7: `null` clears the estimate; `null` stops the series (instances already created stay --
   * stopping a repeat never retroactively removes work somebody has started). */
  estimateMin: number | null
  recurrence: z.infer<typeof recurrenceRuleSchema> | null
}>

export function patchCard(
  id: string,
  patch: PatchCardInput,
  csrfToken: string,
): Promise<CardDetail> {
  return apiClient.patch(
    `/api/v1/cards/${encodeURIComponent(id)}`,
    patch,
    cardDetailSchema,
    csrfToken,
  )
}

export async function restoreCard(id: string, csrfToken: string): Promise<void> {
  await apiClient.post(`/api/v1/cards/${encodeURIComponent(id)}/restore`, {}, z.void(), csrfToken)
}

export async function toggleWatcher(id: string, csrfToken: string): Promise<CardDetail> {
  return apiClient.post(
    `/api/v1/cards/${encodeURIComponent(id)}/watchers`,
    {},
    cardDetailSchema,
    csrfToken,
  )
}

export function addChecklistItem(
  cardId: string,
  input: {
    text: string
    parentItemId?: string | null
    assigneeUserId?: string | null
    dueAt?: string | null
    orderKey?: string
  },
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post(
    `/api/v1/cards/${encodeURIComponent(cardId)}/checklist`,
    input,
    idResultSchema,
    csrfToken,
  )
}

export async function patchChecklistItem(
  cardId: string,
  itemId: string,
  patch: Partial<{
    text: string
    done: boolean
    assigneeUserId: string | null
    dueAt: string | null
    orderKey: string
  }>,
  csrfToken: string,
): Promise<void> {
  await apiClient.patch(
    `/api/v1/cards/${encodeURIComponent(cardId)}/checklist/${encodeURIComponent(itemId)}`,
    patch,
    z.void(),
    csrfToken,
  )
}

export async function deleteChecklistItem(
  cardId: string,
  itemId: string,
  csrfToken: string,
): Promise<void> {
  await apiClient.delete(
    `/api/v1/cards/${encodeURIComponent(cardId)}/checklist/${encodeURIComponent(itemId)}`,
    csrfToken,
  )
}

export function addComment(
  cardId: string,
  input: { text: string; mentions?: string[] },
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post(
    `/api/v1/cards/${encodeURIComponent(cardId)}/comments`,
    input,
    idResultSchema,
    csrfToken,
  )
}

export function fetchLabels(): Promise<Label[]> {
  return apiClient.get('/api/v1/labels', z.array(labelSchema))
}

export function createLabel(
  input: { name: string; colour?: string },
  csrfToken: string,
): Promise<Label> {
  return apiClient.post('/api/v1/labels', input, labelSchema, csrfToken)
}

export function fetchSavedViews(): Promise<SavedView[]> {
  return apiClient.get('/api/v1/views', savedViewListSchema)
}

export function createSavedView(
  input: { name: string; filter: string; layout: SavedViewLayout; shared?: boolean },
  csrfToken: string,
): Promise<SavedView> {
  return apiClient.post('/api/v1/views', input, savedViewSchema, csrfToken)
}

export async function deleteSavedView(id: string, csrfToken: string): Promise<void> {
  await apiClient.delete(`/api/v1/views/${encodeURIComponent(id)}`, csrfToken)
}

export function fetchArchive(userId: string): Promise<z.infer<typeof archiveListSchema>> {
  return apiClient.get(`/api/v1/archive?userId=${encodeURIComponent(userId)}`, archiveListSchema)
}

export function unfurlLink(url: string, csrfToken: string): Promise<UnfurlResult> {
  return apiClient.post('/api/v1/links/unfurl', { url }, unfurlResultSchema, csrfToken)
}
