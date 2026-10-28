import { z } from 'zod'
export const personalOverviewSchema = z.object({
  openCount: z.number(),
  toDoCount: z.number().int().optional(),
  inProgressCount: z.number().int().optional(),
  doneCount: z.number().int().optional(),
  archivedCount: z.number().int().optional(),
  overdueCount: z.number(),
  doneThisWeek: z.number(),
  onTimeRate: z.number().nullable(),
  upcomingEventCount: z.number(),
  givenOverdueCount: z.number(),
})
export type PersonalOverview = z.infer<typeof personalOverviewSchema>
