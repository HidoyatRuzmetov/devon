// Zod primitives shared across `src/prompts/*.ts` -- kept in one place so, e.g., every feature's
// `locale` field is the exact same schema rather than ten hand-copied `z.enum([...])`s that could
// silently drift apart.
import { z } from 'zod'

export const localeSchema = z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en'])

export const cardPrioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent'])

/** A short, human-scannable id-carrying reference -- the shape every citation-bearing feature
 * (weekly summary, thread summary, what-did-I-miss) takes its input items as, so "cite the cards/
 * events they used" (TECH-SPEC §8 guard rail) is mechanical: the tool's output can only ever name an
 * id that was present in the input, and the caller can verify that after the fact. */
export const idTitleSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
})
