// "What did I miss" after time away (TECH-SPEC §8). Input is exactly what the inbox/notifications
// screen the caller is looking at already has loaded since the given point in time -- new cards
// touching them, comments on their cards, upcoming events, notifications. No private contact data of
// any kind ever enters this feature's input (guard rail: "no feature reads private contact blocks").
import { z } from 'zod'
import { localeInstruction } from '../locale-prompt.js'
import { idTitleSchema, localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

export const whatDidIMissInputSchema = z.object({
  locale: localeSchema,
  sinceLabel: z.string().min(1).max(100),
  newCards: z.array(idTitleSchema).max(200).default([]),
  commentsOnMyCards: z.array(idTitleSchema).max(200).default([]),
  upcomingEvents: z.array(idTitleSchema).max(100).default([]),
})
export type WhatDidIMissInput = z.infer<typeof whatDidIMissInputSchema>

export const whatDidIMissOutputSchema = z.object({
  narrative: z.string().min(1).max(1500),
  highlightIds: z.array(z.string().min(1).max(200)).max(30),
})
export type WhatDidIMissOutput = z.infer<typeof whatDidIMissOutputSchema>

function simulate(input: WhatDidIMissInput): WhatDidIMissOutput {
  const total = input.newCards.length + input.commentsOnMyCards.length + input.upcomingEvents.length
  const narrative =
    total === 0
      ? `Nothing new since ${input.sinceLabel}.`
      : `Since ${input.sinceLabel}: ${input.newCards.length} new card(s), ${input.commentsOnMyCards.length} comment(s) on your cards, ${input.upcomingEvents.length} upcoming event(s).`
  const highlightIds = [...input.newCards, ...input.commentsOnMyCards, ...input.upcomingEvents]
    .slice(0, 5)
    .map((i) => i.id)
  return { narrative, highlightIds }
}

export const whatDidIMissSpec: FeatureSpec<WhatDidIMissInput, WhatDidIMissOutput> = {
  feature: 'what_did_i_miss',
  inputSchema: whatDidIMissInputSchema,
  outputSchema: whatDidIMissOutputSchema,
  toolName: 'emit_missed_digest',
  toolDescription:
    'Emit a short catch-up narrative for everything that happened while someone was away, citing only the given ids.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['narrative', 'highlightIds'],
    properties: {
      narrative: { type: 'string', minLength: 1, maxLength: 1500 },
      highlightIds: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 200 } },
    },
  },
  defaultMaxTokens: 1280,
  systemPrompt: (input) =>
    `You write a short "while you were away" catch-up for one person, since ${input.sinceLabel}, from three lists (new cards, comments on their cards, upcoming events -- each item has an id and a title). Prioritise what most needs their attention first. Never invent an item that is not in one of the three lists; if all three are empty, say plainly that nothing happened. highlightIds must only ever contain ids copied verbatim from the input. ${localeInstruction(input.locale)} Call emit_missed_digest exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}
