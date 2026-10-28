import { describe, expect, it } from 'vitest'
import { returnContextParams, returnDestination } from '../../src/lib/return-context.js'

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
  it('returns to the selected calendar month or member cycle without accepting arbitrary destinations', () => {
    expect(returnDestination(new URLSearchParams('from=personal&month=2026-11'))).toBe(
      '/personal?tab=calendar&month=2026-11',
    )
    expect(
      returnDestination(
        new URLSearchParams(`from=analytics&cycle=${id}&member=${id}&month=2026-11`),
      ),
    ).toBe(`/analytics?cycle=${id}&member=${id}`)
    expect(returnDestination(new URLSearchParams('from=personal&month=2026-99'))).toBe(
      '/personal?tab=calendar',
    )
    expect(returnDestination(new URLSearchParams('from=https://evil.invalid'))).toBe('/')
    expect(returnDestination(new URLSearchParams(`from=assistant&conversation=${id}`))).toBe(
      `/assistant?conversation=${id}`,
    )
  })
})
