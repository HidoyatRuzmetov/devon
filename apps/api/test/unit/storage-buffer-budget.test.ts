import { EventEmitter } from 'node:events'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import {
  BUFFERED_TRANSFER_CAPACITY,
  BufferedTransferBudget,
  reserveBufferedTransfer,
} from '../../src/lib/storage/buffer-budget.js'

function response() {
  const incoming = Object.assign(new EventEmitter(), { aborted: false })
  const outgoing = Object.assign(new EventEmitter(), { destroyed: false })
  const req = { raw: incoming } as unknown as FastifyRequest
  const reply = { raw: outgoing, header: vi.fn(), type: vi.fn(), code: vi.fn(), send: vi.fn() }
  reply.header.mockReturnValue(reply)
  reply.type.mockReturnValue(reply)
  reply.code.mockReturnValue(reply)
  reply.send.mockReturnValue(reply)
  return { req, reply: reply as unknown as FastifyReply, incoming, outgoing }
}

describe('shared weighted transfer admission', () => {
  it('admits one 1 GiB file with two-copy headroom and refuses another byte until released', () => {
    const budget = new BufferedTransferBudget()
    const release = budget.acquire(1024 ** 3)!
    expect(budget.usedBytes).toBe(BUFFERED_TRANSFER_CAPACITY)
    expect(budget.acquire(1)).toBeNull()
    release()
    release()
    expect(budget.usedBytes).toBe(0)
    expect(budget.acquire(1024 ** 3)).toBeTypeOf('function')
  })
  it('adds weights across differently sized concurrent transfers', () => {
    const budget = new BufferedTransferBudget(100)
    const first = budget.acquire(30)!
    const second = budget.acquire(20)!
    expect(budget.acquire(1)).toBeNull()
    first()
    expect(budget.acquire(31)).toBeNull()
    const third = budget.acquire(30)!
    second()
    third()
    expect(budget.usedBytes).toBe(0)
  })
  it.each([-1, NaN, Infinity, 0.5])('refuses invalid size %s', (size) => {
    expect(new BufferedTransferBudget().acquire(size)).toBeNull()
  })
  it.each(['finish', 'close'])(
    'holds completed I/O until response %s and removes every listener',
    (event) => {
      const budget = new BufferedTransferBudget(100)
      const { req, reply, incoming, outgoing } = response()
      const transfer = reserveBufferedTransfer(req, reply, budget, 50)!
      const done = transfer.retain()!
      done()
      expect(budget.usedBytes).toBe(100)
      outgoing.emit(event)
      expect(budget.usedBytes).toBe(0)
      expect(incoming.listenerCount('aborted')).toBe(0)
      expect(outgoing.listenerCount('finish')).toBe(0)
      expect(outgoing.listenerCount('close')).toBe(0)
      expect(transfer.retain()).toBeNull()
    },
  )
  it('does not release aborted I/O until all retained operations settle', () => {
    const budget = new BufferedTransferBudget(100)
    const { req, reply, incoming, outgoing } = response()
    const transfer = reserveBufferedTransfer(req, reply, budget, 50)!
    const one = transfer.retain()!,
      two = transfer.retain()!
    incoming.emit('aborted')
    outgoing.emit('close')
    one()
    one()
    expect(budget.usedBytes).toBe(100)
    two()
    expect(budget.usedBytes).toBe(0)
  })
  it('rejects admission with a retryable response without allocating or installing listeners', () => {
    const budget = new BufferedTransferBudget(10)
    const { req, reply, outgoing } = response()
    expect(reserveBufferedTransfer(req, reply, budget, 6)).toBeNull()
    expect(reply.code).toHaveBeenCalledWith(503)
    expect(reply.header).toHaveBeenCalledWith('retry-after', '5')
    expect(budget.usedBytes).toBe(0)
    expect(outgoing.listenerCount('close')).toBe(0)
  })
})
