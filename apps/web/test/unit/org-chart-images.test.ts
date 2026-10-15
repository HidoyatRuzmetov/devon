import { describe, expect, it, vi } from 'vitest'
import { inlineOrgChartPhotos } from '../../src/features/structure/org-chart-images.js'

const path =
  '/api/v1/accounts/avatar/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/64'
function chart(href: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const image = document.createElementNS('http://www.w3.org/2000/svg', 'image')
  image.setAttribute('href', href)
  svg.append(image)
  return svg
}

describe('org chart photo export', () => {
  it('embeds an authenticated canonical WebP so the exported SVG has no external image request', async () => {
    const svg = chart(path)
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          headers: new Headers({ 'content-type': 'image/webp' }),
          blob: async () => new Blob(['webp-pixels'], { type: 'image/webp' }),
        }) as Response,
    )
    await inlineOrgChartPhotos(svg, fetcher)
    expect(fetcher).toHaveBeenCalledWith(
      new URL(path, window.location.origin).href,
      expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) }),
    )
    expect(svg.querySelector('image')?.getAttribute('href')).toMatch(/^data:image\/webp;base64,/)
  })
  it.each([
    `https://untrusted.example${path}`,
    '/api/v1/admin/accounts',
    `${path}?token=private`,
    'data:image/svg+xml,fake',
  ])('never fetches %s while exporting', async (href) => {
    const fetcher = vi.fn()
    const svg = chart(href)
    await inlineOrgChartPhotos(svg, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
    expect(svg.querySelector('image')).toBeNull()
  })
  it('drops only a missing image, preserving the existing initials beneath it', async () => {
    const svg = chart(path)
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.textContent = 'DK'
    svg.append(text)
    await inlineOrgChartPhotos(
      svg,
      vi.fn(async () => ({ ok: false }) as Response),
    )
    expect(svg.querySelector('image')).toBeNull()
    expect(svg.querySelector('text')?.textContent).toBe('DK')
  })
})
