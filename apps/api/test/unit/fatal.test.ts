// H16.1: the process-fatal handlers log one structured line and exit 1.
import { describe, expect, it } from 'vitest'
import { formatFatal, installFatalHandlers, type FatalTarget } from '../../src/lib/fatal.js'

function fakeProcess() {
  const listeners = new Map<string, (value: unknown) => void>()
  const exits: number[] = []
  const target: FatalTarget = {
    on(event, listener) {
      listeners.set(event, listener)
      return target
    },
    exit(code: number): never {
      exits.push(code)
      // Real `process.exit` never returns; the fake must not either, or the code under test would
      // keep running past a point it never reaches in production.
      throw new Error(`__exit_${code}__`)
    },
    exitCode: undefined,
  }
  return { target, listeners, exits }
}

function fire(kind: 'unhandledRejection' | 'uncaughtException', value: unknown) {
  const { target, listeners, exits } = fakeProcess()
  const lines: string[] = []
  installFatalHandlers(target, (line) => lines.push(line))
  expect(listeners.has(kind)).toBe(true)
  expect(() => listeners.get(kind)!(value)).toThrow('__exit_1__')
  return { lines, exits, target }
}

describe('formatFatal (H16.1)', () => {
  it('is one line of parseable JSON at pino fatal level', () => {
    const line = formatFatal('unhandledRejection', new Error('boom'), 1_700_000_000_000)
    expect(line).not.toContain('\n')
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed['level']).toBe(60)
    expect(parsed['time']).toBe(1_700_000_000_000)
    expect(parsed['msg']).toBe('fatal: unhandledRejection')
  })

  it('carries the error type, message and stack', () => {
    const err = new TypeError('cannot read x of undefined')
    const parsed = JSON.parse(formatFatal('uncaughtException', err)) as {
      err: { type: string; message: string; stack?: string }
    }
    expect(parsed.err.type).toBe('TypeError')
    expect(parsed.err.message).toBe('cannot read x of undefined')
    expect(parsed.err.stack).toContain('TypeError')
  })

  it('survives a rejection with a non-Error value (the common `reject("nope")` case)', () => {
    const parsed = JSON.parse(formatFatal('unhandledRejection', 'nope')) as {
      err: { type: string; message: string; stack?: string }
    }
    expect(parsed.err.type).toBe('string')
    expect(parsed.err.message).toBe('nope')
    expect(parsed.err.stack).toBeUndefined()
  })

  it('survives a rejection with undefined', () => {
    const parsed = JSON.parse(formatFatal('unhandledRejection', undefined)) as {
      err: { message: string }
    }
    expect(parsed.err.message).toBe('undefined')
  })
})

describe('installFatalHandlers (H16.1)', () => {
  it('registers both process events', () => {
    const { target, listeners } = fakeProcess()
    installFatalHandlers(target, () => {})
    expect([...listeners.keys()].sort()).toEqual(['uncaughtException', 'unhandledRejection'])
  })

  it('an unhandled rejection logs once and exits 1 -- it does not keep serving', () => {
    const { lines, exits, target } = fire('unhandledRejection', new Error('boom'))
    expect(lines).toHaveLength(1)
    expect(exits).toEqual([1])
    expect(target.exitCode).toBe(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 60, msg: 'fatal: unhandledRejection' })
  })

  it('an uncaught exception logs once and exits 1', () => {
    const { lines, exits } = fire('uncaughtException', new Error('boom'))
    expect(lines).toHaveLength(1)
    expect(exits).toEqual([1])
    expect(JSON.parse(lines[0]!)).toMatchObject({ msg: 'fatal: uncaughtException' })
  })

  it('sets exitCode before calling exit, so a truncated stderr write still leaves status 1', () => {
    const listeners = new Map<string, (value: unknown) => void>()
    let exitCodeAtExit: unknown = 'never called'
    const target: FatalTarget = {
      on(event, listener) {
        listeners.set(event, listener)
        return target
      },
      exit(): never {
        exitCodeAtExit = target.exitCode
        throw new Error('__exit__')
      },
      exitCode: undefined,
    }
    installFatalHandlers(target, () => {})
    expect(() => listeners.get('uncaughtException')!(new Error('boom'))).toThrow('__exit__')
    expect(exitCodeAtExit).toBe(1)
  })
})
