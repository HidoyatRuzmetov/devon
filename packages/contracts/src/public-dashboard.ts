import { z } from 'zod'

export const dashboardLinkSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .strict()
export const publicDashboardSchema = z
  .object({
    department: z.string(),
    updatedAt: z.string(),
    truncated: z.boolean(),
    members: z.array(
      z
        .object({
          key: z.string(),
          name: z.string(),
          head: z.boolean(),
          colour: z.enum([
            'primary',
            'muted-foreground',
            'unit-1',
            'unit-2',
            'unit-3',
            'unit-4',
            'unit-5',
            'unit-6',
            'unit-7',
            'unit-8',
          ]),
        })
        .strict(),
    ),
    cards: z.array(
      z
        .object({
          key: z.string(),
          title: z.string(),
          stage: z.enum(['todo', 'in_progress']),
          assigneeKey: z.string().nullable(),
        })
        .strict(),
    ),
    units: z.array(
      z
        .object({
          key: z.string(),
          name: z.string(),
          parentKey: z.string().nullable(),
          colour: z.number().int().min(1).max(8),
          people: z.array(
            z
              .object({ memberKey: z.string(), role: z.enum(['head', 'deputy', 'member']) })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
export type PublicDashboard = z.infer<typeof publicDashboardSchema>
