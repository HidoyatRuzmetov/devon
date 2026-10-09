// Client-side mirror of `apps/api/src/modules/analytics/schemas.ts` (same convention as
// `src/lib/api-schemas.ts` mirroring the foundation's `apps/api/src/schemas.ts`): the two packages
// never share a schema file, so each side validates the wire shape it actually expects.
import { z } from 'zod'

export const ANALYTICS_CHART_KEYS = [
  'throughput',
  'onTimeRate',
  'openVsOverdue',
  'loadPerPerson',
  'loadPerUnit',
  'projectProgress',
  'eventsParticipation',
  'pollTurnout',
  'personal',
] as const
export const analyticsChartKeySchema = z.enum(ANALYTICS_CHART_KEYS)
export type AnalyticsChartKey = (typeof ANALYTICS_CHART_KEYS)[number]

const weekPointSchema = z.object({ weekStart: z.string(), count: z.number() })
export type WeekPoint = z.infer<typeof weekPointSchema>

const onTimePointSchema = z.object({
  weekStart: z.string(),
  dueCount: z.number(),
  onTimeCount: z.number(),
})
export type OnTimePoint = z.infer<typeof onTimePointSchema>

const openOverduePointSchema = z.object({
  weekStart: z.string(),
  openCount: z.number(),
  overdueCount: z.number(),
})
export type OpenOverduePoint = z.infer<typeof openOverduePointSchema>

const personLoadSchema = z.object({
  userId: z.string(),
  name: z.string(),
  openCount: z.number(),
  overdueCount: z.number(),
})
export type PersonLoad = z.infer<typeof personLoadSchema>

const unitLoadSchema = z.object({
  scope: z.enum(['department', 'unit', 'unassigned']),
  unitId: z.string().nullable(),
  unitName: z.string().nullable(),
  openCount: z.number(),
  overdueCount: z.number(),
})
export type UnitLoad = z.infer<typeof unitLoadSchema>

const projectProgressSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  totalTasks: z.number(),
  doneTasks: z.number(),
  progress: z.number(),
})
export type ProjectProgress = z.infer<typeof projectProgressSchema>

const eventParticipationSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  yes: z.number(),
  no: z.number(),
  maybe: z.number(),
  waitlist: z.number(),
  rsvpRate: z.number(),
})
export type EventParticipation = z.infer<typeof eventParticipationSchema>

const pollTurnoutSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.string(),
  voters: z.number(),
  turnoutRate: z.number(),
})
export type PollTurnout = z.infer<typeof pollTurnoutSchema>

export const personalOverviewSchema = z.object({
  openCount: z.number(),
  overdueCount: z.number(),
  doneThisWeek: z.number(),
  onTimeRate: z.number().nullable(),
  focusMinutesThisWeek: z.number(),
  upcomingEventCount: z.number(),
  givenOverdueCount: z.number(),
})
export type PersonalOverview = z.infer<typeof personalOverviewSchema>

export const analyticsSummarySchema = z.object({
  since: z.string(),
  until: z.string(),
  throughput: z.array(weekPointSchema),
  onTimeRate: z.object({ overall: z.number().nullable(), series: z.array(onTimePointSchema) }),
  openVsOverdue: z.array(openOverduePointSchema),
  loadPerPerson: z.array(personLoadSchema),
  loadPerUnit: z.array(unitLoadSchema),
  projectProgress: z.array(projectProgressSchema),
  eventsParticipation: z.array(eventParticipationSchema),
  pollTurnout: z.array(pollTurnoutSchema),
  personal: personalOverviewSchema,
})
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>

export const savedFilterSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  sinceDays: z.number(),
  shared: z.boolean(),
  ownerUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type SavedFilter = z.infer<typeof savedFilterSchema>
export const savedFilterListSchema = z.array(savedFilterSchema)

export type CreateSavedFilterInput = {
  name: string
  query: string
  sinceDays: number
  shared?: boolean
}
export type PatchSavedFilterInput = {
  name?: string
  query?: string
  sinceDays?: number
  shared?: boolean
  version: number
}

export const pinnedChartSchema = z.object({
  id: z.string(),
  chartKey: analyticsChartKeySchema,
  title: z.string(),
  filterQuery: z.string(),
  sort: z.number(),
  createdAt: z.string(),
})
export type PinnedChart = z.infer<typeof pinnedChartSchema>
export const pinnedChartListSchema = z.array(pinnedChartSchema)

export type CreatePinInput = { chartKey: AnalyticsChartKey; title: string; filterQuery?: string }

export type SummaryQuery = { filter?: string; since?: string; until?: string }
