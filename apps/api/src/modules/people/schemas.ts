// Zod schemas for the people module. The indicator *registry* itself lives in `@devon/contracts`
// (`packages/contracts/src/indicators.ts`) so the client, the server and any future consumer (the
// Telegram Mini App's person card) share one list; this file only describes how it crosses the wire.
import { z } from 'zod'
import {
  INDICATORS,
  PEOPLE_VIEW_CAPS,
  peopleViewConfigSchema,
  peopleViewSchema,
} from '@devon/contracts'

export const indicatorsQuerySchema = z.object({
  /** Comma-separated user ids. Omitted = every active member of the department. */
  ids: z.string().max(4000).optional(),
  /** Comma-separated indicator keys. Omitted = the whole registry. Unknown keys are ignored rather
   * than rejected, so an older client asking for a key a newer server renamed still gets a table. */
  keys: z.string().max(2000).optional(),
})

const indicatorValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])

export const personIndicatorsSchema = z.object({
  userId: z.string().uuid(),
  values: z.record(z.string(), indicatorValueSchema),
})

export const indicatorsResponseSchema = z.object({
  people: z.array(personIndicatorsSchema),
  /** The weekly capacity `workloadPct` was measured against, so the UI can say "5 / 8" rather than
   * only "62%" (SPEC §7 A4 replaces this with real per-person capacity). */
  capacityCards: z.number().int().positive(),
})

export const indicatorSpecSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  descriptionKey: z.string(),
  type: z.enum(['count', 'percent', 'duration', 'date', 'text', 'enum', 'list']),
  format: z.enum([
    'number',
    'percent',
    'hours',
    'minutes',
    'date',
    'relativeDate',
    'text',
    'chips',
    'boolean',
  ]),
  headOnly: z.boolean(),
  source: z.enum([
    'cards',
    'projects',
    'events',
    'personal_aggregate',
    'onboarding',
    'activity',
    'membership',
  ]),
  calculations: z.array(z.enum(['count', 'filled', 'avg', 'sum', 'min', 'max'])),
  defaultColumn: z.boolean(),
  polarity: z.enum(['higher_better', 'lower_better']).nullable(),
})

export const registryResponseSchema = z.object({
  indicators: z.array(indicatorSpecSchema),
})

/** The registry, flattened for the wire (`defaultColumn` defaults to false rather than being
 * optional, so the client renders one shape). */
export const INDICATOR_REGISTRY_DTO = INDICATORS.map((indicator) => ({
  ...indicator,
  calculations: [...indicator.calculations],
  defaultColumn: indicator.defaultColumn ?? false,
}))

// -- Saved views (SPEC §4.3) -----------------------------------------------------------------------

export const peopleViewDtoSchema = peopleViewSchema

export const peopleViewListSchema = z.object({ views: z.array(peopleViewDtoSchema) })

export const createPeopleViewBodySchema = z.object({
  name: z.string().trim().min(1).max(PEOPLE_VIEW_CAPS.nameMaxLength),
  config: peopleViewConfigSchema,
  shared: z.boolean().default(false),
  makeDepartmentDefault: z.boolean().default(false),
})

export const patchPeopleViewBodySchema = z
  .object({
    name: z.string().trim().min(1).max(PEOPLE_VIEW_CAPS.nameMaxLength).optional(),
    config: peopleViewConfigSchema.optional(),
    shared: z.boolean().optional(),
    makeDepartmentDefault: z.boolean().optional(),
    version: z.number().int(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: 'empty patch' })

export const viewIdParamsSchema = z.object({ id: z.string().uuid() })

// -- Person page (SPEC §6) -------------------------------------------------------------------------

/** `me` resolves to the caller -- the one path a member may ever open (SPEC §6). Any other value is
 * a user id, and the route's subject is head-only. */
export const personParamsSchema = z.object({
  userId: z.union([z.literal('me'), z.string().uuid()]),
})

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

export const personHeaderSchema = z.object({
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
})

export const personOverviewSchema = z.object({
  header: personHeaderSchema,
  /** Which indicator keys the *viewer* is allowed to read for this person, already filtered. */
  indicators: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  capacityCards: z.number().int().positive(),
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
  /** Echoed back so the client never has to guess whether to draw the head-only actions (the same
   * `canEdit`/`canManage` convention every other DTO uses). */
  canManage: z.boolean(),
})

export const personCardsQuerySchema = z.object({
  role: z.enum(['assignee', 'giver']).default('assignee'),
  status: z.enum(['active', 'done', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export const personCardsSchema = z.object({ cards: z.array(personCardSchema) })

export const personActivitySchema = z.object({
  entries: z.array(
    z.object({
      at: z.string(),
      kind: z.string(),
      cardId: z.string().nullable(),
      cardTitle: z.string().nullable(),
      eventId: z.string().nullable(),
      eventTitle: z.string().nullable(),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
})

export const exportQuerySchema = z.object({
  /** Comma-separated indicator keys, in the head's column order. Unknown keys are dropped. */
  keys: z.string().max(2000).optional(),
  /** Comma-separated user ids -- an export of the current selection rather than everyone. */
  ids: z.string().max(4000).optional(),
})

/** SPEC §4.3 row action "message via Telegram deep link". Head-only, batched for the whole cohort. */
export const contactsQuerySchema = z.object({
  /** Comma-separated user ids. Omitted = every active member of the department. */
  ids: z.string().max(4000).optional(),
})

export const contactsResponseSchema = z.object({
  contacts: z.array(
    z.object({
      userId: z.string(),
      telegramDeepLink: z.string().nullable(),
    }),
  ),
})
