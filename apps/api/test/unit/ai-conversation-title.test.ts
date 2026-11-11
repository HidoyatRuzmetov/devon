import { describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@devon/db'
import { generateConversationTitle } from '../../src/modules/ai/generate-conversation-title.js'
import { runDepartmentChatForActor } from '../../src/modules/ai/service.js'

vi.mock('../../src/modules/ai/service.js', () => ({ runDepartmentChatForActor: vi.fn() }))
const run = vi.mocked(runDepartmentChatForActor)
const ctx = { requestId: 'title-unit-test' } as RequestContext
const answer = (content: string) => ({ content, citations: [], actions: [] })

describe('private conversation titles', () => {
  it('uses a representative sample of this chat and strips linked records and credentials', async () => {
    run.mockResolvedValueOnce(answer('«Форматы недельного отчёта»'))
    const messages = [
      { role: 'assistant' as const, content: 'private seeded department briefing' },
      { role: 'user' as const, content: 'Help with https://internal.test/secret and me@work.test' },
      ...Array.from({ length: 22 }, (_, i) => ({ role: 'user' as const, content: 'turn ' + i })),
      { role: 'user' as const, content: 'Compare weekly reports. api_key=SECRET' },
      { role: 'assistant' as const, content: 'There are two report formats.' },
    ]
    expect(await generateConversationTitle(ctx, 'ru', messages)).toBe('Форматы недельного отчёта')
    const input = run.mock.lastCall![1]
    expect(input.locale).toBe('ru')
    expect(input.maxTokens).toBe(1024)
    const sample = JSON.parse(input.messages[1]!.content!)
    expect(sample.requests).toHaveLength(6)
    expect(sample.requests[0]).toContain('[link]')
    expect(sample.requests.at(-1)).toContain('Compare weekly reports')
    expect(sample.replies).toEqual(['There are two report formats.'])
    expect(JSON.stringify(sample)).not.toMatch(/private seeded|internal\.test|me@work|SECRET/u)
  })

  it.each(['Contact me@agency.test', 'Two\nlines', 'A'.repeat(65), 'https://private.test'])(
    'rejects invalid model output instead of publishing it: %s',
    async (output) => {
      run.mockResolvedValueOnce(answer(output))
      await expect(
        generateConversationTitle(ctx, 'en', [{ role: 'user', content: 'Plan a meeting' }]),
      ).rejects.toThrow('invalid_conversation_title')
    },
  )

  it('skips empty drafts and can name an actual briefing-only conversation', async () => {
    const calls = run.mock.calls.length
    await expect(generateConversationTitle(ctx, 'en', [])).rejects.toThrow('empty_conversation')
    expect(run).toHaveBeenCalledTimes(calls)
    run.mockResolvedValueOnce(answer('Weekly permit review'))
    expect(
      await generateConversationTitle(ctx, 'en', [
        { role: 'assistant', content: 'The main work this week was permit review.' },
      ]),
    ).toBe('Weekly permit review')
  })
})
