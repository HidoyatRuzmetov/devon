// Zod schemas for the work module's DTOs (TECH-SPEC §3.2/§4, EPIC-004). Kept in this module's own
// file -- `apps/api/src/schemas.ts` is the foundation module's file, never edited to add a module
// (MODULE-GUIDE.md "API modules").
import { z } from 'zod'
import { MAX_ESTIMATE_MINUTES, recurrenceRuleSchema } from '@devon/contracts'
import { validOrderKey } from './ordering.js'

const orderKeySchema = z.string().max(100).refine(validOrderKey, 'invalid order key')

export const cardKindSchema = z.enum(['task', 'project_task'])
export const cardStatusSchema = z.enum(['active', 'done', 'archived'])
export const cardPrioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent'])
export const cardProjectScopeSchema = z.enum(['none', 'objective', 'subjective'])
export const cardRiskSchema = z.enum(['none', 'at_risk', 'overdue'])

export const descriptionSchema = z
  .object({ format: z.literal('markdown'), text: z.string().max(20000) })
  .nullable()

export const linkSchema = z.object({
  url: z.string().url(),
  title: z.string().max(300),
  favicon: z.string().url().nullable(),
})

export const memberSummarySchema = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  role: z.enum(['head', 'member']),
  // v1.1 SPEC §3.3: the board groups its columns by bo'lim, so each column has to know which one
  // its person belongs to. `null` = not assigned to a unit yet, which renders as its own trailing
  // section rather than being hidden.
  unitId: z.string().uuid().nullable(),
  unitName: z.string().nullable(),
})
export type MemberSummary = z.infer<typeof memberSummarySchema>

export const cardSchema = z.object({
  id: z.string().uuid(),
  kind: cardKindSchema,
  title: z.string(),
  description: descriptionSchema,
  assigneeUserId: z.string().uuid().nullable(),
  giverUserId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  projectScope: cardProjectScopeSchema,
  status: cardStatusSchema,
  priority: cardPrioritySchema,
  risk: cardRiskSchema,
  startAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  orderKey: z.string(),
  labels: z.array(z.string().uuid()),
  watchers: z.array(z.string().uuid()),
  links: z.array(linkSchema),
  checklistTotal: z.number().int(),
  checklistDone: z.number().int(),
  commentCount: z.number().int(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
  /** v1.1 SPEC §2.1 (PERMISSIONS-AUDIT Step 5, modelled on the events module's `canManage`): may THIS
   * viewer edit, move, reassign, archive, restore, re-checklist or add a watcher to this card? True
   * for the card's giver, assignee and creator, and for the boshqarma boshlig'i. Server-computed so
   * the client never guesses a permission -- optional only so a client built before this field
   * existed still parses the payload. */
  canEdit: z.boolean().optional(),

  // --- v1.1 SPEC §7 (work-plus). Every one of these is computed in the same query that loads the
  // card (`CARD_SELECT`'s lateral joins), never in a per-card follow-up (I-14). All optional so a
  // client built before v1.1 still parses the payload unchanged.

  /** A3: the estimate, in minutes. `null` = nobody has estimated this card. */
  estimateMin: z.number().int().nullable().optional(),
  /** A3: minutes logged against the card by everybody, summed. */
  loggedMin: z.number().int().optional(),
  /** A10: how many of the cards this one waits for are still open. `> 0` is what paints the
   * "Bloklangan" chip on the tile, in the table and on the Gantt bar. */
  blockedByOpenCount: z.number().int().optional(),
  /** A10: how many cards wait for this one -- the other half of the chip's tooltip. */
  blocksCount: z.number().int().optional(),
  /** A7: the repeat rule, when this card is the head of a recurring series. */
  recurrence: recurrenceRuleSchema.nullable().optional(),
  /** A7: the series this instance belongs to (its own id for the first card). */
  recurrenceSeriesId: z.string().uuid().nullable().optional(),
  /** A9: true when the viewer has this card in their own focus list ("Diqqat markazi"). Viewer-
   * specific by design -- a focus list is personal, and nobody else's pin ever shows here. */
  focusPinned: z.boolean().optional(),
  focusPosition: z.number().int().nullable().optional(),
  /** Board-only review state; original assignee id stays intact for history and ownership. */
  assigneeUnavailable: z.boolean().optional(),
})
export type CardDTO = z.infer<typeof cardSchema>

export const checklistItemSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  parentItemId: z.string().uuid().nullable(),
  text: z.string(),
  doneAt: z.string().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
  dueAt: z.string().nullable(),
  orderKey: z.string(),
  version: z.number().int(),
})

export const commentSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  authorUserId: z.string().uuid(),
  body: z.object({ format: z.literal('markdown'), text: z.string() }),
  mentions: z.array(z.string().uuid()),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const activitySchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
  at: z.string(),
})

