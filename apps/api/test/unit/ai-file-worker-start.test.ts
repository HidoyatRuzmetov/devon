import { describe, expect, it, vi } from 'vitest'
const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('node:worker_threads', () => ({
  Worker: class {
    constructor() {
      start()
      throw new Error('Synthetic worker startup failure')
    }
  },
}))
import { extractFileText } from '../../src/modules/ai/file-text.js'

describe('attachment worker startup recovery', () => {
  it('returns unavailable and releases the worker slot when construction throws', async () => {
    for (let index = 0; index < 3; index++)
      expect(await extractFileText(Buffer.from('text'), 'notes.txt')).toEqual({
        status: 'unavailable',
        text: '',
      })
    expect(start).toHaveBeenCalledTimes(3)
  })
})
