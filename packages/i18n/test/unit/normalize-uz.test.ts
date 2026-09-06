import { describe, expect, it } from 'vitest'
import { normalizeUz } from '../../src/normalize-uz.js'

describe('normalizeUz (DESIGN.md §2.3: canonical Oʻ/Gʻ and hamza glyphs)', () => {
  it('folds a straight apostrophe after o/O or g/G to U+02BB (Oʻ/Gʻ digraph)', () => {
    expect(normalizeUz("o'zbek")).toBe('oʻzbek')
    expect(normalizeUz("O'zbek")).toBe('Oʻzbek')
    expect(normalizeUz("bog'")).toBe('bogʻ')
    expect(normalizeUz("bog'liq")).toBe('bogʻliq')
  })

  it('folds a straight apostrophe elsewhere to U+02BC (hamza)', () => {
    expect(normalizeUz("ma'no")).toBe('maʼno')
    expect(normalizeUz("san'at")).toBe('sanʼat')
  })

  it('folds a curly quote, backtick and other apostrophe-like marks the same way', () => {
    for (const variant of ['’', '‘', '`', '´', 'ʹ', 'ʽ']) {
      expect(normalizeUz(`o${variant}zbek`)).toBe('oʻzbek')
      expect(normalizeUz(`ma${variant}no`)).toBe('maʼno')
    }
  })

  it('is idempotent: normalising already-correct text changes nothing', () => {
    const correct = 'Oʻzbekiston, maʼlumot, Gʻalaba, sanʼat'
    expect(normalizeUz(correct)).toBe(correct)
  })

  it('an apostrophe-like character at the very start of the string folds to hamza (there is no preceding O/G)', () => {
    expect(normalizeUz("'boshlanish")).toBe('ʼboshlanish')
  })

  it('does not touch letter case', () => {
    expect(normalizeUz("O'ZBEKISTON")).toBe('OʻZBEKISTON')
    expect(normalizeUz('lowercase text')).toBe('lowercase text')
  })

  it('leaves text with no apostrophe-like characters untouched', () => {
    expect(normalizeUz('Bosh sahifa')).toBe('Bosh sahifa')
  })
})
