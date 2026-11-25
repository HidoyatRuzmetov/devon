import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { onboardingFacts } from '@devon/contracts'
import { patchProfileBodySchema } from '../../src/modules/accounts/schemas.js'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import { buildTestApp, cookieHeader, parseSetCookies } from './test-app.js'

vi.mock('../../src/modules/admin/availability-gate.js', () => ({
  registerAvailabilityGate: vi.fn(),
  invalidateDepartmentStatusCache: vi.fn(),
}))

vi.mock('../../src/modules/onboarding/repo.js', () => ({
  session: vi.fn(),
  documents: vi.fn(async () => ({ revision: 0, items: [] })),
  document: vi.fn(async () => ({
    title: 'Example',
    html: '<!doctype html><html><body><script>document.body.dataset.ran="yes"</script></body></html>',
  })),
  upload: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001' })),
  decide: vi.fn(async () => true),
}))

async function fixture({
  required = false,
  role = 'member',
  joined = true,
}: { required?: boolean; role?: 'head' | 'member'; joined?: boolean } = {}) {
  const state = createFakeState()
  const password = 'OnboardingExampleOnly-Aa123!'
  const user = await seedUser(state, {
    password,
    onboardingRequired: required,
  })
  if (joined)
    state.memberships.push({
      userId: user.id,
      departmentId: randomUUID(),
      departmentName: 'Example',
      status: 'active',
      role,
    })
  const { app } = await buildTestApp(state)
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: user.login, password },
  })
  const cookies = parseSetCookies(login.headers['set-cookie'])
  return {
    app,
    headers: {
      cookie: cookieHeader(cookies),
      'x-csrf-token': cookies['devon_csrf']!,
    },
  }
}

describe('onboarding access', () => {
  it('blocks direct normal-portal requests but leaves account setup reachable', async () => {
    const { app, headers } = await fixture({ required: true })
    const blocked = await app.inject({ url: '/api/v1/cards', headers })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.headers['x-devon-setup-required']).toBe('true')
    const me = await app.inject({ url: '/api/v1/me', headers })
    expect(me.statusCode).toBe(200)
    expect(me.json().onboardingRequired).toBe(true)
    expect((await app.inject({ url: '/api/v1/onboarding/documents', headers })).statusCode).toBe(
      200,
    )
    await app.close()
  })
  it('does not start onboarding before an active department exists', async () => {
    const { app, headers } = await fixture({ required: true, joined: false })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/onboarding/session',
          payload: {},
          headers,
        })
      ).statusCode,
    ).toBe(403)
    expect((await app.inject({ url: '/api/v1/me', headers })).json().activeDepartmentId).toBeNull()
    await app.close()
  })
  it('allows members to submit HTML but refuses publication by a member', async () => {
    const { app, headers } = await fixture()
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/documents',
      headers,
      payload: {
        title: 'Welcome',
        filename: 'welcome.html',
        html: '<main>Hello</main>',
      },
    })
    expect(uploaded.statusCode).toBe(201)
    const result = await app.inject({
      method: 'POST',
      url: `/api/v1/onboarding/documents/${uploaded.json().id}/decision`,
      headers,
      payload: { action: 'publish', revision: 0 },
    })
    expect(result.statusCode).toBe(403)
    await app.close()
  })
  it('requires CSRF for upload and publication, including department heads', async () => {
    const { app, headers } = await fixture({ role: 'head' })
    const url = '/api/v1/onboarding/documents/00000000-0000-4000-8000-000000000001/decision'
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie: headers.cookie },
          payload: { action: 'publish', revision: 0 },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { action: 'publish', revision: 0 },
        })
      ).statusCode,
    ).toBe(200)
    await app.close()
  })
  it('serves executable HTML only inside a response-level opaque sandbox', async () => {
    const { app, headers } = await fixture()
    const result = await app.inject({
      url: '/api/v1/onboarding/documents/00000000-0000-4000-8000-000000000001/render',
      headers,
    })
    expect(result.statusCode).toBe(200)
    expect(result.headers['content-type']).toContain('text/html')
    const csp = String(result.headers['content-security-policy'])
    expect(csp).toContain('sandbox allow-scripts;')
    expect(csp).not.toContain('allow-same-origin')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(result.headers['cache-control']).toContain('no-store')
    await app.close()
  })
})

describe('saved setup completion', () => {
  const complete = {
    telegram: true,
    givenName: 'Aziz',
    familyName: 'Yusupov',
    title: 'chief_specialist',
    dateOfBirth: '1995-05-10',
    workStartDate: '2020-09-01',
    professional: {
      about: 'Public services specialist',
      skills: ['Analysis'],
      experience: [{ organization: 'Example office', role: 'Specialist' }],
    },
    personnel: {
      fio: 'Азиз Юсупов',
      birthDate: '1995-05-10',
      birthPlace: 'Тошкент',
      nationality: 'ўзбек',
      eduLevel: 'олий',
      specialty: 'иқтисодчи',
      work: [{ from: '2020', text: 'Мутахассис' }],
    },
  }
  it('requires real saved content, not just an object or version number', () => {
    expect(Object.values(onboardingFacts(complete)).every(Boolean)).toBe(true)
    expect(
      onboardingFacts({
        ...complete,
        telegram: false,
        professional: {},
        personnel: {},
      }),
    ).toEqual({
      telegram: false,
      account: true,
      resume: false,
      personnel: false,
    })
    expect(onboardingFacts({ ...complete, title: null }).account).toBe(false)
    expect(onboardingFacts({ ...complete, workStartDate: null }).account).toBe(false)
    expect(
      onboardingFacts({
        ...complete,
        professional: { about: '  ', skills: [], education: [{}] },
      }).resume,
    ).toBe(false)
  })
  it('accepts a real work start date and rejects impossible dates', () => {
    expect(patchProfileBodySchema.safeParse({ workStartDate: '2026-11-25' }).success).toBe(true)
    expect(patchProfileBodySchema.safeParse({ workStartDate: null }).success).toBe(true)
    expect(patchProfileBodySchema.safeParse({ workStartDate: '2026-02-30' }).success).toBe(false)
    expect(patchProfileBodySchema.safeParse({ workStartDate: '1899-01-01' }).success).toBe(false)
  })
})
