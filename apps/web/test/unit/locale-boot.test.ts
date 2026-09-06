import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale } from '@devon/i18n'
import { bootLocale, persistLocale, reconcileLocaleWithUser } from '../../src/lib/locale-boot.js'
import { LOCALE_STORAGE_KEY } from '../../src/lib/constants.js'

function clearCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

describe('locale boot resolution (design.md §4.3, AC-4)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearCookies()
    setLocale('uz-Latn')
  })
  afterEach(() => {
    window.localStorage.clear()
    clearCookies()
  })

  it('falls back to the default locale with nothing stored and an unrecognised header', () => {
    Object.defineProperty(window.navigator, 'language', { value: 'fr-FR', configurable: true })
    bootLocale()
    expect(getLocale()).toBe('uz-Latn')
  })

  it('prefers a stored localStorage locale over the browser language', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ru')
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
    bootLocale()
    expect(getLocale()).toBe('ru')
  })

  it('falls back to the wp_locale cookie when localStorage has nothing', () => {
    document.cookie = 'wp_locale=en; Path=/'
    bootLocale()
    expect(getLocale()).toBe('en')
  })

  it('falls back to a recognised browser language when nothing is stored', () => {
    Object.defineProperty(window.navigator, 'language', { value: 'ru-RU', configurable: true })
    bootLocale()
    expect(getLocale()).toBe('ru')
  })

  it('persistLocale writes both the localStorage mirror and the wp_locale cookie', () => {
    persistLocale('uz-Cyrl')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('uz-Cyrl')
    expect(document.cookie).toContain('wp_locale=uz-Cyrl')
  })

  it('reconcileLocaleWithUser overrides whatever bootLocale guessed', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    bootLocale()
    expect(getLocale()).toBe('en')
    reconcileLocaleWithUser('ru')
    expect(getLocale()).toBe('ru')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru')
  })
})
