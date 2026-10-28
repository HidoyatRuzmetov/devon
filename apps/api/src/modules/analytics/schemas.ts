import { z } from 'zod'
export const personalOverviewSchema = z.object({
  openCount: z.number().int(),
  toDoCount: z.number().int(),
  inProgressCount: z.number().int(),
  doneCount: z.number().int(),
  archivedCount: z.number().int(),
  overdueCount: z.number().int(),
  doneThisWeek: z.number().int(),
  onTimeRate: z.number().min(0).max(1).nullable(),
  upcomingEventCount: z.number().int(),
  // Home's "needs my decision" answer (TECH-SPEC §9/§5): cards this viewer *gave out* (they are the
  // giver, not the assignee) that are now overdue -- the giver is the one who can reassign, extend, or
  // escalate, so this is deliberately a different count than `overdueCount` above (the viewer's own
  // overdue work as an assignee).
  givenOverdueCount: z.number().int(),
})
