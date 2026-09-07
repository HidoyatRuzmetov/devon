// Zod schemas for the analytics module (TECH-SPEC §9), module-owned per MODULE-GUIDE.md -- never
// added to the shared `apps/api/src/schemas.ts`.
import { z } from 'zod'

const idSchema = z.string().uuid()
const isoDateTime = z.iso.datetime({ offset: true })
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Every chart this page renders, in the order TECH-SPEC §9 lists them -- shared between "pin to
 * Home" (`analytics_pinned_charts.chart_key`) and the summary response's section keys, so a pin can
 * always find the section it was pinned from. */
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

export const summaryQuerySchema = z.object({
  filter: z.string().max(500).optional(),
  since: isoDate.optional(),
  until: isoDate.optional(),
})
export type SummaryQuery = z.infer<typeof summaryQuerySchema>

const weekPointSchema = z.object({ weekStart: isoDate, count: z.number().int() })
const onTimePointSchema = z.object({
  weekStart: isoDate,
  dueCount: z.number().int(),
  onTimeCount: z.number().int(),
})
const openOverduePointSchema = z.object({
  weekStart: isoDate,
  openCount: z.number().int(),
  overdueCount: z.number().int(),
})
const personLoadSchema = z.object({
  userId: idSchema,
  name: z.string(),
  openCount: z.number().int(),
  overdueCount: z.number().int(),
})
const unitLoadSchema = z.object({
  unitName: z.string().nullable(),
  openCount: z.number().int(),
  overdueCount: z.number().int(),
})
const projectProgressSchema = z.object({
  id: idSchema,
  title: z.string(),
  status: z.string(),
  totalTasks: z.number().int(),
  doneTasks: z.number().int(),
  progress: z.number().min(0).max(1),
})
const eventParticipationSchema = z.object({
  id: idSchema,
  title: z.string(),
  startsAt: isoDateTime,
  yes: z.number().int(),
  no: z.number().int(),
  maybe: z.number().int(),
  waitlist: z.number().int(),
  rsvpRate: z.number().min(0).max(1),
})
const pollTurnoutSchema = z.object({
  id: idSchema,
  question: z.string(),
  status: z.string(),
  voters: z.number().int(),
  turnoutRate: z.number().min(0).max(1),
})
const personalOverviewSchema = z.object({
  openCount: z.number().int(),
  overdueCount: z.number().int(),
  doneThisWeek: z.number().int(),
  onTimeRate: z.number().min(0).max(1).nullable(),
  focusMinutesThisWeek: z.number(),
  upcomingEventCount: z.number().int(),
})
export type PersonalOverviewDto = z.infer<typeof personalOverviewSchema>

export const analyticsSummarySchema = z.object({
  since: isoDate,
  until: isoDate,
  throughput: z.array(weekPointSchema),
  onTimeRate: z.object({
    overall: z.number().min(0).max(1).nullable(),
    series: z.array(onTimePointSchema),
  }),
  openVsOverdue: z.array(openOverduePointSchema),
  loadPerPerson: z.array(personLoadSchema),
  loadPerUnit: z.array(unitLoadSchema),
  projectProgress: z.array(projectProgressSchema),
  eventsParticipation: z.array(eventParticipationSchema),
  pollTurnout: z.array(pollTurnoutSchema),
  personal: personalOverviewSchema,
})
export type AnalyticsSummaryDto = z.infer<typeof analyticsSummarySchema>

// -- Saved filters ------------------------------------------------------------------------------------

export const savedFilterSchema = z.object({
  id: idSchema,
  name: z.string(),
  query: z.string(),
  sinceDays: z.number().int(),
  shared: z.boolean(),
  ownerUserId: idSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
})
export type SavedFilterDto = z.infer<typeof savedFilterSchema>
export const savedFilterListSchema = z.array(savedFilterSchema)

export const createSavedFilterBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  query: z.string().max(500).default(''),
  sinceDays: z.number().int().min(1).max(3650).default(84),
  shared: z.boolean().optional(),
})

export const patchSavedFilterBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  query: z.string().max(500).optional(),
  sinceDays: z.number().int().min(1).max(3650).optional(),
  shared: z.boolean().optional(),
  version: z.number().int(),
})

// -- Pinned charts -------------------------------------------------------------------------------------

export const pinnedChartSchema = z.object({
  id: idSchema,
  chartKey: analyticsChartKeySchema,
  title: z.string(),
  filterQuery: z.string(),
  sort: z.number().int(),
  createdAt: isoDateTime,
})
export type PinnedChartDto = z.infer<typeof pinnedChartSchema>
export const pinnedChartListSchema = z.array(pinnedChartSchema)

export const createPinBodySchema = z.object({
  chartKey: analyticsChartKeySchema,
  title: z.string().trim().min(1).max(200),
  filterQuery: z.string().max(500).optional(),
})

export const reorderPinsBodySchema = z.object({
  ids: z.array(idSchema).min(1).max(50),
})
