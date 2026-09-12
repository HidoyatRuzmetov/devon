// Typed endpoint functions for `/api/v1/people/*` (MODULE-GUIDE.md "Web features"). This feature's
// own copy of `apps/api/src/modules/people/schemas.ts`'s shapes, validated at the fetch boundary --
// the same "no shared DTO package" tradeoff every other feature's `api.ts` documents.
//
// The indicator *registry* is NOT copied: it lives in `@devon/contracts` and both sides import it,
// because a label key or a format that drifted between client and server would show the head a
// number with the wrong unit -- the one kind of bug a management dashboard must never have.
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'

const indicatorValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])

export const personIndicatorsSchema = z.object({
  userId: z.string(),
  values: z.record(z.string(), indicatorValueSchema),
})
export type PersonIndicators = z.infer<typeof personIndicatorsSchema>

export const indicatorsResponseSchema = z.object({
  people: z.array(personIndicatorsSchema),
  capacityCards: z.number(),
})
export type IndicatorsResponse = z.infer<typeof indicatorsResponseSchema>

/** `keys` narrows the request to the columns actually on screen, so a three-column table costs three
 * aggregate queries instead of twelve (the server skips any source nobody asked for). */
export function fetchIndicators(keys: readonly string[]): Promise<IndicatorsResponse> {
  const query = keys.length > 0 ? `?keys=${encodeURIComponent(keys.join(','))}` : ''
  return apiClient.get(`/api/v1/people/indicators${query}`, indicatorsResponseSchema)
}
