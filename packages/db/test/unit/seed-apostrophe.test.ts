import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Round-2 ui-blitz verification report (agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/round2/
// report.md, finding #17): the uz-Latn message files were normalised onto the one correct Uzbek
// apostrophe -- U+02BB MODIFIER LETTER TURNED COMMA (ʻ), the mark DESIGN.md's copy rules and
// packages/i18n use everywhere -- but the demo *seed content* (event titles, places, cost notes, card
// titles, comments, pages, job titles) still mixed in the plain ASCII apostrophe (U+0027, ') and the
// look-alike U+02BC MODIFIER LETTER APOSTROPHE (ʼ). A reviewer scrolling the seeded events page saw
// both marks on the same card. This test reads every seed source file directly (no Docker, no
// `pnpm start --demo`) and fails if either wrong mark ever comes back after `o`/`g`/`O`/`G`, so the
// mistake can't quietly return in a future seed edit.
//
// Scoped to double-quoted string literals only (not the whole file): every real piece of Uzbek seed
// content in this codebase lives in a `"..."` literal, including nested inside a `sql`` tagged
// template as `${"..."}`. Single-quoted spans -- SQL literals inside `sql`` templates ('pending',
// 'uz-Latn'), import specifiers ('pg'), enum-like values -- legitimately end in a `g` or `o` followed
// by their own closing `'`, so they must stay out of scope or this test would flag ordinary syntax.

const SEED_DIR = fileURLToPath(new URL('../../src/seed', import.meta.url))
const DOUBLE_QUOTED_STRING = /"(?:[^"\\]|\\.)*"/g
const WRONG_UZBEK_APOSTROPHE = /[oOgG](['ʼ])/g

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full))
    } else if (name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function findWrongApostrophes(source: string): string[] {
  const hits: string[] = []
  let stringMatch: RegExpExecArray | null
  DOUBLE_QUOTED_STRING.lastIndex = 0
  while ((stringMatch = DOUBLE_QUOTED_STRING.exec(source))) {
    const literal = stringMatch[0]
    WRONG_UZBEK_APOSTROPHE.lastIndex = 0
    let apostropheMatch: RegExpExecArray | null
    while ((apostropheMatch = WRONG_UZBEK_APOSTROPHE.exec(literal))) {
      hits.push(literal)
    }
  }
  return hits
}

describe('seed content apostrophes', () => {
  const files = walkTsFiles(SEED_DIR)

  it('found at least one seed source file to check', () => {
    // A guard against the walk silently returning nothing (a moved directory, a renamed extension)
    // and this whole test passing for the wrong reason.
    expect(files.length).toBeGreaterThan(10)
  })

  it('never uses the ASCII apostrophe or U+02BC after o/g -- only U+02BB (ʻ)', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const literal of findWrongApostrophes(source)) {
        offenders.push(`${file}: ${literal}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
