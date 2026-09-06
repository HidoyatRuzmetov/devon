import { afterEach, describe, expect, it, vi } from 'vitest'
import { t, translate } from '../../src/t.js'
import { setLocale, resetLocaleForTests } from '../../src/store.js'

describe('translate() / t()', () => {
  afterEach(() => resetLocaleForTests())

  it('looks a key up in the given locale', () => {
    expect(translate('en', 'shell.nav.home')).toBe('Home')
    expect(translate('ru', 'shell.nav.home')).toBe('Главная')
    expect(translate('uz-Latn', 'shell.nav.home')).toBe('Bosh sahifa')
    expect(translate('uz-Cyrl', 'shell.nav.home')).toBe('Бош саҳифа')
  })

  it('interpolates {param} placeholders', () => {
    expect(translate('en', 'home.greeting.morning', { name: 'Aziz' })).toBe('Good morning, Aziz')
    expect(translate('uz-Latn', 'state.error.requestId', { id: '8f3a-c210' })).toBe(
      'Soʻrov raqami: 8f3a-c210',
    )
  })

  it('leaves an unmatched placeholder untouched rather than dropping it', () => {
    expect(translate('en', 'home.greeting.morning', {})).toBe('Good morning, {name}')
  })

  it('accepts number params, stringified', () => {
    expect(translate('en', 'home.greeting.morning', { name: 42 })).toBe('Good morning, 42')
  })

  it('t() reads the currently active locale from the store', () => {
    setLocale('ru')
    expect(t('shell.nav.home')).toBe('Главная')
    setLocale('en')
    expect(t('shell.nav.home')).toBe('Home')
  })

  it('a missing key returns a visibly-bracketed placeholder and logs, never a silent blank or a fallback locale', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(translate('en', 'this.key.does.not.exist')).toBe('⟨this.key.does.not.exist⟩')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
