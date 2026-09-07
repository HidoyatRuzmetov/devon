import { describe, expect, it } from 'vitest'
import { estimateTokens, trimHistory } from '../../src/trim.js'
import type { ChatMessage } from '../../src/types.js'

describe('estimateTokens', () => {
  it('is zero for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('scales with length at ~4 chars/token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })
})

describe('trimHistory', () => {
  const system: ChatMessage = { role: 'system', content: 'You are a helpful assistant.' }

  it('keeps everything when it already fits', () => {
    const messages: ChatMessage[] = [system, { role: 'user', content: 'hi' }]
    expect(trimHistory(messages, 10_000)).toEqual(messages)
  })

  it('always keeps the leading system message in full', () => {
    const messages: ChatMessage[] = [
      system,
      { role: 'user', content: 'a'.repeat(4000) },
      { role: 'assistant', content: 'b'.repeat(4000) },
      { role: 'user', content: 'the most recent message' },
    ]
    const trimmed = trimHistory(messages, 50)
    expect(trimmed[0]).toEqual(system)
  })

  it('drops the oldest non-system messages first, keeping the most recent', () => {
    const messages: ChatMessage[] = [
      system,
      { role: 'user', content: 'oldest' },
      { role: 'assistant', content: 'middle' },
      { role: 'user', content: 'newest' },
    ]
    const trimmed = trimHistory(messages, 20)
    expect(trimmed.at(-1)?.content).toBe('newest')
    expect(trimmed.some((m) => m.content === 'oldest')).toBe(false)
  })

  it('truncates rather than drops the newest message when even it alone does not fit', () => {
    const messages: ChatMessage[] = [system, { role: 'user', content: 'x'.repeat(1000) }]
    const trimmed = trimHistory(messages, 20)
    const last = trimmed.at(-1)
    expect(last).toBeDefined()
    expect((last?.content ?? '').length).toBeLessThan(1000)
  })

  it('handles no leading system message', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]
    expect(trimHistory(messages, 10_000)).toEqual(messages)
  })

  it('returns an empty array for empty input', () => {
    expect(trimHistory([], 1000)).toEqual([])
  })
})
