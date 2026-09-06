#!/usr/bin/env node
// `pnpm --filter @devon/i18n terms:build` -- regenerates TERMS.md from terms.json (design.md §1.4:
// "terms.json is the source of truth; TERMS.md is generated ... and committed"). Deterministic and
// idempotent: running it twice with no terms.json change produces byte-identical output (asserted
// by test/unit/terms.test.ts, "a unit test regenerates and asserts a byte-identical file").
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadTerms, loadBannedWords, TERMS_MD_PATH } from '../terms.js'
import type { Term } from '../terms.js'

export function renderTermsMd(terms: Term[], bannedWords: readonly string[]): string {
  const lines: string[] = []
  lines.push('<!-- GENERATED FILE. Do not edit by hand -- edit packages/i18n/terms.json and run')
  lines.push('     `pnpm --filter @devon/i18n terms:build`. A unit test asserts this file is')
  lines.push('     byte-identical to a fresh regeneration (AC-5). -->')
  lines.push('# Terminology (`packages/i18n/terms.json`)')
  lines.push('')
  lines.push(
    'Every row below has a citable source for the Uzbek choice (AC-5): a ministry site, a job posting, ' +
      'a form, or a live government digital-service page. `pnpm --filter @devon/i18n terms:verify` fails ' +
      'the build if a row lacks a source, the source is not `https://`, or the quote does not contain the ' +
      'recorded word.',
  )
  lines.push('')
  lines.push('| id | en | uz-Latn | uz-Cyrl | ru | source |')
  lines.push('|---|---|---|---|---|---|')
  for (const term of terms) {
    const sourceCell = `[${escapeCell(term.source.publisher)}](${term.source.url})`
    lines.push(
      `| \`${term.id}\` | ${escapeCell(term.en)} | ${escapeCell(term.uzLatn)} | ${escapeCell(term.uzCyrl)} | ${escapeCell(term.ru)} | ${sourceCell} |`,
    )
  }
  lines.push('')
  lines.push('## Sources, quoted')
  lines.push('')
  for (const term of terms) {
    lines.push(`### \`${term.id}\``)
    lines.push('')
    lines.push(`> ${term.source.quote}`)
    lines.push('')
    lines.push(
      `-- ${escapeCell(term.source.publisher)}, fetched ${term.source.fetchedAt}. ${term.source.url}`,
    )
    lines.push('')
    if (term.note) {
      lines.push(term.note)
      lines.push('')
    }
  }
  lines.push('## Banned words')
  lines.push('')
  lines.push(
    'The following must never appear as a whole word in any of the four message files ' +
      '(`packages/i18n/messages/*.json`) -- they are project-management jargon this product deliberately ' +
      'does not use in front of a first-time civil servant (design.md §1.4):',
  )
  lines.push('')
  lines.push(bannedWords.join(', '))
  lines.push('')
  return lines.join('\n')
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|')
}

function main(): void {
  const terms = loadTerms()
  const bannedWords = loadBannedWords()
  const markdown = renderTermsMd(terms, bannedWords)
  writeFileSync(TERMS_MD_PATH, markdown, 'utf8')
  console.log(`[terms:build] wrote ${TERMS_MD_PATH} (${terms.length} terms)`)
}

// Only run when executed directly (`tsx src/cli/terms-build.ts`), never as a side effect of
// `import { renderTermsMd } from './terms-build.js'` (test/unit/terms.test.ts imports the pure
// renderer to assert byte-identical regeneration without writing the file as a side effect).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
