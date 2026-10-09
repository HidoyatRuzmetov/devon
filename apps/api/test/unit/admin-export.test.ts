import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTestApp, cookieHeader, parseSetCookies } from './test-app.js'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import * as repo from '../../src/modules/admin/repo.js'
afterEach(() => vi.restoreAllMocks())
describe('admin export preflight', () => {
  it('refuses an oversized matching export before emitting a partial CSV', async () => {
    const state = createFakeState()
    await seedUser(state, {
      login: 'export.admin',
      password: 'Str0ngExampleValue123',
      role: 'super_admin',
    })
    const { app } = await buildTestApp(state)
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'export.admin', password: 'Str0ngExampleValue123' },
    })
    const cookie = cookieHeader(parseSetCookies(login.headers['set-cookie']))
    const record = vi.spyOn(repo, 'recordAuditExport').mockResolvedValue()
    const snapshot = vi
      .spyOn(repo, 'getAuditExportSnapshot')
      .mockResolvedValue({ count: 200001, throughSeq: 300000 })
    const page = vi.spyOn(repo, 'listAuditEvents')
    try {
      const result = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit/export?category=admin&from=2026-10-01&cursor=99&limit=1',
        headers: { cookie },
      })
      expect(result.statusCode).toBe(422)
      expect(result.headers['content-type']).toContain('application/problem+json')
      expect(result.json().errors).toContainEqual({ path: 'export', code: 'too_many_events' })
      expect(snapshot).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'admin', from: '2026-10-01' }),
        200000,
      )
      expect(record).toHaveBeenCalledOnce()
      expect(page).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
