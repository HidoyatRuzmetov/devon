// H13.1 "graceful shutdown drains in-flight requests and jobs" / "safe restart". Exercises
// `registerGracefulShutdown` against a real `buildApp()` (fake `Deps`, no Postgres -- `closePool()`
// is a documented no-op when `@devon/db`'s module-private pool was never created, which is exactly
// this test's situation) rather than mocking Fastify, so this asserts against the real `app.close()`
// behaviour these signal handlers depend on.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../src/app.js'
import { createFakeDeps, createFakeState } from '../fake-deps.js'
import { testConfig } from '../test-app.js'
import { registerGracefulShutdown } from '../../../src/plugins/shutdown.js'

async function buildTestApp() {
  const state = createFakeState()
  const deps = createFakeDeps(state)
  return buildApp(deps, testConfig())
}

describe('registerGracefulShutdown', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // `vi.waitFor`'s options and each `it()`'s own timeout below are deliberately generous (well past
  // what this needs on an idle machine): the full `unit` gate runs every test file's worker threads
  // concurrently, each one building a real Fastify app, and this file's default 5000ms budget was
  // observed to flake under that contention even though every assertion here settles in well under
  // 200ms in isolation -- these numbers are about tolerating CI-level parallel load, not this test's
  // own logic being slow.

  it('drains (app.close) and exits 0 on SIGTERM, exactly once', async () => {
    const app = await buildTestApp()
    const closeSpy = vi.spyOn(app, 'close')
    const exit = vi.fn()
    const handle = registerGracefulShutdown(app, { exit, timeoutMs: 5000 })

    process.emit('SIGTERM')
    // `shutdown()` is async; give its promise chain a tick to run `app.close()` + `closePool()`.
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1), { timeout: 10_000 })

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)

    // A second signal while already (or just having finished) draining must never double-close.
    process.emit('SIGTERM')
    await new Promise((r) => setTimeout(r, 10))
    expect(closeSpy).toHaveBeenCalledTimes(1)

    handle.unregister()
  }, 15_000)

  it('SIGINT drains the same way as SIGTERM', async () => {
    const app = await buildTestApp()
    const closeSpy = vi.spyOn(app, 'close')
    const exit = vi.fn()
    const handle = registerGracefulShutdown(app, { exit, timeoutMs: 5000 })

    process.emit('SIGINT')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1), { timeout: 10_000 })

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
    handle.unregister()
  }, 15_000)

  it('forces exit(1) if the drain does not finish before the deadline', async () => {
    const app = await buildTestApp()
    // Simulate a wedged close (e.g. a hung in-flight request) that never resolves in time -- this
    // promise is NEVER meant to settle, so nothing below may `await` it again (a `.catch()` on a
    // promise that never rejects still hangs forever; the point of the force-exit timer is
    // precisely that production never has to wait for it either).
    vi.spyOn(app, 'close').mockImplementation(
      (() => new Promise<undefined>(() => {})) as FastifyInstance['close'],
    )
    const exit = vi.fn()
    const handle = registerGracefulShutdown(app, { exit, timeoutMs: 20 })

    process.emit('SIGTERM')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1), { timeout: 10_000 })

    expect(exit).toHaveBeenCalledWith(1)
    handle.unregister()
    // Deliberately no `app.close()` here: `close` is permanently mocked to hang for this instance,
    // and this fake-deps-backed app holds no real socket/connection that needs releasing.
  }, 15_000)

  it('unregister() removes the listeners so a later signal does nothing', async () => {
    const app = await buildTestApp()
    const closeSpy = vi.spyOn(app, 'close')
    const exit = vi.fn()
    const handle = registerGracefulShutdown(app, { exit, timeoutMs: 5000 })
    handle.unregister()

    process.emit('SIGTERM')
    await new Promise((r) => setTimeout(r, 50))

    expect(closeSpy).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    await app.close()
  }, 15_000)
})
