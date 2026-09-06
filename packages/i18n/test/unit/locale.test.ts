import { describe, expect, it } from 'vitest'
import {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_LABEL,
  LOCALE_CHIP,
  isLocale,
  resolveLocale,
  localeSchema,
} from '../../src/locale.js'

describe('locale model', () => {
  it('ships exactly the four frozen locales, uz-Latn first (I-9, gates.json limits.locales)', () => {
    expect(LOCALES).toEqual(['uz-Latn', 'uz-Cyrl', 'ru', 'en'])
    expect(DEFAULT_LOCALE).toBe('uz-Latn')
    expect(LOCALES[0]).toBe(DEFAULT_LOCALE)
  })

  it('gives every locale a label and a chip, autonyms in their own script', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABEL[locale]).toBeTruthy()
      expect(LOCALE_CHIP[locale]).toBeTruthy()
    }
    expect(LOCALE_LABEL['uz-Latn']).toBe('Oʻzbekcha (lotin)')
    expect(LOCALE_LABEL['uz-Cyrl']).toBe('Ўзбекча (кирилл)')
    expect(LOCALE_CHIP['uz-Latn']).toBe('OʻZ')
    expect(LOCALE_CHIP['uz-Cyrl']).toBe('ЎЗ')
  })

  it('localeSchema accepts only the four locales', () => {
    for (const locale of LOCALES) expect(localeSchema.safeParse(locale).success).toBe(true)
    expect(localeSchema.safeParse('uz').success).toBe(false)
    expect(localeSchema.safeParse('fr').success).toBe(false)
  })

  it('isLocale is a type guard over exactly the four locales', () => {
    expect(isLocale('ru')).toBe(true)
    expect(isLocale('uz')).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(42)).toBe(false)
  })

  describe('resolveLocale (spec.md §4.3 resolution order: user > stored > header > default)', () => {
    it('prefers the signed-in user record over everything else', () => {
      expect(resolveLocale({ user: 'ru', stored: 'en', header: 'uz' })).toBe('ru')
    })

    it('falls back to the signed-out persistence mirror when there is no user', () => {
      expect(resolveLocale({ user: null, stored: 'en', header: 'ru' })).toBe('en')
    })

    it('falls back to the Accept-Language header when there is no user or stored value', () => {
      expect(resolveLocale({ header: 'ru-RU,ru;q=0.9' })).toBe('ru')
      expect(resolveLocale({ header: 'en-US,en;q=0.9' })).toBe('en')
      expect(resolveLocale({ header: 'uz-Cyrl-UZ' })).toBe('uz-Cyrl')
      expect(resolveLocale({ header: 'uz-UZ' })).toBe('uz-Latn')
    })

    it('falls back to the default when nothing resolves', () => {
      expect(resolveLocale({})).toBe(DEFAULT_LOCALE)
      expect(resolveLocale({ user: null, stored: null, header: null })).toBe(DEFAULT_LOCALE)
      expect(resolveLocale({ header: 'fr-FR' })).toBe(DEFAULT_LOCALE)
    })

    it('never trusts a stale or forged value that is not one of the four locales', () => {
      expect(resolveLocale({ user: 'klingon' })).toBe(DEFAULT_LOCALE)
      expect(resolveLocale({ user: 'klingon', stored: 'ru' })).toBe('ru')
    })
  })
})
