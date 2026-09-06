import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  loadTerms,
  loadBannedWords,
  verifyTerms,
  termSchema,
  TERMS_MD_PATH,
} from '../../src/terms.js'
import { renderTermsMd } from '../../src/cli/terms-build.js'

describe('terminology contract (AC-5)', () => {
  it('terms.json parses against the frozen shape (id, en, uzLatn, uzCyrl, ru, source -- all required)', () => {
    const terms = loadTerms()
    expect(terms.length).toBeGreaterThan(0)
    for (const term of terms) expect(() => termSchema.parse(term)).not.toThrow()
  })

  it('verifyTerms() passes on the committed terms.json: every row has an https source whose quote contains the term', () => {
    const issues = verifyTerms(loadTerms())
    expect(issues).toEqual([])
  })

  it('verifyTerms() rejects a non-https source', () => {
    const [term] = loadTerms()
    const issues = verifyTerms([
      { ...term!, source: { ...term!.source, url: 'http://example.uz' } },
    ])
    expect(issues.some((i) => i.problem.includes('https://'))).toBe(true)
  })

  it('verifyTerms() rejects a quote that does not contain the recorded word', () => {
    const [term] = loadTerms()
    const issues = verifyTerms([
      { ...term!, source: { ...term!.source, quote: 'irrelevant sentence' } },
    ])
    expect(issues.some((i) => i.problem.includes('does not contain'))).toBe(true)
  })

  it('verifyTerms() rejects an empty quote', () => {
    const [term] = loadTerms()
    const issues = verifyTerms([{ ...term!, source: { ...term!.source, quote: '' } }])
    expect(issues.length).toBeGreaterThan(0)
  })

  it('verifyTerms() flags a duplicate id', () => {
    const [term] = loadTerms()
    const issues = verifyTerms([term!, term!])
    expect(issues.some((i) => i.problem.includes('duplicate id'))).toBe(true)
  })

  it('the quote match is apostrophe- and case-insensitive (a citation is rarely sentence-cased the same way twice)', () => {
    const issues = verifyTerms([
      {
        id: 'fixture',
        en: 'Fixture',
        uzLatn: "O'zbek",
        uzCyrl: 'Ўзбек',
        ru: 'Узбекский',
        source: {
          url: 'https://example.uz/doc',
          publisher: 'Test',
          quote: 'OʻZBEK davlati',
          fetchedAt: '2026-01-01',
        },
      },
    ])
    expect(issues).toEqual([])
  })

  it('TERMS.md is generated and committed byte-identical to a fresh regeneration', () => {
    const committed = readFileSync(TERMS_MD_PATH, 'utf8')
    const fresh = renderTermsMd(loadTerms(), loadBannedWords())
    expect(fresh).toBe(committed)
  })
})
