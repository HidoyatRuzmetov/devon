// v1.1 SPEC §7 -- the work module's client for everything v1.1 added on top of a card: estimates and
// the light time log (A3), dependencies (A10), reminders (7.4), the bulk bar (A8), templates (7.2),
// the focus list (A9), capacity + workload (A4) and goals (A11).
//
// A second api file rather than a longer `api.ts`, for the same reason the server split
// `schemas-plus.ts` off `schemas.ts`: `api.ts` is the v1.0 card contract and is named in comments
// across this feature. Every response is still validated at the fetch boundary -- nothing here is
// trusted as `any` past this file.
import { z } from 'zod'
import { goalMetricSchema, recurrenceRuleSchema, workTemplateKindSchema } from '@devon/contracts'
import { apiClient } from '../../lib/api-client.js'
import { cardPrioritySchema, cardRiskSchema, cardStatusSchema, memberSummarySchema } from './api.js'

/** Every create in this file answers `201 { id }` and every update/delete answers `204` -- the
 * house shape (`api.ts`'s own `idResultSchema`). The caller re-reads through its query rather than
 * trusting an echo the server never sent. */
const idResultSchema = z.object({ id: z.string() })

// --- A10 dependencies ---------------------------------------------------------------------------

/** A card as a *reference* -- what a dependency row, a blocked chip, a focus pin and a goal
 * breakdown all need, with none of the weight of the full card DTO (mirrors the server's
 * `cardRefSchema`). */
export const cardRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: cardStatusSchema,
  risk: cardRiskSchema,
  dueAt: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
})
export type CardRef = z.infer<typeof cardRefSchema>

export const dependencyEntrySchema = z.object({ id: z.string(), card: cardRefSchema })
export type DependencyEntry = z.infer<typeof dependencyEntrySchema>

export const cardDependenciesSchema = z.object({
  blockedBy: z.array(dependencyEntrySchema),
  blocks: z.array(dependencyEntrySchema),
})
export type CardDependencies = z.infer<typeof cardDependenciesSchema>

export function fetchCardDependencies(cardId: string): Promise<CardDependencies> {
  return apiClient.get(
    `/api/v1/cards/${encodeURIComponent(cardId)}/dependencies`,
    cardDependenciesSchema,
  )
}

export function addCardDependency(
  cardId: string,
  blockedByCardId: string,
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post(
    `/api/v1/cards/${encodeURIComponent(cardId)}/dependencies`,
    { blockedByCardId },
    idResultSchema,
    csrfToken,
  )
}

export async function removeCardDependency(
  cardId: string,
  depId: string,
  csrfToken: string,
): Promise<void> {
  await apiClient.delete(
    `/api/v1/cards/${encodeURIComponent(cardId)}/dependencies/${encodeURIComponent(depId)}`,
    csrfToken,
  )
}

/** Every edge in the department, so the dependency picker can grey out the cards that would close a
 * cycle *before* the user clicks (`wouldCreateDependencyCycle` from `@devon/contracts` runs on
 * this). The alternative -- letting the server refuse -- teaches nothing and costs a round trip. */
export const dependencyEdgeSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  blockedByCardId: z.string(),
})
export type DependencyEdgeRow = z.infer<typeof dependencyEdgeSchema>
export const dependencyGraphSchema = z.array(dependencyEdgeSchema)

export function fetchDependencyGraph(): Promise<DependencyEdgeRow[]> {
  return apiClient.get('/api/v1/work/dependencies', dependencyGraphSchema)
}

// --- A3 estimates and the light time log ---------------------------------------------------------

