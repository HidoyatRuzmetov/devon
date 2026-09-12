// Zod primitives shared across `src/prompts/*.ts` -- kept in one place so, e.g., every feature's
// `locale` field is the exact same schema rather than fourteen hand-copied `z.enum([...])`s that
// could silently drift apart.
import { z } from 'zod'

export const localeSchema = z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en'])

export const cardPrioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent'])

/** The deterministic risk level `apps/api/src/modules/work/repo.ts`'s `computeRisk()` already
 * decides. v1.1 demotes `deadline_risk` from a second classifier to an explainer of this one
 * (AI-AUDIT D-4): two sources of truth for "is this card at risk" is a defect, not a feature. */
export const riskLevelSchema = z.enum(['none', 'at_risk', 'overdue'])

/** v1.1 AI-AUDIT §3 "Uncertainty": every schema that guesses says how sure it is, so the UI can
 * render a "check this" underline on exactly the guessed fields instead of silent wrongness. */
export const confidenceSchema = z.enum(['high', 'medium', 'low'])

/** `YYYY-MM-DD`. Date-only everywhere, matching every due-date field in this codebase. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const isoDateTimeSchema = z.string().min(10).max(40)

/** An opaque row id as it travels into a prompt and back. Bounded so a malicious/confused caller
 * cannot smuggle a paragraph through an id field. */
export const idSchema = z.string().min(1).max(200)

/** A short, human-scannable id-carrying reference -- the shape every citation-bearing feature takes
 * its input items as, so "cite the cards/events they used" (TECH-SPEC §8 guard rail) is mechanical:
 * the tool's output can only ever name an id that was present in the input, and `validateOutput`
 * verifies that after the fact rather than trusting the instruction. */
export const idTitleSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(500),
})

/** One member as every people-aware feature receives them. `handle` is what the analytics filter
 * grammar's `assignee:@handle` token needs; `givenName` is what Uzbek case suffixes attach to. */
export const memberRefSchema = z.object({
  userId: idSchema,
  fullName: z.string().min(1).max(200),
  givenName: z.string().min(1).max(100),
  handle: z.string().max(100).nullable().default(null),
})
export type MemberRef = z.infer<typeof memberRefSchema>

export const labelRefSchema = z.object({ id: idSchema, name: z.string().min(1).max(80) })
export const projectRefSchema = z.object({ id: idSchema, title: z.string().min(1).max(300) })

/** Helper for `validateOutput`: the set of every id the caller actually supplied. */
export function idSet(
  ...lists: ReadonlyArray<ReadonlyArray<{ id: string }> | undefined>
): Set<string> {
  const set = new Set<string>()
  for (const list of lists) for (const item of list ?? []) set.add(item.id)
  return set
}

/** Drops every id in `candidates` that was not in `allowed`. The repair half of the citation guard
 * rail (AI-AUDIT §0.6: no caller in v1.0 did this, in a product whose every prompt claimed it did). */
export function keepKnownIds(
  candidates: readonly string[],
  allowed: ReadonlySet<string>,
): string[] {
  return candidates.filter((id) => allowed.has(id))
}
