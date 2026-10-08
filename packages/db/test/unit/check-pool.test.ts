import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createCheckPool } from '../checks/pool.js'

vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Pool: class extends EventEmitter {
      end = vi.fn(async () => {})
    },
  }
})

describe('migration check pool cleanup', () => {
  it('waits for every socket after pg-pool end resolves, with idempotent cleanup', async () => {
    const checked = createCheckPool({})
    const first = new EventEmitter()
    const second = new EventEmitter()
    checked.pool.emit('connect', first)
    checked.pool.emit('connect', second)
    const finished = vi.fn()
    const closing = checked.close()
    expect(checked.close()).toBe(closing)
    void closing.then(finished)
    await Promise.resolve()
    first.emit('end')
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    second.emit('end')
    await closing
    expect(finished).toHaveBeenCalledTimes(1)
    expect(checked.pool.end).toHaveBeenCalledTimes(1)
  })

  it('reports background errors as a failed check without exposing the client or error body', async () => {
    const checked = createCheckPool({})
    const error = Object.assign(new Error('private connection password'), { code: '57P01' })
    expect(() => checked.pool.emit('error', error, { password: 'secret' })).not.toThrow()
    await expect(checked.close()).rejects.toThrow(/^check pool background error \(57P01\)$/)
  })
})