export const timeLogEntrySchema = z.object({
  id: z.string(),
  cardId: z.string(),
  userId: z.string(),
  minutes: z.number().int(),
  spentOn: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type TimeLogEntry = z.infer<typeof timeLogEntrySchema>

export const cardTimeLogSchema = z.object({
  entries: z.array(timeLogEntrySchema),
  loggedMin: z.number().int(),
  estimateMin: z.number().int().nullable(),
  remainingMin: z.number().int().nullable(),
})
export type CardTimeLog = z.infer<typeof cardTimeLogSchema>

export function fetchCardTimeLog(cardId: string): Promise<CardTimeLog> {
  return apiClient.get(`/api/v1/cards/${encodeURIComponent(cardId)}/time-logs`, cardTimeLogSchema)
}

export function addTimeLog(
  cardId: string,
  input: { minutes: number; spentOn?: string; note?: string },
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post(
    `/api/v1/cards/${encodeURIComponent(cardId)}/time-logs`,
    input,
    idResultSchema,
    csrfToken,
  )
}

export async function deleteTimeLog(
  cardId: string,
  logId: string,
  csrfToken: string,
): Promise<void> {
  await apiClient.delete(
    `/api/v1/cards/${encodeURIComponent(cardId)}/time-logs/${encodeURIComponent(logId)}`,
    csrfToken,
  )
}

// --- 7.4 reminders --------------------------------------------------------------------------------

export const cardReminderSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  remindAt: z.string(),
  note: z.string().nullable(),
  sentAt: z.string().nullable(),
})
export type CardReminder = z.infer<typeof cardReminderSchema>
export const cardReminderListSchema = z.array(cardReminderSchema)

export function fetchCardReminders(cardId: string): Promise<CardReminder[]> {
  return apiClient.get(
    `/api/v1/cards/${encodeURIComponent(cardId)}/reminders`,
    cardReminderListSchema,
  )
}

export function addCardReminder(
  cardId: string,
  input: { remindAt: string; note?: string },
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post(
    `/api/v1/cards/${encodeURIComponent(cardId)}/reminders`,
    input,
    idResultSchema,
    csrfToken,
  )
}

export async function deleteCardReminder(
  cardId: string,
  reminderId: string,
  csrfToken: string,
): Promise<void> {
  await apiClient.delete(
    `/api/v1/cards/${encodeURIComponent(cardId)}/reminders/${encodeURIComponent(reminderId)}`,
    csrfToken,
  )
}

// --- A8 the bulk bar -------------------------------------------------------------------------------

export const bulkUndoEntrySchema = z.object({
  id: z.string(),
  assigneeUserId: z.string().nullable(),
  priority: cardPrioritySchema,
  dueAt: z.string().nullable(),
  status: cardStatusSchema,
  estimateMin: z.number().int().nullable(),
  labels: z.array(z.string()),
})
export type BulkUndoEntry = z.infer<typeof bulkUndoEntrySchema>

export const bulkCardResultSchema = z.object({
  updated: z.array(z.string()),
  forbidden: z.array(z.string()),
  notFound: z.array(z.string()),
  undo: z.array(bulkUndoEntrySchema),
})
export type BulkCardResult = z.infer<typeof bulkCardResultSchema>

export type BulkCardPatch = Partial<{
  assigneeUserId: string | null
  priority: z.infer<typeof cardPrioritySchema>
  dueAt: string | null
  status: z.infer<typeof cardStatusSchema>
  estimateMin: number | null
  addLabelIds: string[]
  removeLabelIds: string[]
}>

export function bulkPatchCards(
  ids: string[],
  patch: BulkCardPatch,
  csrfToken: string,
): Promise<BulkCardResult> {
  return apiClient.post('/api/v1/cards/bulk', { ids, patch }, bulkCardResultSchema, csrfToken)
}

export function undoBulkPatch(
  entries: BulkUndoEntry[],
  csrfToken: string,
): Promise<BulkCardResult> {
  return apiClient.post('/api/v1/cards/bulk/undo', { entries }, bulkCardResultSchema, csrfToken)
}

// --- 7.2 templates ---------------------------------------------------------------------------------

export const workTemplateScopeSchema = z.enum(['department', 'personal'])

export const workTemplateSchema = z.object({
  id: z.string(),
  kind: workTemplateKindSchema,
  scope: workTemplateScopeSchema,
  ownerUserId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  useCount: z.number().int(),
  createdAt: z.string(),
  canManage: z.boolean(),
})
export type WorkTemplate = z.infer<typeof workTemplateSchema>
export const workTemplateListSchema = z.array(workTemplateSchema)

