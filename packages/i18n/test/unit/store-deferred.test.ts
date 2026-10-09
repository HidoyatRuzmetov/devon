import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Locale } from '../../src/locale.js'

const mocked = vi.hoisted(() => ({
  loaded: new Set<string>(['uz-Latn']),
  load: vi.fn<(locale: Locale) => Promise<void>>(),
}))
vi.mock('../../src/messages.js', () => ({
  hasCatalogue: (locale: Locale) => mocked.loaded.has(locale),
  loadCatalogue: mocked.load,
  registerCatalogue: vi.fn(),
}))
import {
  getLocale,
  getLocaleLoadFailure,
  subscribeLocaleLoadFailure,
  resetLocaleForTests,
  setLocale,
} from '../../src/store.js'

beforeEach(() => {
  mocked.loaded = new Set(['uz-Latn'])
  mocked.load.mockReset()
  resetLocaleForTests()
})
afterEach(() => resetLocaleForTests())

it('choosing the already-active language cancels a deferred earlier choice', async () => {
  let resolve!: () => void
  mocked.load.mockImplementation(() => new Promise<void>((done) => (resolve = done)))
  setLocale('ru')
  setLocale('uz-Latn')
  mocked.loaded.add('ru')
  resolve()
  await Promise.resolve()
  expect(getLocale()).toBe('uz-Latn')
  expect(getLocaleLoadFailure()).toBe(null)
})

it('a rejected catalogue keeps the active language and does not create an unhandled rejection', async () => {
  mocked.load.mockRejectedValue(new Error('local catalogue refused'))
  setLocale('ru')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(getLocale()).toBe('uz-Latn')
  expect(getLocaleLoadFailure()).toBe('ru')
})

it('reports active failure once and clears it on a successful later choice', async () => {
  const listener = vi.fn()
  const stop = subscribeLocaleLoadFailure(listener)
  mocked.load.mockRejectedValue(new Error('local catalogue refused'))
  setLocale('ru')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(listener).toHaveBeenCalledTimes(1)
  mocked.loaded.add('en')
  setLocale('en')
  expect(getLocale()).toBe('en')
  expect(getLocaleLoadFailure()).toBe(null)
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
})

it('a rejected obsolete choice cannot announce an error after a later successful choice', async () => {
  let reject!: (error: Error) => void
  mocked.load.mockImplementation(() => new Promise<void>((_, fail) => (reject = fail)))
  setLocale('ru')
  mocked.loaded.add('en')
  setLocale('en')
  reject(new Error('obsolete local request'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(getLocale()).toBe('en')
  expect(getLocaleLoadFailure()).toBe(null)
})
