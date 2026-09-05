import { describe, expect, it } from 'vitest'
import { normalizeUz } from '../../src/normalize-uz.js'

describe('normalizeUz', () => {
  it('lowercases', () => {
    expect(normalizeUz('TOSHKENT')).toBe('toshkent')
  })

  it('folds every apostrophe variant away', () => {
    expect(normalizeUz('Oʻzbekiston')).toBe('ozbekiston')
    expect(normalizeUz('Oʼzbekiston')).toBe('ozbekiston')
    expect(normalizeUz("O'zbekiston")).toBe('ozbekiston')
    expect(normalizeUz('Gʻalaba')).toBe('galaba')
    expect(normalizeUz("Ma'no")).toBe('mano')
  })

  it('folds Cyrillic digraphs', () => {
    expect(normalizeUz('чиройли')).toBe('chiroyli')
    expect(normalizeUz('шахар')).toBe('shaxar')
    expect(normalizeUz('ёзувчи')).toBe('yozuvchi')
    expect(normalizeUz('юрист')).toBe('yurist')
    expect(normalizeUz('яхши')).toBe('yaxshi')
  })

  it('folds single-letter Cyrillic approximations, including Uzbek-specific letters', () => {
    expect(normalizeUz('Ўзбекистон')).toBe('ozbekiston')
    expect(normalizeUz('Қашқадарё')).toBe('qashqadaryo')
    expect(normalizeUz('Ғалаба')).toBe('galaba')
    expect(normalizeUz('Ҳақиқат')).toBe('haqiqat')
  })

  it('is a pure function -- same input, same output', () => {
    const input = 'Toshkent shahri, Oʻzbekiston'
    expect(normalizeUz(input)).toBe(normalizeUz(input))
  })

  it('leaves plain ASCII text untouched apart from case', () => {
    expect(normalizeUz('Deadline Friday')).toBe('deadline friday')
  })
})
