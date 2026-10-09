import { describe, expect, it } from 'vitest'
import { authEntryPath, authReturnPath } from '../../src/lib/auth-return.js'

describe('authentication invitation return boundary', () => {
  it('preserves an invitation through both entry routes without copying a password', () => {
    const returnTo = '/join?key=SAFE123&password=should-not-travel#hidden'
    expect(authReturnPath(returnTo, '/')).toBe('/join?key=SAFE123')
    expect(authEntryPath('/register', returnTo)).toBe('/register?returnTo=%2Fjoin%3Fkey%3DSAFE123')
  })
  it.each([
    'https://evil.invalid/join',
    '//evil.invalid/join',
    '/\\evil.invalid/join',
    '/login',
    '/admin',
    '/join/../admin',
    '/%2f%2fevil.invalid/join',
    '/join%2f..%2fadmin',
    '/join%5c..%5cadmin',
    '/join\n?key=SAFE123',
  ])('rejects an unsafe return destination %s', (destination) => {
    expect(authReturnPath(destination, '/')).toBe('/')
  })
  it('uses the caller fallback when absent and supports manual invitation entry', () => {
    expect(authReturnPath(null, '/departments')).toBe('/departments')
    expect(authReturnPath('/join', '/')).toBe('/join')
  })
  it('retains only the first invitation key and no duplicate return or password parameters', () => {
    expect(authReturnPath('/join?key=FIRST&key=SECOND&returnTo=//evil.invalid', '/')).toBe(
      '/join?key=FIRST',
    )
  })
})
