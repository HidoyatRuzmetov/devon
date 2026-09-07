import { describe, expect, it } from 'vitest'
import { MockProvider } from '../../src/mock-provider.js'
import type { ChatCompletionRequest, ChatCompletionResult } from '../../src/types.js'

const REQUEST: ChatCompletionRequest = {
  model: 'glm-5.2',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 1024,
}

const RESULT_A: ChatCompletionResult = {
  content: 'a',
  reasoningContent: null,
  toolCalls: [],
  finishReason: 'stop',
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
}
const RESULT_B: ChatCompletionResult = { ...RESULT_A, content: 'b' }

describe('MockProvider — scripted mode', () => {
  it('returns each scripted response in order', async () => {
    const provider = new MockProvider({ script: [RESULT_A, RESULT_B] })
    await expect(provider.complete(REQUEST)).resolves.toEqual(RESULT_A)
    await expect(provider.complete(REQUEST)).resolves.toEqual(RESULT_B)
  })

  it('repeats the last scripted response once the script is exhausted', async () => {
    const provider = new MockProvider({ script: [RESULT_A] })
    await provider.complete(REQUEST)
    await expect(provider.complete(REQUEST)).resolves.toEqual(RESULT_A)
    await expect(provider.complete(REQUEST)).resolves.toEqual(RESULT_A)
  })

  it('records every request it was asked to answer', async () => {
    const provider = new MockProvider({ script: [RESULT_A] })
    await provider.complete(REQUEST)
    expect(provider.calls).toEqual([REQUEST])
  })
})

describe('MockProvider — respond mode', () => {
  it('delegates to the given respond() function', async () => {
    const provider = new MockProvider({ respond: () => RESULT_B })
    await expect(provider.complete(REQUEST)).resolves.toEqual(RESULT_B)
  })
})

describe('MockProvider — misconfigured', () => {
  it('rejects when neither script nor respond is given', async () => {
    const provider = new MockProvider({})
    await expect(provider.complete(REQUEST)).rejects.toThrow()
  })
})
