import { afterEach, describe, expect, it } from 'vitest'
import { testConfig } from './test-app.js'
import {
  configureTelegram,
  getBot,
  isTelegramConfigured,
} from '../../src/modules/telegram/transport.js'

describe('Telegram development transport safety', () => {
  afterEach(() => configureTelegram(testConfig()))

  it('a copied production token cannot create a development bot without explicit opt-in', () => {
    configureTelegram(
      testConfig({ NODE_ENV: 'development', TELEGRAM_BOT_TOKEN: '123456:example-fixture' }),
    )
    expect(isTelegramConfigured()).toBe(false)
    expect(getBot()).toBeNull()
  })

  it('allows a deliberately enabled development bot and clears it when opt-in is removed', () => {
    const config = testConfig({
      NODE_ENV: 'development',
      TELEGRAM_BOT_TOKEN: '123456:example-fixture',
      TELEGRAM_POLLING_ENABLED: true,
    })
    configureTelegram(config)
    expect(isTelegramConfigured()).toBe(true)
    expect(getBot()).not.toBeNull()
    configureTelegram({ ...config, TELEGRAM_POLLING_ENABLED: false })
    expect(getBot()).toBeNull()
  })
})