export function fetchWorkTemplates(kind?: 'card' | 'project'): Promise<WorkTemplate[]> {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ''
  return apiClient.get(`/api/v1/work/templates${qs}`, workTemplateListSchema)
}

export function createWorkTemplate(
  input: {
    kind: 'card' | 'project'
    scope?: 'department' | 'personal'
    name: string
    description?: string
    payload: Record<string, unknown>
  },
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post('/api/v1/work/templates', input, idResultSchema, csrfToken)
}

export async function patchWorkTemplate(
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    scope: 'department' | 'personal'
    payload: Record<string, unknown>
  }>,
  csrfToken: string,
): Promise<void> {
  await apiClient.patch(
    `/api/v1/work/templates/${encodeURIComponent(id)}`,
    patch,
    z.void(),
    csrfToken,
  )
}

export async function deleteWorkTemplate(id: string, csrfToken: string): Promise<void> {
  await apiClient.delete(`/api/v1/work/templates/${encodeURIComponent(id)}`, csrfToken)
}

export function createCardFromTemplate(
  id: string,
  input: {
    assigneeUserId?: string | null
    giverUserId?: string | null
    projectId?: string | null
    dueAt?: string | null
  },
  csrfToken: string,
): Promise<{ id: string }> {
  return apiClient.post(
    `/api/v1/work/templates/${encodeURIComponent(id)}/create-card`,
    input,
    idResultSchema,
    csrfToken,
  )
}

// --- A9 the focus list ("Diqqat markazi") ----------------------------------------------------------

export const focusPinSchema = z.object({
  cardId: z.string(),
  position: z.number().int(),
  card: cardRefSchema,
})
export type FocusPin = z.infer<typeof focusPinSchema>

export const focusListSchema = z.object({
  items: z.array(focusPinSchema),
  /** Five is the ceiling; it arrives from the server so the copy that explains a refused sixth pin
   * and the rule that refuses it are the same number. */
  max: z.number().int(),
})
export type FocusList = z.infer<typeof focusListSchema>

export function fetchFocusList(): Promise<FocusList> {
  return apiClient.get('/api/v1/work/focus', focusListSchema)
}

export async function addFocusPin(cardId: string, csrfToken: string): Promise<void> {
  await apiClient.post('/api/v1/work/focus', { cardId }, z.void(), csrfToken)
}

export async function removeFocusPin(cardId: string, csrfToken: string): Promise<void> {
  await apiClient.delete(`/api/v1/work/focus/${encodeURIComponent(cardId)}`, csrfToken)
}

export async function reorderFocusList(cardIds: string[], csrfToken: string): Promise<void> {
  await apiClient.post('/api/v1/work/focus/reorder', { cardIds }, z.void(), csrfToken)
}

// --- A4 capacity and the workload grid -------------------------------------------------------------

export const capacityRowSchema = z.object({
  userId: z.string(),
  weeklyHours: z.number(),
  isDefault: z.boolean(),
})
export type CapacityRow = z.infer<typeof capacityRowSchema>
export const capacityListSchema = z.array(capacityRowSchema)

export function fetchCapacity(): Promise<CapacityRow[]> {
  return apiClient.get('/api/v1/work/capacity', capacityListSchema)
}

export async function putCapacity(
  userId: string,
  weeklyHours: number,
  csrfToken: string,
): Promise<void> {
  await apiClient.put(
    `/api/v1/work/capacity/${encodeURIComponent(userId)}`,
    { weeklyHours },
    z.void(),
    csrfToken,
  )
}

export const workloadCellSchema = z.object({
  weekStart: z.string(),
  estimateHours: z.number(),
  cardCount: z.number().int(),
  overdueCount: z.number().int(),
})
export type WorkloadCell = z.infer<typeof workloadCellSchema>

export const workloadRowSchema = z.object({
  member: memberSummarySchema,
  capacityHours: z.number(),
  cells: z.array(workloadCellSchema),
})
export type WorkloadRow = z.infer<typeof workloadRowSchema>

