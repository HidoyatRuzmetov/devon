// H1.14 (Telegram webhook secret token verified, replay window) and H10.1 (webhook replay
// protection). The route assertions below are the ones that matter: before this pass the handler
// compared only the copy of the secret in the URL path -- a value that Caddy writes to
// `/data/access.log` for every request -- and never looked at `X-Telegram-Bot-Api-Secret-Token`,
// the header Telegram's own documentation names as the way to prove a delivery is yours.
import { describe, it, expect } from 'vitest'
import { buildTestApp } from './test-app.js'
import {
  secretsEqual,
  TELEGRAM_SECRET_HEADER,
  UpdateReplayWindow,
} from '../../src/modules/telegram/webhook-guard.js'

// 32 characters of the alphabet `config.ts` requires -- a literal test fixture, never a real secret.
const SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const BOT_TOKEN = '123456:test-bot-token-fixture'

async function webhookApp() {
  return buildTestApp(undefined, {
    config: { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET },
  })
}

const UPDATE = { update_id: 1001, message: { message_id: 1, text: 'hello' } }

describe('POST /api/v1/telegram/webhook/:secret (H1.14)', () => {
  it('refuses a delivery with the right path secret but no secret-token header', async () => {
    const { app } = await webhookApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/telegram/webhook/${SECRET}`,
      payload: UPDATE,
    })
    // 404, not 401/403: a prober must not learn that the secret in the path was correct.
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('refuses a delivery whose secret-token header does not match', async () => {
    const { app } = await webhookApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/telegram/webhook/${SECRET}`,
      headers: { [TELEGRAM_SECRET_HEADER]: `${SECRET.slice(0, -1)}B` },
      payload: UPDATE,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('refuses a delivery whose path secret does not match, even with a valid header', async () => {
    const { app } = await webhookApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/telegram/webhook/${SECRET.slice(0, -1)}B`,
      headers: { [TELEGRAM_SECRET_HEADER]: SECRET },
      payload: UPDATE,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('refuses every delivery when no bot is configured, whatever the secret', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/telegram/webhook/${SECRET}`,
      headers: { [TELEGRAM_SECRET_HEADER]: SECRET },
      payload: UPDATE,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('accepts a delivery with both copies of the secret', async () => {
    const { app } = await webhookApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/telegram/webhook/${SECRET}`,
      headers: { [TELEGRAM_SECRET_HEADER]: SECRET },
      payload: UPDATE,
    })
    // 200 regardless of what grammY makes of the update body (the handler swallows and logs that,
    // so Telegram never retries a delivery this process has already taken responsibility for).
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

describe('secretsEqual (H1.14: constant-time comparison)', () => {
  it('is true only for an exact match', () => {
    expect(secretsEqual(SECRET, SECRET)).toBe(true)
    expect(secretsEqual(SECRET, `${SECRET}x`)).toBe(false)
    expect(secretsEqual(`${SECRET.slice(0, -1)}B`, SECRET)).toBe(false)
    expect(secretsEqual('', '')).toBe(true)
  })

  it('never throws on a length mismatch or a missing value', () => {
    expect(secretsEqual(undefined, SECRET)).toBe(false)
    expect(secretsEqual(SECRET, undefined)).toBe(false)
    expect(secretsEqual('a', SECRET)).toBe(false)
  })
})

describe('UpdateReplayWindow (H10.1, H11.1)', () => {
  it('accepts an update once and refuses the replay', () => {
    const window = new UpdateReplayWindow()
    expect(window.accept(10)).toBe(true)
    expect(window.accept(10)).toBe(false)
    expect(window.accept(11)).toBe(true)
  })

  it('refuses a non-finite id', () => {
    const window = new UpdateReplayWindow()
    expect(window.accept(Number.NaN)).toBe(false)
    expect(window.accept(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('stays bounded and refuses ids that fall out of the window', () => {
    const window = new UpdateReplayWindow(4)
    for (const id of [1, 2, 3, 4, 5, 6]) expect(window.accept(id)).toBe(true)
    expect(window.size).toBeLessThanOrEqual(4)
    // 1 and 2 were evicted; replaying them must still be refused, not silently re-accepted.
    expect(window.accept(1)).toBe(false)
    expect(window.accept(2)).toBe(false)
    expect(window.accept(7)).toBe(true)
  })
})
