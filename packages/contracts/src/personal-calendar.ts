import { z } from 'zod'

export const personalCalendarBodySchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    notes: z.string().max(4000).default(''),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    allDay: z.boolean().default(false),
    remindAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict()
  .refine((v) => Date.parse(v.endsAt) >= Date.parse(v.startsAt), {
    path: ['endsAt'],
    message: 'End must follow start',
  })
  .refine((v) => v.remindAt === null || Date.parse(v.remindAt) <= Date.parse(v.startsAt), {
    path: ['remindAt'],
    message: 'Reminder must be at or before start',
  })
export const personalCalendarUpdateSchema = z
  .object({ version: z.number().int().positive(), entry: personalCalendarBodySchema })
  .strict()
export const personalCalendarItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['personal', 'task', 'event']),
  title: z.string(),
  notes: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean(),
  remindAt: z.string().nullable(),
  version: z.number().int(),
  status: z.string(),
  href: z.string().nullable(),
})
export const personalCalendarQuerySchema = z
  .object({ from: z.string().date(), to: z.string().date() })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 93 * 86400000,
    'Choose a range of at most 93 days',
  )
export const personalCalendarListSchema = z.array(personalCalendarItemSchema)
export type PersonalCalendarInput = z.infer<typeof personalCalendarBodySchema>
export type PersonalCalendarItem = z.infer<typeof personalCalendarItemSchema>
