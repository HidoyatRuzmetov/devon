import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocale, setLocale, subscribeLocale, resetLocaleForTests } from '../../src/store.js'
import { DEFAULT_LOCALE } from '../../src/locale.js'

describe('locale store', () => {
  afterEach(() => resetLocaleForTests())

  it('starts at the default locale', () => {
    expect(getLocale()).toBe(DEFAULT_LOCALE)
  })

  it('setLocale updates getLocale() and notifies subscribers exactly once', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocale(listener)
    setLocale('ru')
    expect(getLocale()).toBe('ru')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('setLocale to the already-active locale is a no-op (no notification)', () => {
    setLocale('ru')
    const listener = vi.fn()
    const unsubscribe = subscribeLocale(listener)
    setLocale('ru')
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('ignores an unknown locale and logs, rather than corrupting state', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // @ts-expect-error -- deliberately an invalid locale, to prove the guard
    setLocale('klingon')
    expect(getLocale()).toBe(DEFAULT_LOCALE)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('unsubscribe stops further notifications', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocale(listener)
    unsubscribe()
    setLocale('en')
    expect(listener).not.toHaveBeenCalled()
  })
})
