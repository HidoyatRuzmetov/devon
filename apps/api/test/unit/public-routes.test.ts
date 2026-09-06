// design.md §1.6/§3.4: "A unit test walks app.printRoutes() [here: the equivalent `publicRoutes`
// tracker] and asserts the set of {public:true} routes equals a checked-in allow-list." and "Every
// route declares config.permission or the server throws at registration time."
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import authorizePlugin, { PUBLIC_ROUTES } from '../../src/plugins/authorize.js'
import { buildTestApp } from './test-app.js'

function sortRoutes(routes: readonly { method: string; url: string }[]) {
  return [...routes].map((r) => `${r.method} ${r.url}`).sort()
}

describe('the checked-in public-route allow-list', () => {
  it('matches exactly the routes registered with { public: true } in the real app', async () => {
    const { app } = await buildTestApp()
    expect(sortRoutes(app.publicRoutes)).toEqual(sortRoutes(PUBLIC_ROUTES))
    await app.close()
  })

  it('does not include an authenticated or admin route', () => {
    const urls = PUBLIC_ROUTES.map((r) => r.url)
    expect(urls).not.toContain('/api/v1/me')
    expect(urls).not.toContain('/api/v1/auth/logout')
    expect(urls.some((u) => u.startsWith('/api/v1/admin'))).toBe(false)
  })
})

describe('a route registered without config.permission fails the server at boot (H7.3)', () => {
  it('throws synchronously from onRoute, not lazily at request time', async () => {
    const app = Fastify()
    await app.register(authorizePlugin)

    expect(() => {
      app.get('/oops', async () => ({ ok: true }))
    }).toThrow(/missing config\.permission/)

    await app.close()
  })

  it('does not throw for a route that declares { public: true }', async () => {
    const app = Fastify()
    await app.register(authorizePlugin)

    expect(() => {
      app.get('/fine', { config: { permission: { public: true } } }, async () => ({ ok: true }))
    }).not.toThrow()

    await app.close()
  })
})
