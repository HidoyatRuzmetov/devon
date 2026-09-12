// Zod schemas for the people module. The indicator *registry* itself lives in `@devon/contracts`
// (`packages/contracts/src/indicators.ts`) so the client, the server and any future consumer (the
// Telegram Mini App's person card) share one list; this file only describes how it crosses the wire.
import { z } from 'zod'
import { INDICATORS } from '@devon/contracts'

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

export const registryResponseSchema = z.object({ indicators: z.array(indicatorSpecSchema) })

/** The registry, flattened for the wire (`defaultColumn` defaults to false rather than being
 * optional, so the client renders one shape). */
export const INDICATOR_REGISTRY_DTO = INDICATORS.map((indicator) => ({
  ...indicator,
  calculations: [...indicator.calculations],
  defaultColumn: indicator.defaultColumn ?? false,
}))