export const workloadSchema = z.object({
  weekStarts: z.array(z.string()),
  rows: z.array(workloadRowSchema),
  /** A4's "Hisobga olinmagan" panel: the two ways a workload grid quietly lies -- open cards with
   * no due date (they land in no week) and open cards with no estimate (they add nothing to any
   * bar). */
  unscheduled: z.object({
    noDueDate: z.number().int(),
    noEstimate: z.number().int(),
    /** v1.1 critique SEV2 #3: every open card in the department, so the grid can tell honestly how
     * much of the work its estimate-based colouring covers -- and fall back to counting cards when
     * the answer is "less than half". */
    openTotal: z.number().int(),
  }),
})
export type Workload = z.infer<typeof workloadSchema>

export type WorkloadQuery = { weeks?: number; start?: string; userId?: string }

function workloadSearch(query: WorkloadQuery): string {
  const params = new URLSearchParams()
  if (query.weeks) params.set('weeks', String(query.weeks))
  if (query.start) params.set('start', query.start)
  if (query.userId) params.set('userId', query.userId)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function fetchWorkload(query: WorkloadQuery = {}): Promise<Workload> {
  return apiClient.get(`/api/v1/work/workload${workloadSearch(query)}`, workloadSchema)
}

/** SPEC §2.2: the grid is head-only, but a member gets their own row through the same service --
 * this is that call, and the server refuses any other user id for a member. */
export function fetchMyWorkload(query: WorkloadQuery = {}): Promise<Workload> {
  return apiClient.get(`/api/v1/work/workload/mine${workloadSearch(query)}`, workloadSchema)
}

export async function moveWorkloadCard(
  input: { cardId: string; toUserId: string | null; toWeekStart: string },
  csrfToken: string,
): Promise<void> {
  await apiClient.post('/api/v1/work/workload/move', input, z.void(), csrfToken)
}

// --- A11 department goals ---------------------------------------------------------------------------

export const goalSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  metric: goalMetricSchema,
  filter: z.string(),
  targetValue: z.number(),
  startsOn: z.string().nullable(),
  dueOn: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
  currentValue: z.number(),
  progress: z.number(),
  matchedCards: z.number().int(),
})
export type Goal = z.infer<typeof goalSchema>
export const goalListSchema = z.array(goalSchema)

export function fetchGoals(): Promise<Goal[]> {
  return apiClient.get('/api/v1/goals', goalListSchema)
}

export type CreateGoalInput = {
  title: string
  description?: string
  metric: z.infer<typeof goalMetricSchema>
  filter?: string
  targetValue: number
  startsOn?: string | null
  dueOn?: string | null
}

export function createGoal(input: CreateGoalInput, csrfToken: string): Promise<{ id: string }> {
  return apiClient.post('/api/v1/goals', input, idResultSchema, csrfToken)
}

/** v1.1 critique SEV2 #8 -- editing a goal, which the product could not do at all. Mirrors the
 * server's own `patchGoalBodySchema`, which is deliberately *wider* than `CreateGoalInput`:
 * `description` and `dueOn` are nullable on a patch, because clearing a description is a real edit
 * and `undefined` would mean "leave it alone". `filter` is a string there, so an emptied filter is
 * sent as `''` -- "count every card" -- rather than as `null`. */
export type PatchGoalInput = {
  title?: string
  description?: string | null
  metric?: z.infer<typeof goalMetricSchema>
  filter?: string
  targetValue?: number
  startsOn?: string | null
  dueOn?: string | null
  archived?: boolean
  version?: number
}

export async function patchGoal(
  id: string,
  patch: PatchGoalInput,
  csrfToken: string,
): Promise<void> {
  await apiClient.patch(`/api/v1/goals/${encodeURIComponent(id)}`, patch, z.void(), csrfToken)
}

export async function deleteGoal(id: string, csrfToken: string): Promise<void> {
  await apiClient.delete(`/api/v1/goals/${encodeURIComponent(id)}`, csrfToken)
}

// --- A7 recurrence (the rule itself lives in `@devon/contracts`) --------------------------------------

export { recurrenceRuleSchema }
export type RecurrenceRuleValue = z.infer<typeof recurrenceRuleSchema>
