// `src/bootstrap/graceful-shutdown.ts` (H18.1 / H13.1). A fake `process` -- an EventEmitter with a
// recording `exit` -- and a fake logger stand in for the real ones, so the signal path, the
// double-signal guard, the force-exit timer and the exit codes are asserted without ever signalling
// the vitest worker. The last case wires the handler to a real `buildApp()` instance to prove a
// signal reaches Fastify's `onClose` hooks, which is what `server.ts` relies on to stop its workers.
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app.js'
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  registerGracefulShutdown,
  type ShutdownSignal,
} from '../../src/bootstrap/graceful-shutdown.js'
import { createFakeDeps, createFakeState } from './fake-deps.js'
import { testConfig } from './test-app.js'

function fakeProcess() {
  const emitter = new EventEmitter()
  const exits: number[] = []
  return {
    emitter,
    exits,
    proc: {
      on: (signal: ShutdownSignal, listener: () => void) => emitter.on(signal, listener),
      exit: (code: number) => {
        exits.push(code)
      },
    },
    /** Node passes the signal name to signal listeners; mirror that. */
    send: (signal: ShutdownSignal) => emitter.emit(signal, signal),
  }
}

function fakeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

/** A `close()` the test settles by hand. */
function deferred() {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('registerGracefulShutdown (H18.1 graceful shutdown)', () => {
  it('listens for SIGTERM and SIGINT on the given process', () => {
    const { proc, emitter } = fakeProcess()
    registerGracefulShutdown({ close: async () => {}, log: fakeLog(), proc })
    expect(emitter.listenerCount('SIGTERM')).toBe(1)
    expect(emitter.listenerCount('SIGINT')).toBe(1)
  })

  it('on SIGTERM closes once, logs start and end, and exits 0', async () => {
    const { proc, exits, send } = fakeProcess()
    const log = fakeLog()
    const close = vi.fn(async () => {})
    const handle = registerGracefulShutdown({ close, log, proc })
    expect(handle.inProgress).toBe(false)

    send('SIGTERM')
    expect(handle.inProgress).toBe(true)
    await vi.waitFor(() => expect(exits).toEqual([0]))

    expect(close).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenNthCalledWith(
      1,
      { signal: 'SIGTERM', timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS },
      'shutdown: signal received, closing',
    )
    expect(log.info).toHaveBeenNthCalledWith(2, { signal: 'SIGTERM' }, 'shutdown: closed cleanly')
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('a repeated signal while closing is logged and ignored: close() once, exit once', async () => {
    const { proc, exits, send } = fakeProcess()
    const log = fakeLog()
    const gate = deferred()
    const close = vi.fn(() => gate.promise)
    registerGracefulShutdown({ close, log, proc })

    send('SIGTERM')
    send('SIGTERM')
    send('SIGINT')
    expect(close).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenLastCalledWith(
      { signal: 'SIGINT' },
      'shutdown: already in progress, ignoring repeated signal',
    )
    expect(exits).toEqual([])

    gate.resolve()
    await vi.waitFor(() => expect(exits).toEqual([0]))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('force-exits 1 when close() outlives the timeout; a late close() cannot exit again', async () => {
    vi.useFakeTimers()
    const { proc, exits, send } = fakeProcess()
    const log = fakeLog()
    const gate = deferred()
    registerGracefulShutdown({ close: () => gate.promise, log, proc, timeoutMs: 25_000 })

    send('SIGTERM')
    await vi.advanceTimersByTimeAsync(24_999)
    expect(exits).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(exits).toEqual([1])
    expect(log.error).toHaveBeenCalledWith(
      { signal: 'SIGTERM', timeoutMs: 25_000 },
      'shutdown: close did not finish in time, forcing exit',
    )

    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(exits).toEqual([1])
    expect(log.info).not.toHaveBeenCalledWith({ signal: 'SIGTERM' }, 'shutdown: closed cleanly')
  })

  it('exits 1 and logs the error when close() rejects', async () => {
    const { proc, exits, send } = fakeProcess()
    const log = fakeLog()
    const boom = new Error('hook failed')
    registerGracefulShutdown({ close: () => Promise.reject(boom), log, proc })

    send('SIGINT')
    await vi.waitFor(() => expect(exits).toEqual([1]))
    expect(log.error).toHaveBeenCalledWith(
      { err: boom, signal: 'SIGINT' },
      'shutdown: close failed',
    )
  })

  it('clears the force-exit timer after a clean close, so nothing fires later', async () => {
    vi.useFakeTimers()
    const { proc, exits } = fakeProcess()
    const handle = registerGracefulShutdown({
      close: async () => {},
      log: fakeLog(),
      proc,
      timeoutMs: 1_000,
    })

    await handle.trigger('SIGTERM')
    expect(exits).toEqual([0])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(exits).toEqual([0])
  })

  it('a signal reaches a real Fastify app: its onClose hooks run, then the process exits 0', async () => {
    // Same order as `server.ts`: the worker-stopping hook is registered before the app starts, the
    // signal handler is wired after -- Fastify refuses `addHook` once it is listening/ready.
    const app = await buildApp(createFakeDeps(createFakeState()), testConfig())
    const stopped: string[] = []
    app.addHook('onClose', async () => {
      stopped.push('worker')
    })
    await app.ready()
    const { proc, exits, send } = fakeProcess()
    registerGracefulShutdown({ close: () => app.close(), log: fakeLog(), proc })

    const before = await app.inject({ method: 'GET', url: '/healthz' })
    expect(before.statusCode).toBe(200)

    send('SIGTERM')
    await vi.waitFor(() => expect(exits).toEqual([0]))
    expect(stopped).toEqual(['worker'])
  })
})
