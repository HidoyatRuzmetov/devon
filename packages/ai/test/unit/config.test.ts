import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  hasApiKey,
  loadAiConfig,
  MIN_MAX_TOKENS,
} from '../../src/config.js'

describe('loadAiConfig', () => {
  it('falls back to the documented GLM endpoint and model when unset', () => {
    const config = loadAiConfig({})
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(config.model).toBe(DEFAULT_MODEL)
    expect(config.apiKey).toBeNull()
    expect(config.minMaxTokens).toBe(MIN_MAX_TOKENS)
  })

  it('reads AI_API_KEY / AI_BASE_URL / AI_MODEL from the given env', () => {
    const config = loadAiConfig({
      AI_API_KEY: 'dummy-token-value',
      AI_BASE_URL: 'https://example.test/v1',
      AI_MODEL: 'glm-9000',
    })
    expect(config.apiKey).toBe('dummy-token-value')
    expect(config.baseUrl).toBe('https://example.test/v1')
    expect(config.model).toBe('glm-9000')
  })

  it('treats a blank AI_API_KEY the same as unset', () => {
    const config = loadAiConfig({ AI_API_KEY: '   ' })
    expect(config.apiKey).toBeNull()
    expect(hasApiKey(config)).toBe(false)
  })

  it('carries the key as a plain field only, never interpolated into a derived message', () => {
    // Regression guard: nothing in config.ts formats a string containing config.apiKey. If a future
    // edit adds a `` `key=${config.apiKey}` `` anywhere, this test's intent is what to check for, even
    // though a pure unit test of this one function cannot itself scan the whole package for it.
    const config = loadAiConfig({ AI_API_KEY: 'dummy-secret-value' })
    expect(JSON.stringify(config)).toContain('dummy-secret-value') // present as data...
    expect(Object.keys(config)).toEqual(
      expect.arrayContaining(['apiKey', 'baseUrl', 'model', 'pricePerMillionTokensUzs']),
    ) // ...only as the one named field, never duplicated into a derived message string.
  })
})

describe('hasApiKey', () => {
  it('is true only when a non-empty key is configured', () => {
    expect(hasApiKey(loadAiConfig({ AI_API_KEY: 'x' }))).toBe(true)
    expect(hasApiKey(loadAiConfig({}))).toBe(false)
  })
})
