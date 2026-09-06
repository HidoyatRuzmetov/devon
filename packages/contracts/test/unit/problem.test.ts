import { describe, expect, it } from 'vitest'
import { PROBLEM_CODES, problem, problemSchema, type ProblemCode } from '../../src/problem.js'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const EMAIL_RE = /[^\s"]+@[^\s"]+\.[^\s"]+/

/** AC-11 disproof: "a client-side-only hide where the network response still carries admin data" and
 * H1.13 both come down to this one assertion, applied to every code -- design.md §1.5. */
function assertNoDomainData(json: string): void {
  expect(json).not.toMatch(UUID_RE)
  expect(json).not.toMatch(EMAIL_RE)
  expect(json.toLowerCase()).not.toContain('login')
  expect(json.toLowerCase()).not.toContain('select ')
  expect(json).not.toContain('/src/')
  expect(json).not.toContain('at Object.')
}

describe('PROBLEM_CODES', () => {
  it('is the frozen nine-code set from design.md §1.5', () => {
    expect(PROBLEM_CODES).toEqual([
      'unauthenticated',
      'forbidden',
      'not_found',
      'gone',
      'conflict',
      'validation_failed',
      'rate_limited',
      'maintenance',
      'internal',
    ])
  })
})

describe('problem()', () => {
  it.each(PROBLEM_CODES.map((c) => [c] as const))('code=%s carries no domain data', (code) => {
    const body = problem(code)
    assertNoDomainData(JSON.stringify(body))
  })

  it.each(PROBLEM_CODES.map((c) => [c] as const))(
    'code=%s validates against problemSchema',
    (code) => {
      const body = problem(code)
      expect(problemSchema.parse(body)).toEqual(body)
    },
  )

  it('carries a stable, code-derived type URI with no domain data', () => {
    expect(problem('forbidden').type).toBe('https://devon.local/problems/forbidden')
  })

  it('maps each code to the expected HTTP status', () => {
    const expected: Record<ProblemCode, number> = {
      unauthenticated: 401,
      forbidden: 403,
      not_found: 404,
      gone: 410,
      conflict: 409,
      validation_failed: 422,
      rate_limited: 429,
      maintenance: 503,
      internal: 500,
    }
    for (const code of PROBLEM_CODES) {
      expect(problem(code).status).toBe(expected[code])
    }
  })

  it('never lets a caller override the frozen title/status/detail for a code', () => {
    const body = problem('forbidden', {
      // @ts-expect-error -- ProblemOptions has no title/status/detail; this is the point of the test.
      title: 'leaked domain data',
      instance: 'urn:devon:request:req-1',
    })
    expect(body.title).toBe('Forbidden')
    expect(body.instance).toBe('urn:devon:request:req-1')
  })

  it('carries validation errors as path+code only, still with no domain data', () => {
    const body = problem('validation_failed', {
      errors: [{ path: 'body.familyName', code: 'too_short' }],
    })
    assertNoDomainData(JSON.stringify(body))
    expect(body.errors).toEqual([{ path: 'body.familyName', code: 'too_short' }])
  })

  it('omits instance/errors entirely when not supplied (exactOptionalPropertyTypes-safe)', () => {
    const body = problem('internal')
    expect('instance' in body).toBe(false)
    expect('errors' in body).toBe(false)
  })
})
