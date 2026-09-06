// Terminology contract (design.md §1.4, AC-5). `terms.json` is the source of truth; `TERMS.md`
// (src/cli/terms-build.ts) is generated from it and committed. This module is the one place both
// the generator, the verifier and the unit tests read the shape from, so they can never drift.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { z } from 'zod'
import { normalizeUz } from './normalize-uz.js'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
/** `packages/i18n/..` twice over -- the monorepo root. Shared by the CLI break scripts, which need
 *  to shell out to `agentic/scripts/check-i18n.mjs`. */
export const REPO_ROOT = dirname(dirname(PACKAGE_ROOT))
export const TERMS_JSON_PATH = join(PACKAGE_ROOT, 'terms.json')
export const TERMS_MD_PATH = join(PACKAGE_ROOT, 'TERMS.md')
export const BANNED_JSON_PATH = join(PACKAGE_ROOT, 'banned.json')
export const MESSAGES_DIR_PATH = join(PACKAGE_ROOT, 'messages')

export const termSourceSchema = z.object({
  url: z.string().min(1),
  publisher: z.string().min(1),
  quote: z.string().min(1),
  fetchedAt: z.string().min(1),
})

export const termSchema = z.object({
  id: z.string().min(1),
  en: z.string().min(1),
  uzLatn: z.string().min(1),
  uzCyrl: z.string().min(1),
  ru: z.string().min(1),
  source: termSourceSchema,
  note: z.string().min(1).optional(),
})

export type TermSource = z.infer<typeof termSourceSchema>
export type Term = z.infer<typeof termSchema>

export function loadTerms(): Term[] {
  const raw = JSON.parse(readFileSync(TERMS_JSON_PATH, 'utf8'))
  return z.array(termSchema).parse(raw)
}

export function loadBannedWords(): string[] {
  const raw = JSON.parse(readFileSync(BANNED_JSON_PATH, 'utf8'))
  return z.array(z.string().min(1)).parse(raw)
}

export type TermIssue = { termId: string; problem: string }

/** Mechanises AC-5's disproof: a row without a source URL, a source that is not `https://`, a
 *  missing quote, or a quote that does not actually contain the recorded Uzbek word. Comparison is
 *  apostrophe-canonicalised (`normalizeUz`) and case-folded, since a quote lifted from a legal
 *  document is very often capitalised or sentence-initial differently from the term's citation
 *  form -- that is not a sourcing defect, only a grammar one. */
export function verifyTerms(terms: Term[]): TermIssue[] {
  const issues: TermIssue[] = []
  const seenIds = new Set<string>()
  for (const term of terms) {
    if (seenIds.has(term.id)) issues.push({ termId: term.id, problem: `duplicate id "${term.id}"` })
    seenIds.add(term.id)

    if (!term.source.url.startsWith('https://')) {
      issues.push({
        termId: term.id,
        problem: `source.url must be https:// (got "${term.source.url}")`,
      })
    }
    if (term.source.quote.trim().length === 0) {
      issues.push({ termId: term.id, problem: 'source.quote is empty' })
    }
    const foldedQuote = normalizeUz(term.source.quote).toLowerCase()
    const foldedTerm = normalizeUz(term.uzLatn).toLowerCase()
    if (!foldedQuote.includes(foldedTerm)) {
      issues.push({
        termId: term.id,
        problem: `source.quote does not contain uzLatn "${term.uzLatn}" (normalised: "${foldedTerm}")`,
      })
    }
  }
  return issues
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type BannedHit = { file: string; word: string; context: string }

/** Whole-word, case-insensitive scan (design.md §1.4: "must not appear as a whole word"). Uses a
 *  Unicode-aware boundary so it also catches a banned Cyrillic word glued to Cyrillic punctuation,
 *  which `\b` (an ASCII-only boundary in most engines) would miss. */
export function scanBannedWords(
  text: string,
  bannedWords: readonly string[],
): { word: string; context: string }[] {
  const hits: { word: string; context: string }[] = []
  for (const word of bannedWords) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'giu')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      const start = Math.max(0, match.index - 20)
      const end = Math.min(text.length, match.index + word.length + 20)
      hits.push({ word, context: text.slice(start, end) })
    }
  }
  return hits
}
