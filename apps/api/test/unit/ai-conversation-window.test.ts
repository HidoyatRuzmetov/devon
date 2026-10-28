import { describe, expect, it } from 'vitest'
import { titleRelevance } from '../../src/modules/ai/context-relevance.js'
import type { DepartmentChatContext } from '../../src/modules/ai/conversation-context.js'
import { conversationWindow } from '../../src/modules/ai/conversation-window.js'

const context: DepartmentChatContext = {
  generatedAt: '2026-10-26T00:00:00Z',
  recordsIncluded: 2,
  recordsTotal: 2,
  limited: false,
  totals: { active: 2 },
  sources: [],
  snapshot: [
    {
      ref: 'card:one',
      title: 'Release',
      facts: {
        description: 'release evidence '.repeat(200),
        checklist: [{ id: 'item-one', text: 'Approval' }],
      },
    },
    {
      ref: 'card:two',
      title: 'Research',
      facts: { description: 'research evidence '.repeat(200) },
    },
  ],
  evidence: [
    { ref: 'attachment:one', name: 'report.txt', parent: 'card:one', text: 'FILE EVIDENCE' },
  ],
}
describe('progressive authorized context', () => {
  it('keeps records discoverable when their body could not fit and recognizes embedded task headings', () => {
    const bounded = {
      ...context,
      directory: [...context.snapshot, { ref: 'card:three', title: 'Service audit' }],
      limited: true,
    }
    const result = conversationWindow(bounded, 'Hello', new Set(), new Set())
    expect(result.snapshot.directoryColumns).toEqual(['ref', 'title'])
    expect(result.snapshot.directory).toContainEqual(['card:three', 'Service audit'])
    expect(
      titleRelevance('Service audit', '1. Service audit\n a. Read evidence\n2. Training launch'),
    ).toBe(2)
    expect(titleRelevance('Other review', '1. Service audit\n a. Read evidence')).toBe(0)
    expect(result.snapshot.limited).toBe(true)
  })
  it('retains complete totals and a discoverable directory without loading unrelated bodies', () => {
    const result = conversationWindow(context, 'Hello', new Set(), new Set())
    expect(result.snapshot.snapshot).toHaveLength(0)
    expect(result.snapshot.directory).toHaveLength(2)
    expect(result.snapshot.totals).toEqual({ active: 2 })
    expect(JSON.stringify(result)).not.toContain('FILE EVIDENCE')
    expect(result.snapshot.limited).toBe(true)
  })
  it('expands child references, related attachments and exact action schemas without adding foreign refs', () => {
    const result = conversationWindow(
      context,
      '',
      new Set(['checklist:item-one', 'card:foreign']),
      new Set(['checklist.update']),
    )
    expect(result.snapshot.snapshot).toEqual([context.snapshot[0]])
    expect(JSON.stringify(result)).toContain('FILE EVIDENCE')
    expect(result.actions.find((a) => a.kind === 'checklist.update')).toHaveProperty('arguments')
    expect(result.actions.find((a) => a.kind === 'page.create')).not.toHaveProperty('arguments')
    expect(JSON.stringify(result)).not.toContain('card:foreign')
  })
  it('can restore every admitted record, file and action definition for broad requests', () => {
    const result = conversationWindow(context, '', new Set(), new Set(), true)
    expect(result.snapshot.snapshot).toEqual(context.snapshot)
    expect(result.snapshot.evidence).toEqual(context.evidence)
    expect(result.actions.every((action) => 'arguments' in action)).toBe(true)
    expect(result.snapshot.limited).toBe(false)
  })
})
