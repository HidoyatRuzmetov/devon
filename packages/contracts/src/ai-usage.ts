import { z } from 'zod'

export const aiUsageDaySchema = z.iso.date().refine((day) => !day.startsWith('0000-'))
export const aiUsageMonthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u)
const usage = z.object({
  tokens: z.number().int().nonnegative(),
  costUzs: z.number().nonnegative(),
  runs: z.number().int().nonnegative(),
})

export const adminAiUsageSchema = z.object({
  today: aiUsageDaySchema,
  departments: z.array(z.object({ id: z.uuid(), name: z.string() })),
  days: z.array(usage.extend({ day: aiUsageDaySchema, departmentId: z.uuid() })),
})
export const adminAiUsageHoursSchema = z.object({
  day: aiUsageDaySchema,
  hours: z.array(usage.extend({ hour: z.number().int().min(0).max(23), departmentId: z.uuid() })),
})
export const departmentAiUsageSummarySchema = z.object({
  today: aiUsageDaySchema,
  month: aiUsageMonthSchema,
  firstMonth: aiUsageMonthSchema.nullable(),
  monthly: usage,
  allTime: usage,
})
export type AdminAiUsage = z.infer<typeof adminAiUsageSchema>
export type AdminAiUsageHours = z.infer<typeof adminAiUsageHoursSchema>
export type DepartmentAiUsageSummary = z.infer<typeof departmentAiUsageSummarySchema>
