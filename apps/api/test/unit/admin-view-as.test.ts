// Pure, DB-free coverage for `modules/admin/view-as.ts` (I-8a). No Postgres, no Fastify -- exactly
// the shape `test/vitest.config.ts`'s header describes for anything built on an injected/pure seam.
import { describe, expect, it } from 'vitest'
import {
  signViewAsCookie,
  verifyViewAsCookie,
  VIEW_AS_MAX_MINUTES,
} from '../../src/modules/admin/view-as.js'

const SECRET = 'test-csrf-secret-value'
const DEPARTMENT_ID = '11111111-1111-1111-1111-111111111111'

describe('signViewAsCookie / verifyViewAsCookie', () => {
  it('round-trips: a freshly signed cookie verifies back to the same department id', () => {
    const now = Date.now()
    const { value, expiresAtMs } = signViewAsCookie(DEPARTMENT_ID, SECRET, now)
    expect(expiresAtMs).toBe(now + VIEW_AS_MAX_MINUTES * 60_000)
    expect(verifyViewAsCookie(value, SECRET, now)).toBe(DEPARTMENT_ID)
  })

  it('rejects an expired cookie even with a correct signature', () => {
    const now = Date.now()
    const { value, expiresAtMs } = signViewAsCookie(DEPARTMENT_ID, SECRET, now)
    expect(verifyViewAsCookie(value, SECRET, expiresAtMs + 1)).toBeNull()
  })

  it('rejects a tampered department id (signature no longer matches)', () => {
    const now = Date.now()
    const { value } = signViewAsCookie(DEPARTMENT_ID, SECRET, now)
    const [, expiresAtMs, signature] = value.split('.')
    const tampered = `22222222-2222-2222-2222-222222222222.${expiresAtMs}.${signature}`
    expect(verifyViewAsCookie(tampered, SECRET, now)).toBeNull()
  })

  it('rejects a cookie signed with a different secret', () => {
    const now = Date.now()
    const { value } = signViewAsCookie(DEPARTMENT_ID, SECRET, now)
    expect(verifyViewAsCookie(value, 'a-completely-different-secret', now)).toBeNull()
  })

  it('rejects malformed input without throwing', () => {
    expect(verifyViewAsCookie(undefined, SECRET)).toBeNull()
    expect(verifyViewAsCookie('', SECRET)).toBeNull()
    expect(verifyViewAsCookie('not-enough-parts', SECRET)).toBeNull()
    expect(verifyViewAsCookie('a.b.c.d', SECRET)).toBeNull()
    expect(verifyViewAsCookie(`${DEPARTMENT_ID}.not-a-number.deadbeef`, SECRET)).toBeNull()
  })
})