export const cardDetailSchema = cardSchema.extend({
  checklist: z.array(checklistItemSchema),
  comments: z.array(commentSchema),
  activity: z.array(activitySchema),
})

export const cardListSchema = z.object({
  items: z.array(cardSchema),
  nextCursor: z.string().nullable(),
})

export const boardColumnSchema = z.object({
  member: memberSummarySchema,
  cards: z.array(cardSchema),
})

export const boardSchema = z.object({
  members: z.array(memberSummarySchema),
  columns: z.array(boardColumnSchema),
  unassigned: z.array(cardSchema),
  labels: z.array(z.object({ id: z.string().uuid(), name: z.string(), colour: z.string() })),
})

export const createCardBodySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(20000).optional(),
  kind: cardKindSchema.optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  giverUserId: z.string().uuid().nullable().optional(),
  priority: cardPrioritySchema.optional(),
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  labels: z.array(z.string().uuid()).optional(),
  links: z.array(linkSchema).optional(),
  projectId: z.string().uuid().nullable().optional(),
  projectScope: cardProjectScopeSchema.optional(),
  orderKey: orderKeySchema.optional(),
  /** A3: quick-add and the composer both accept an estimate up front -- a card estimated when it is
   * created is the only kind that reliably gets estimated at all. */
  estimateMin: z.number().int().min(1).max(MAX_ESTIMATE_MINUTES).nullable().optional(),
  /** A7: create the card already repeating. */
  recurrence: recurrenceRuleSchema.nullable().optional(),
})

export const patchCardBodySchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(20000).nullable(),
    assigneeUserId: z.string().uuid().nullable(),
    giverUserId: z.string().uuid().nullable(),
    priority: cardPrioritySchema,
    status: cardStatusSchema,
    startAt: z.string().datetime().nullable(),
    dueAt: z.string().datetime().nullable(),
    labels: z.array(z.string().uuid()),
    links: z.array(linkSchema),
    watchers: z.array(z.string().uuid()),
    orderKey: orderKeySchema,
    version: z.number().int(),
    /** A3 / A7: `null` clears the estimate, `null` stops the series (already-created instances
     * stay -- stopping a repeat never retroactively removes work somebody has started). */
    estimateMin: z.number().int().min(1).max(MAX_ESTIMATE_MINUTES).nullable(),
    recurrence: recurrenceRuleSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' })

export const cardListQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  q: z.string().max(500).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  mine: z.coerce.boolean().optional(),
})

export const moveCardBodySchema = z.object({
  toUserId: z.string().uuid().nullable(),
  targetCardId: z.string().uuid().nullable(),
  edge: z.enum(['before', 'after']),
})

export const createChecklistItemBodySchema = z.object({
  text: z.string().min(1).max(500),
  parentItemId: z.string().uuid().nullable().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  orderKey: z.string().optional(),
})

export const patchChecklistItemBodySchema = z
  .object({
    text: z.string().min(1).max(500),
    done: z.boolean(),
    assigneeUserId: z.string().uuid().nullable(),
    dueAt: z.string().datetime().nullable(),
    orderKey: z.string(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' })

export const createCommentBodySchema = z.object({
  text: z.string().min(1).max(10000),
  mentions: z.array(z.string().uuid()).optional(),
})

export const labelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  colour: z.string(),
})
export const labelListSchema = z.array(labelSchema)
export const createLabelBodySchema = z.object({
  name: z.string().min(1).max(60),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
})

export const savedViewLayoutSchema = z.enum([
  'people_board',
  'table',
  'timeline',
  'calendar',
  'mine',
])
export type SavedViewLayout = z.infer<typeof savedViewLayoutSchema>

export const savedViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  filter: z.string(),
  layout: savedViewLayoutSchema,
  shared: z.boolean(),
  ownerUserId: z.string().uuid(),
})
export const savedViewListSchema = z.array(savedViewSchema)
export const createSavedViewBodySchema = z.object({
  name: z.string().min(1).max(120),
  filter: z.string().max(1000),
  layout: z.enum(['people_board', 'table', 'timeline', 'calendar', 'mine']),
  shared: z.boolean().optional(),
})
export const patchSavedViewBodySchema = createSavedViewBodySchema.partial()

export const archiveListSchema = z.object({
  member: memberSummarySchema,
  items: z.array(cardSchema),
})

export const unfurlBodySchema = z.object({ url: z.string().url() })
export const unfurlResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  favicon: z.string().nullable(),
})

export const idParamsSchema = z.object({ id: z.string().uuid() })
export const cardChecklistParamsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
})

export type BoardDTO = z.infer<typeof boardSchema>
