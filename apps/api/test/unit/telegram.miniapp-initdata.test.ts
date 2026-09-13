// The Mini App's only proof of identity (v1.1 SPEC §9, EPIC-015). `initData` is a replayable string
// handed to a web page by Telegram's webview; everything the Mini App is allowed to do follows from
// this one function saying `ok: true`, so it is tested as a security boundary rather than as a
// parser: every rejection reason has a case, a one-bit change to the payload has to fail, and a
// payload signed with a different bot token has to fail.
//
// `signInitData` (the same module) is what produces valid fixtures -- deliberately, so that a change
// to the data-check-string rules cannot make the tests agree with themselves while disagreeing with
// Telegram: the round trip is checked against a hand-computed HMAC in the first test below.
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  INIT_DATA_MAX_AGE_SECONDS,
  signInitData,
  verifyInitData,
} from '../../src/modules/telegram/miniapp-initdata.js'

const SAMPLE_BOT_TOKEN = '7654321:AAF-ThisIsNotARealBotTokenItIsATestFixture00'
const SAMPLE_OTHER_TOKEN = '1234567:AAF-AlsoNotARealBotTokenAlsoJustAFixture000'
const NOW = new Date('2026-09-13T09:00:00.000Z')
const AUTH_DATE = String(Math.floor(NOW.getTime() / 1000) - 30)

const USER_JSON = JSON.stringify({
  id: 546_231_884,
  first_name: 'Anvar',
  last_name: 'Aliyev',
  username: 'anvar',
  language_code: 'uz',
  is_premium: true,
  allows_write_to_pm: true,
})

function fields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: AUTH_DATE,
    chat_type: 'private',
    query_id: 'AAH1bQAAAAAA',
    user: USER_JSON,
    ...overrides,
  }
}

function valid(overrides: Record<string, string> = {}, token = SAMPLE_BOT_TOKEN): string {
  return signInitData(fields(overrides), token)
}

