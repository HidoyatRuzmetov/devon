import { describe, expect, it } from 'vitest'
import { diffText, extractText } from '../../src/features/pages/diff.js'
function reconstruct(parts: ReturnType<typeof diffText>, side: 'before' | 'after') {
  return parts
    .filter((part) => part.type !== (side === 'before' ? 'added' : 'removed'))
    .map((part) => part.text)
    .join('')
}
describe('knowledge history preserves readable differences without unbounded allocation', () => {
  it.each([
    ['Same paragraph', 'Same paragraph'],
    ['', 'New content'],
    ['Removed content', ''],
    ['Original useful paragraph', 'Original better paragraph'],
    ['Oʻzbekiston\n\n  qator', 'Ўзбекистон\n\n  строка'],
  ])('reconstructs both documents: %s → %s', (before, after) => {
    const parts = diffText(before, after)
    expect(reconstruct(parts, 'before')).toBe(before)
    expect(reconstruct(parts, 'after')).toBe(after)
  })
  it('handles a valid6000-word document while preserving unchanged context and both complete versions', () => {
    const before = `Shared heading\n${'alpha '.repeat(6000)}\nShared ending`
    const after = `Shared heading\n${'bravo '.repeat(6000)}\nShared ending`
    const parts = diffText(before, after)
    expect(reconstruct(parts, 'before')).toBe(before)
    expect(reconstruct(parts, 'after')).toBe(after)
    expect(parts[0]).toMatchObject({
      type: 'same',
      text: expect.stringContaining('Shared heading'),
    })
    expect(parts.at(-1)).toMatchObject({
      type: 'same',
      text: expect.stringContaining('Shared ending'),
    })
  })
  it('extracts nested document text without repeating list text', () => {
    expect(
      extractText({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
              },
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
              },
            ],
          },
        ],
      }),
    ).toBe('First\nSecond')
  })
})
