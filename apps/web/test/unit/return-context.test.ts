import { describe, expect, it } from 'vitest'
import { returnContextParams } from '../../src/lib/return-context.js'

describe('drill-in return context', () => {
  const id = 'bfbf5d9b-1ae7-4a2c-9da8-415639821045'
  it('keeps a saved assistant thread through nested record and view links', () => {
    expect(
      returnContextParams(
        new URLSearchParams(`from=assistant&conversation=${id}&q=private`),
      ).toString(),
    ).toBe(`from=assistant&conversation=${id}`)
  })
  it('retains older overview return links while discarding unknown origins and malformed IDs', () => {
    expect(
      returnContextParams(new URLSearchParams(`from=overview&conversation=${id}`)).get(
        'conversation',
      ),
    ).toBe(id)
    expect(
      returnContextParams(new URLSearchParams('from=assistant&conversation=invalid')).toString(),
    ).toBe('from=assistant')
    expect(
      returnContextParams(new URLSearchParams(`from=https://example.com&conversation=${id}`)).size,
    ).toBe(0)
  })
})