describe('verifyInitData — the happy path', () => {
  it('accepts a payload signed with the bot token and returns the narrowed user', () => {
    const result = verifyInitData(valid(), SAMPLE_BOT_TOKEN, { now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.user).toEqual({
      id: 546_231_884,
      firstName: 'Anvar',
      lastName: 'Aliyev',
      username: 'anvar',
      languageCode: 'uz',
      isPremium: true,
      allowsWriteToPm: true,
    })
    expect(result.data.authDate.toISOString()).toBe('2026-09-13T08:59:30.000Z')
    expect(result.data.queryId).toBe('AAH1bQAAAAAA')
    expect(result.data.chatType).toBe('private')
    expect(result.data.startParam).toBeNull()
  })

  it('signs exactly the string Telegram documents (hand-computed, not self-referential)', () => {
    const raw = valid({ start_param: 'inbox' })
    const params = new URLSearchParams(raw)
    const hash = params.get('hash')
    params.delete('hash')
    const checkString = [...params.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n')
    const secret = createHmac('sha256', 'WebAppData').update(SAMPLE_BOT_TOKEN).digest()
    expect(hash).toBe(createHmac('sha256', secret).update(checkString).digest('hex'))
  })

  it('carries the deep-link start parameter the bot buttons use', () => {
    const result = verifyInitData(valid({ start_param: 'card_9f2a' }), SAMPLE_BOT_TOKEN, {
      now: NOW,
    })
    expect(result.ok && result.data.startParam).toBe('card_9f2a')
  })

  it('accepts the Bot API 8.0 `signature` field, hashed and not hashed', () => {
    // Both shapes exist in the wild; both must verify, and both are still a constant-time compare
    // against the bot token (this file's module header, detail 1).
    const hashed = valid({ signature: 'Ed25519Signature' })
    expect(verifyInitData(hashed, SAMPLE_BOT_TOKEN, { now: NOW }).ok).toBe(true)

    const withoutSignatureInHash = signInitData(fields(), SAMPLE_BOT_TOKEN)
    const params = new URLSearchParams(withoutSignatureInHash)
    params.set('signature', 'Ed25519Signature')
    expect(verifyInitData(params.toString(), SAMPLE_BOT_TOKEN, { now: NOW }).ok).toBe(true)
  })
})

describe('verifyInitData — every way in is closed', () => {
  it('refuses a payload signed with a different bot token', () => {
    const result = verifyInitData(valid({}, SAMPLE_OTHER_TOKEN), SAMPLE_BOT_TOKEN, { now: NOW })
    expect(result).toEqual({ ok: false, reason: 'bad_hash' })
  })

  it('refuses a one-character change to any signed field', () => {
    const params = new URLSearchParams(valid())
    params.set(
      'user',
      JSON.stringify({ id: 546_231_885, first_name: 'Anvar', last_name: 'Aliyev' }),
    )
    expect(verifyInitData(params.toString(), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_hash',
    })
  })

  it('refuses a one-bit change to the hash itself', () => {
    const params = new URLSearchParams(valid())
    const hash = params.get('hash')!
    params.set('hash', (hash[0] === '0' ? '1' : '0') + hash.slice(1))
    expect(verifyInitData(params.toString(), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_hash',
    })
  })

  it('refuses a hash of the wrong length or a non-hex hash without throwing', () => {
    for (const bad of ['', 'zz', 'not-hex-at-all', 'abcd']) {
      const params = new URLSearchParams(valid())
      params.set('hash', bad)
      const result = verifyInitData(params.toString(), SAMPLE_BOT_TOKEN, { now: NOW })
      expect(result.ok).toBe(false)
    }
  })

  it('refuses a payload with no hash at all', () => {
    const params = new URLSearchParams(valid())
    params.delete('hash')
    expect(verifyInitData(params.toString(), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'no_hash',
    })
  })

  it('refuses an empty, absent or whitespace payload', () => {
    for (const bad of [null, undefined, '', '   ']) {
      expect(verifyInitData(bad, SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
        ok: false,
        reason: 'missing',
      })
    }
  })

  it('refuses a payload longer than 8 KiB before doing any HMAC work', () => {
    expect(verifyInitData('a'.repeat(8193), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('refuses everything when no bot token is configured', () => {
    expect(verifyInitData(valid(), null, { now: NOW })).toEqual({
      ok: false,
      reason: 'not_configured',
    })
    expect(verifyInitData(valid(), '', { now: NOW })).toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })
})

describe('verifyInitData — replay and clocks', () => {
  it('accepts a payload right at the freshness boundary and refuses one past it', () => {
    const atEdge = String(Math.floor(NOW.getTime() / 1000) - INIT_DATA_MAX_AGE_SECONDS)
    expect(verifyInitData(valid({ auth_date: atEdge }), SAMPLE_BOT_TOKEN, { now: NOW }).ok).toBe(
      true,
    )

    const pastEdge = String(Math.floor(NOW.getTime() / 1000) - INIT_DATA_MAX_AGE_SECONDS - 1)
    expect(verifyInitData(valid({ auth_date: pastEdge }), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('refuses yesterday’s captured launch even though its signature is genuine', () => {
    const yesterday = String(Math.floor(NOW.getTime() / 1000) - 24 * 60 * 60)
    expect(verifyInitData(valid({ auth_date: yesterday }), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual(
      {
        ok: false,
        reason: 'expired',
      },
    )
  })

  it('tolerates a minute of clock skew but refuses a payload from the future', () => {
    const slightlyAhead = String(Math.floor(NOW.getTime() / 1000) + 30)
    expect(
      verifyInitData(valid({ auth_date: slightlyAhead }), SAMPLE_BOT_TOKEN, { now: NOW }).ok,
    ).toBe(true)
    const wayAhead = String(Math.floor(NOW.getTime() / 1000) + 3600)
    expect(verifyInitData(valid({ auth_date: wayAhead }), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('refuses a missing or non-numeric auth_date', () => {
    const noDate = signInitData({ user: USER_JSON }, SAMPLE_BOT_TOKEN)
    expect(verifyInitData(noDate, SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(
      verifyInitData(valid({ auth_date: 'yesterday' }), SAMPLE_BOT_TOKEN, { now: NOW }),
    ).toEqual({
      ok: false,
      reason: 'expired',
    })
  })
})

describe('verifyInitData — the user object', () => {
  it('refuses a launch with no user (an inline button in a channel)', () => {
    const noUser = signInitData({ auth_date: AUTH_DATE, chat_type: 'channel' }, SAMPLE_BOT_TOKEN)
    expect(verifyInitData(noUser, SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'no_user',
    })
  })

  it('refuses a user object that is not JSON, not an object, or has no usable id', () => {
    const bad = [
      'not json at all',
      '"a string"',
      '[]',
      JSON.stringify({ first_name: 'Anvar' }),
      JSON.stringify({ id: 0 }),
      JSON.stringify({ id: -5 }),
      JSON.stringify({ id: 1.5 }),
      JSON.stringify({ id: '546231884' }),
      JSON.stringify({ id: Number.MAX_SAFE_INTEGER + 2 }),
    ]
    for (const user of bad) {
      expect(verifyInitData(valid({ user }), SAMPLE_BOT_TOKEN, { now: NOW })).toEqual({
        ok: false,
        reason: 'no_user',
      })
    }
  })

  it('normalises the optional profile fields instead of passing them through', () => {
    const minimal = JSON.stringify({ id: 42 })
    const result = verifyInitData(valid({ user: minimal }), SAMPLE_BOT_TOKEN, { now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.user).toEqual({
      id: 42,
      firstName: '',
      lastName: null,
      username: null,
      languageCode: null,
      isPremium: false,
      allowsWriteToPm: false,
    })
  })

  it('does not let a truthy-but-wrong flag become `true`', () => {
    const sneaky = JSON.stringify({ id: 42, is_premium: 'yes', allows_write_to_pm: 1 })
    const result = verifyInitData(valid({ user: sneaky }), SAMPLE_BOT_TOKEN, { now: NOW })
    expect(result.ok && result.data.user.isPremium).toBe(false)
    expect(result.ok && result.data.user.allowsWriteToPm).toBe(false)
  })
})
