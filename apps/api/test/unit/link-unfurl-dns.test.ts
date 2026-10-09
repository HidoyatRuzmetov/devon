import { afterEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: boundary.lookup }))
vi.mock('node:http', () => ({ request: boundary.request }))
vi.mock('node:https', () => ({ request: boundary.request }))
import { unfurlLink, UnsafeUrlError } from '../../src/modules/work/link-unfurl.js'

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('unfurl network failure and unsafe address boundary', () => {
  it('preserves a long URL target while bounding its fallback display title for card writes', async () => {
    boundary.lookup.mockRejectedValue(new Error('controlled DNS failure'))
    const url = `https://example.org/report?details=${'x'.repeat(500)}`
    await expect(unfurlLink(url)).resolves.toEqual({ url, title: url.slice(0, 300), favicon: null })
    expect(boundary.request).not.toHaveBeenCalled()
  })
  it('falls back to the URL when DNS is unavailable without starting HTTP', async () => {
    boundary.lookup.mockRejectedValue(
      Object.assign(new Error('controlled DNS failure'), { code: 'EAI_AGAIN' }),
    )
    const url = 'https://example.org/reference'
    await expect(unfurlLink(url)).resolves.toEqual({ url, title: url, favicon: null })
    expect(boundary.request).not.toHaveBeenCalled()
  })
  it('bounds a resolver that never answers and never starts HTTP', async () => {
    vi.useFakeTimers()
    boundary.lookup.mockReturnValue(new Promise(() => {}))
    const url = 'https://example.org/slow-dns'
    const result = unfurlLink(url)
    await vi.advanceTimersByTimeAsync(4000)
    await expect(result).resolves.toEqual({ url, title: url, favicon: null })
    expect(boundary.request).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('refuses a mixed public/private DNS answer rather than falling back or fetching', async () => {
    boundary.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    await expect(unfurlLink('https://example.org/rebinding')).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(boundary.request).not.toHaveBeenCalled()
  })
  it('does not start a late HTTP request after a resolver finishes beyond the deadline', async () => {
    vi.useFakeTimers()
    let answer!: (value: { address: string; family: number }[]) => void
    boundary.lookup.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const url = 'https://example.org/late-dns'
    const result = unfurlLink(url)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toEqual({ url, title: url, favicon: null })
    answer([{ address: '93.184.216.34', family: 4 }])
    await vi.runAllTimersAsync()
    expect(boundary.request).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
