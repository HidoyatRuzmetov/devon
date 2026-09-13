// `src/uz.ts` duplicates fourteen lines of `packages/i18n/src/normalize-uz.ts` on purpose (see that
// file's header: importing `@devon/i18n`'s barrel would pull React into the API's module graph).
// This is the test that keeps the two honest: the same table of cases, asserted here, so a change to
// the canonical implementation that is not mirrored fails a gate rather than shipping two different
// notions of correct Uzbek.
import { describe, expect, it } from 'vitest'
import { hasAsciiApostrophe, normalizeUzLatn, normalizeUzLatnDeep } from '../../src/uz.js'

const CASES: ReadonlyArray<readonly [string, string]> = [
  ["o'zgarish", 'oʻzgarish'],
  ["g'alaba", 'gʻalaba'],
  ["bo'lim", 'boʻlim'],
  ['ma`no', 'maʼno'],
  ['san’at', 'sanʼat'],
  ["O'zbekiston", 'Oʻzbekiston'],
  ["G'ijduvon", 'Gʻijduvon'],
  ['yigʻilish', 'yigʻilish'], // already correct: unchanged
  ['Nodira Karimova', 'Nodira Karimova'], // nothing to fix
]

describe('normalizeUzLatn', () => {
  for (const [input, expected] of CASES) {
    it(`"${input}" -> "${expected}"`, () => {
      expect(normalizeUzLatn(input)).toBe(expected)
    })
  }

  it('never changes the case of what somebody typed', () => {
    expect(normalizeUzLatn("BO'LIM")).toBe('BOʻLIM')
  })
})

describe('hasAsciiApostrophe', () => {
  it('is true for the characters the golden set forbids in uz-Latn output', () => {
    for (const bad of ["o'zgarish", 'ma`no', 'san’at', "G'ijduvon"]) {
      expect(hasAsciiApostrophe(bad)).toBe(true)
    }
  })

  it('is false once normalised', () => {
    for (const [input] of CASES) expect(hasAsciiApostrophe(normalizeUzLatn(input))).toBe(false)
  })
})

describe('normalizeUzLatnDeep', () => {
  it('rewrites every string leaf, at any depth', () => {
    const result = normalizeUzLatnDeep({
      headline: "Bo'lim hisoboti",
      risks: [{ text: "o'zgarish yo'q" }],
      nested: { deeper: ["g'alaba"] },
    })
    expect(result).toEqual({
      headline: 'Boʻlim hisoboti',
      risks: [{ text: 'oʻzgarish yoʻq' }],
      nested: { deeper: ['gʻalaba'] },
    })
  })

  it('never touches an id — an apostrophe inside one is data, not orthography', () => {
    const result = normalizeUzLatnDeep({
      cardId: "weird'id",
      citedIds: ["a'b", "c'd"],
      refId: "x'y",
      text: "o'zgarish",
    })
    expect(result).toEqual({
      cardId: "weird'id",
      citedIds: ["a'b", "c'd"],
      refId: "x'y",
      text: 'oʻzgarish',
    })
  })

  it('leaves numbers, booleans and nulls alone', () => {
    expect(normalizeUzLatnDeep({ n: 3, b: true, z: null })).toEqual({ n: 3, b: true, z: null })
  })
})
