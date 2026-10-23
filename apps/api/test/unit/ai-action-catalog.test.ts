import { describe, expect, it } from 'vitest'
import { parseAction } from '../../src/modules/ai/action-catalog.js'

describe('AI action argument preservation', () => {
  it('rejects incorrectly nested attachment IDs instead of silently creating a page without them', () => {
    expect(() =>
      parseAction('page.create', {
        body: { title: 'Phonebook', attachmentIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] },
      }),
    ).toThrow('body.attachmentIds')
  })
  it('rejects unknown fields on nested array entries', () => {
    expect(() =>
      parseAction('card.create', {
        body: {
          title: 'Evidence',
          links: [
            {
              url: 'https://example.com',
              title: 'Evidence',
              favicon: null,
              wrong: 'do not silently drop',
            },
          ],
        },
      }),
    ).toThrow('body.links.0.wrong')
  })
  it('preserves supported defaults and trimming with correctly placed attachments', () => {
    const attachmentIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
    expect(parseAction('page.create', { body: { title: '  Phonebook  ' }, attachmentIds })).toEqual(
      { body: { title: 'Phonebook', kind: 'note' }, attachmentIds },
    )
  })
  it('rejects prototype names and unknown operations before dispatch', () => {
    for (const name of ['__proto__', 'constructor', 'database.delete'])
      expect(() => parseAction(name, {})).toThrow('unsupported_action')
  })
})
