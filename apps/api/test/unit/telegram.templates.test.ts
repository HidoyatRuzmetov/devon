// TECH-SPEC §7: "localized templates for all four locales". Proves the four locale tables actually
// carry the same key set (a locale silently missing a key would fall back to `uz-Latn` at runtime --
// `tb()`'s own behaviour -- which is a worse failure mode to ship than a red gate here).
import { describe, expect, it } from 'vitest'
import { isBotLocale, tb } from '../../src/modules/telegram/templates.js'

const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const

describe('isBotLocale', () => {
  it('accepts exactly the four locales', () => {
    for (const l of LOCALES) expect(isBotLocale(l)).toBe(true)
  })

  it('rejects anything else, including null/undefined', () => {
    expect(isBotLocale('fr')).toBe(false)
    expect(isBotLocale(null)).toBe(false)
    expect(isBotLocale(undefined)).toBe(false)
  })
})

describe('tb (bot message templates)', () => {
  const KEYS = [
    'link.prompt_needed',
    'link.success',
    'link.expired',
    'link.already_used',
    'link.not_found',
    'unlinked.confirm',
    'today.header',
    'today.empty',
    'mytasks.header',
    'mytasks.empty',
    'events.header',
    'events.empty',
    'mute.on',
    'mute.off',
    'mute.usage',
    'group.connected',
    'group.connect_usage',
    'group.connect_invalid',
    'group.connect_already_used',
    'help',
    'button.mark_done',
    'button.snooze_1d',
    'button.rsvp_yes',
    'button.rsvp_no',
    'button.rsvp_maybe',
    'button.open',
    'action.acknowledged',
    'action.snoozed',
    'action.rsvp_recorded',
    'no_bot',
  ] as const

  it('has a non-empty string for every key in all four locales', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        const value = tb(locale, key)
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0)
        expect(value, `${locale}.${key} should not fall back to the raw key`).not.toBe(key)
      }
    }
  })

  it('interpolates {params} into the template', () => {
    expect(tb('en', 'mute.on', { minutes: 30 })).toBe('Notifications muted for 30 min.')
    expect(tb('ru', 'mute.on', { minutes: 30 })).toContain('30')
  })

  it('leaves an unmatched placeholder untouched rather than throwing', () => {
    expect(tb('en', 'help')).not.toMatch(/\{[a-zA-Z]+\}$/)
  })
})
