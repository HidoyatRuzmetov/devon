#!/usr/bin/env node
// `pnpm --filter @devon/i18n terms:verify` (design.md §1.4, §9 "AC-5 evidence producer"). Also run
// from inside `test:unit` (test/unit/terms.test.ts) so the `unit` gate always carries it -- this
// script exists separately too so a human/agent can run exactly the one-line evidence producer the
// design promises, without reaching for vitest.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadTerms,
  loadBannedWords,
  verifyTerms,
  scanBannedWords,
  TERMS_JSON_PATH,
  MESSAGES_DIR_PATH,
} from '../terms.js'

function main(): void {
  const terms = loadTerms()
  const termIssues = verifyTerms(terms)

  const messagesDir = MESSAGES_DIR_PATH
  const bannedWords = loadBannedWords()
  const bannedHits: { file: string; word: string; context: string }[] = []
  for (const file of readdirSync(messagesDir).filter((f) => f.endsWith('.json'))) {
    const text = readFileSync(join(messagesDir, file), 'utf8')
    for (const hit of scanBannedWords(text, bannedWords)) bannedHits.push({ file, ...hit })
  }

  let errors = 0
  console.log(`[terms:verify] ${TERMS_JSON_PATH}: ${terms.length} terms`)
  for (const issue of termIssues) {
    errors += 1
    console.log(`[terms:verify] FAIL ${issue.termId}: ${issue.problem}`)
  }
  for (const hit of bannedHits) {
    errors += 1
    console.log(
      `[terms:verify] FAIL banned word "${hit.word}" in ${hit.file}: "...${hit.context}..."`,
    )
  }
  if (errors === 0) console.log('[terms:verify] OK')
  process.exit(errors ? 1 : 0)
}

main()
