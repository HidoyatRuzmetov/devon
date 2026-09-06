import { describe, expect, it } from 'vitest'
import { flatten, flatMessages, knownKeys } from '../../src/messages.js'
import { LOCALES, DEFAULT_LOCALE } from '../../src/locale.js'

describe('message catalogues (I-9: four-way parity)', () => {
  it('flattens nested objects into dotted keys, leaving already-flat keys untouched', () => {
    expect(flatten({ a: { b: { c: 'x' } }, d: 'y' })).toEqual({ 'a.b.c': 'x', d: 'y' })
  })

  it('every locale has the exact same key set as the default locale', () => {
    const base = new Set(Object.keys(flatMessages(DEFAULT_LOCALE)))
    expect(base.size).toBeGreaterThan(0)
    for (const locale of LOCALES) {
      const keys = new Set(Object.keys(flatMessages(locale)))
      const missing = [...base].filter((k) => !keys.has(k))
      const extra = [...keys].filter((k) => !base.has(k))
      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] })
    }
  })

  it('no message value is empty in any locale', () => {
    for (const locale of LOCALES) {
      const empty = Object.entries(flatMessages(locale)).filter(([, v]) => v.trim() === '')
      expect(empty).toEqual([])
    }
  })

  it('knownKeys() matches the default locale key set exactly', () => {
    expect(new Set(knownKeys())).toEqual(new Set(Object.keys(flatMessages(DEFAULT_LOCALE))))
  })

  it('seeds the full baseline surface named in the handoff (shell, search, locale, demo, states, home, login/setup, admin)', () => {
    const keys = new Set(knownKeys())
    for (const must of [
      'shell.nav.home',
      'shell.nav.admin',
      'shell.search.trigger',
      'shell.locale.aria',
      'shell.demo.chip.label',
      'cmd.placeholder',
      'home.eyebrow',
      'state.error.title',
      'state.denied.title',
      'state.offline.banner',
      'state.notfound.title',
      'login.title',
      'setup.title',
      'admin.title',
    ]) {
      expect(keys.has(must)).toBe(true)
    }
  })
})
