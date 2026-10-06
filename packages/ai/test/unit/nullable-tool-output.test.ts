import { describe, expect, it } from 'vitest'
import { runFeature } from '../../src/features.js'
import { loadAiConfig } from '../../src/config.js'
import { MockProvider } from '../../src/mock-provider.js'
import { normalizeToolArguments } from '../../src/normalize-tool-arguments.js'

describe('GLM nullable tool output compatibility', () => {
  it('accepts the observed quick-add wire response on the first call without inventing a deadline', async () => {
    const provider = new MockProvider({
      script: [
        {
          content: '',
          reasoningContent: null,
          finishReason: 'tool_calls',
          usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
          toolCalls: [
            {
              id: 'call-1',
              name: 'emit_quick_add',
              argumentsJson: JSON.stringify({
                title: 'WorkPortal patch v1',
                assigneeUserId: 'u1',
                dueDate: 'None',
                projectId: 'None',
                priority: 'none',
                labelIds: [],
                confidence: { assignee: 'high', dueDate: 'high', priority: 'high' },
                ambiguous: [],
                notes: '',
              }),
            },
          ],
        },
      ],
    })
    const result = await runFeature({
      provider,
      config: loadAiConfig({}),
      feature: 'quick_add_parse',
      input: {
        locale: 'en',
        text: 'Nodira: WorkPortal patch v1',
        today: '2026-10-06',
        members: [{ userId: 'u1', fullName: 'Nodira Karimova', givenName: 'Nodira', handle: null }],
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.data).toMatchObject({
        title: 'WorkPortal patch v1',
        assigneeUserId: 'u1',
        dueDate: null,
        projectId: null,
        priority: 'none',
      })
    expect(provider.calls).toHaveLength(1)
  })
  it('normalizes nested nullable fields without altering prose or non-nullable enums', () => {
    expect(
      normalizeToolArguments(
        { title: 'None', priority: 'none', actions: [{ date: 'null', text: 'None' }] },
        {
          type: 'object',
          properties: {
            title: { type: 'string' },
            priority: { type: 'string' },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: { date: { type: ['string', 'null'] }, text: { type: 'string' } },
              },
            },
          },
        },
      ),
    ).toEqual({ title: 'None', priority: 'none', actions: [{ date: null, text: 'None' }] })
  })
  it('leaves malformed dates for validation rather than silently discarding them', () => {
    expect(normalizeToolArguments('2026-99-99', { type: ['string', 'null'] })).toBe('2026-99-99')
    expect(normalizeToolArguments('', { type: ['string', 'null'] })).toBe('')
  })
})
