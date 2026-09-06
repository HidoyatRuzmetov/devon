// "Pointer not payload" (TECH-SPEC §7, CLAUDE.md "Do not send personal contact details to Telegram").
// Proves `buildTelegramPointer`'s allow-list structurally, not by scanning for known-bad substrings:
// a record stuffed with every contact/identity field this codebase's own `USER_FIELD_TIER` map
// (`packages/db/src/tiers.ts`) calls `restricted`/`secret`, plus a few more this app does not even
// store yet, is fed straight in as `input`, and none of those values may appear anywhere in the
// output -- because `buildTelegramPointer` never reads those keys in the first place.
import { describe, expect, it } from 'vitest'
import { absoluteDeepLink, buildTelegramPointer, FORBIDDEN_CONTACT_FIELDS } from '../../src/modules/telegram/pointer.js'

const ADVERSARIAL_USER_RECORD = {
  title: 'Ertaga muddati: "III chorak hisoboti"',
  body: 'Anvar Aliyev sizdan hisobotni tekshirishni so‘radi',
  deepLink: '/cards/11111111-1111-1111-1111-111111111111',
  eventAt: '2026-09-06T18:00:00.000Z',
  // Everything below this line must never leak into the built pointer.
  email: 'anvar.aliyev@example.uz',
  login: 'demo.boshliq',
  phone: '+998901234567',
  phoneNumber: '+998901234567',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$forbiddensecretvalue',
  password_hash: '$argon2id$v=19$m=19456,t=2,p=1$forbiddensecretvalue',
  patronymic: 'Bahodirovich',
  address: 'Toshkent shahri, Yunusobod tumani, 12-uy',
  avatarKey: 's3://devon-avatars/anvar-aliyev.png',
}

describe('buildTelegramPointer (pointer not payload)', () => {
  it('carries only title, body, deepLink and eventAt', () => {
    const pointer = buildTelegramPointer(ADVERSARIAL_USER_RECORD)
    expect(pointer).toEqual({
      title: ADVERSARIAL_USER_RECORD.title,
      body: ADVERSARIAL_USER_RECORD.body,
      deepLink: ADVERSARIAL_USER_RECORD.deepLink,
      eventAt: ADVERSARIAL_USER_RECORD.eventAt,
    })
  })

  it('never lets a forbidden contact/identity field value leak into the serialized output', () => {
    const pointer = buildTelegramPointer(ADVERSARIAL_USER_RECORD)
    const serialized = JSON.stringify(pointer)
    for (const field of FORBIDDEN_CONTACT_FIELDS) {
      const value = (ADVERSARIAL_USER_RECORD as Record<string, unknown>)[field]
      if (typeof value === 'string') expect(serialized).not.toContain(value)
    }
    // Belt and suspenders: the exact adversarial values above, named explicitly (not just looped),
    // so a future refactor of FORBIDDEN_CONTACT_FIELDS can never silently narrow this test's coverage.
    expect(serialized).not.toContain('anvar.aliyev@example.uz')
    expect(serialized).not.toContain('demo.boshliq')
    expect(serialized).not.toContain('+998901234567')
    expect(serialized).not.toContain('forbiddensecretvalue')
    expect(serialized).not.toContain('Bahodirovich')
    expect(serialized).not.toContain('Yunusobod')
  })

  it('degrades gracefully when the expected fields are missing (never throws)', () => {
    expect(buildTelegramPointer({})).toEqual({ title: '', body: null, deepLink: null, eventAt: null })
  })

  it('ignores non-string values for every field instead of coercing them', () => {
    const pointer = buildTelegramPointer({ title: 42, body: {}, deepLink: [], eventAt: null })
    expect(pointer).toEqual({ title: '', body: null, deepLink: null, eventAt: null })
  })
})

describe('absoluteDeepLink', () => {
  it('joins a public URL and a path with exactly one slash', () => {
    expect(absoluteDeepLink('https://portal.example', '/cards/1')).toBe('https://portal.example/cards/1')
    expect(absoluteDeepLink('https://portal.example/', '/cards/1')).toBe('https://portal.example/cards/1')
  })

  it('returns null for a null path (nothing to link to)', () => {
    expect(absoluteDeepLink('https://portal.example', null)).toBeNull()
  })

  it('never carries a query string or token -- the deep link is only ever what the caller\'s own path says', () => {
    const link = absoluteDeepLink('https://portal.example', '/cards/1')
    expect(link).not.toContain('?')
  })
})
