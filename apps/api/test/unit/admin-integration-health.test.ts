import { describe, expect, it, vi } from 'vitest'
import { probeAi, probeTelegram } from '../../src/modules/admin/health-probes.js'

describe('AI health reflects usable configuration', () => {
  const env = {
    AI_API_KEY: 'fixture',
    AI_MODEL: 'glm-5.3',
    AI_BASE_URL: 'https://configured.example/v1/',
  }

  it('does not dial the provider without credentials', async () => {
    const fetchImpl = vi.fn()
    expect((await probeAi({}, fetchImpl)).status).toBe('not_configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks the configured endpoint and model rather than reporting any HTTP response as healthy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'glm-5.3' }] }))
    expect((await probeAi(env, fetchImpl)).status).toBe('ok')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://configured.example/v1/models')
    expect(fetchImpl.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('reports the production regression: a configured old model missing from the allowed list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'glm-5.3' }] }))
    expect(await probeAi({ ...env, AI_MODEL: 'glm-5.2' }, fetchImpl)).toMatchObject({
      status: 'down',
      detail: { code: 'ai.modelUnavailable' },
    })
  })

  it('refuses invalid credentials without exposing the provider body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'private response body' }, { status: 403 }))
    const result = await probeAi(env, fetchImpl)
    expect(result).toMatchObject({ status: 'down', detail: { code: 'ai.rejected' } })
    expect(JSON.stringify(result)).not.toContain('private response body')
  })

  it('reports malformed provider responses and network failures as down', async () => {
    expect(
      (await probeAi(env, vi.fn().mockResolvedValue(Response.json({ data: null })))).status,
    ).toBe('down')
    expect(
      (await probeAi(env, vi.fn().mockRejectedValue(new Error('credential in transport message'))))
        .status,
    ).toBe('down')
  })
})

describe('Telegram health authenticates the configured bot', () => {
  const production = {
    NODE_ENV: 'production',
    TELEGRAM_BOT_TOKEN: 'fixture',
    TELEGRAM_WEBHOOK_SECRET: 'dummy-webhook-secret',
    DEVON_PUBLIC_URL: 'https://configured.example/',
  }
  const webhookUrl = 'https://configured.example/api/v1/telegram/webhook/dummy-webhook-secret'

  it.each([
    { url: '', active: true, status: 'ok' },
    { url: '', active: false, status: 'down' },
    { url: webhookUrl, active: true, status: 'down' },
  ])(
    'requires a live polling consumer and no webhook ($status)',
    async ({ url, active, status }) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ok: true }))
        .mockResolvedValueOnce(Response.json({ ok: true, result: { url } }))
      expect(
        (
          await probeTelegram(
            {
              NODE_ENV: 'production',
              TELEGRAM_BOT_TOKEN: 'fixture',
              TELEGRAM_TRANSPORT: 'polling',
            },
            fetchImpl,
            () => active,
          )
        ).status,
      ).toBe(status)
    },
  )

  it('respects the development transport opt-in without contacting a production bot', async () => {
    const fetchImpl = vi.fn()
    expect(
      (await probeTelegram({ ...production, NODE_ENV: 'development' }, fetchImpl)).status,
    ).toBe('not_configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('verifies production webhook delivery configuration after authenticating the bot', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, result: { url: webhookUrl, pending_update_count: 0 } }),
      )
    expect((await probeTelegram(production, fetchImpl)).status).toBe('ok')
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      'https://api.telegram.org/botfixture/getMe',
      'https://api.telegram.org/botfixture/getWebhookInfo',
    ])
    expect(fetchImpl.mock.calls[0]?.[1].signal).toBe(fetchImpl.mock.calls[1]?.[1].signal)
  })

  it.each(['', 'https://another-server.example/secret'])(
    'rejects missing or displaced webhook %s without exposing it',
    async (url) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ok: true }))
        .mockResolvedValueOnce(Response.json({ ok: true, result: { url } }))
      const result = await probeTelegram(production, fetchImpl)
      expect(result).toMatchObject({ status: 'down', detail: { code: 'telegram.webhookMismatch' } })
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(JSON.stringify(result)).not.toContain('another-server')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    },
  )

  it.each([
    {
      pending_update_count: 7,
      last_error_date: Math.floor(Date.now() / 1000),
      last_error_message: 'SSL certificate verify failed',
      status: 'down',
    },
    { pending_update_count: 1, last_error_date: Math.floor(Date.now() / 1000), status: 'degraded' },
    { pending_update_count: 101, last_error_date: 0, status: 'degraded' },
    { pending_update_count: 0, last_error_date: Math.floor(Date.now() / 1000), status: 'ok' },
  ])(
    'reports delivery backlog without treating recovered errors as active ($status)',
    async ({ status, ...info }) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ok: true }))
        .mockResolvedValueOnce(Response.json({ ok: true, result: { url: webhookUrl, ...info } }))
      expect((await probeTelegram(production, fetchImpl)).status).toBe(status)
    },
  )

  it('requires a configured token', async () => {
    const fetchImpl = vi.fn()
    expect((await probeTelegram({}, fetchImpl)).status).toBe('not_configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not mistake Telegram’s ok:false envelope for a healthy bot', async () => {
    expect(
      (
        await probeTelegram(
          { TELEGRAM_BOT_TOKEN: 'fixture' },
          vi.fn().mockResolvedValue(Response.json({ ok: false })),
        )
      ).status,
    ).toBe('down')
  })

  it('does not expose token-bearing network errors', async () => {
    const result = await probeTelegram(
      { TELEGRAM_BOT_TOKEN: 'fixture' },
      vi.fn().mockRejectedValue(new Error('https://api.telegram.org/botfixture/getMe')),
    )
    expect(result.status).toBe('down')
    expect(JSON.stringify(result)).not.toContain('fixture')
  })
})
