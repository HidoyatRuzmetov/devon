const AVATAR_PATH = /^\/api\/v1\/accounts\/avatar\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/64$/i
const MAX_EXPORT_PHOTO_BYTES = 256 * 1024

/** Standalone SVG images cannot fetch authenticated nested images while drawing to a canvas.
 * Embed only our own canonical avatar variants, keeping the initials underneath on any failure. */
export async function inlineOrgChartPhotos(
  svg: SVGSVGElement,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await Promise.all(
    Array.from(svg.querySelectorAll('image')).map(async (image) => {
      try {
        const url = new URL(image.getAttribute('href') ?? '', window.location.origin)
        if (
          url.origin !== window.location.origin ||
          !AVATAR_PATH.test(url.pathname) ||
          url.search ||
          url.hash
        ) {
          image.remove()
          return
        }
        const response = await fetcher(url.href, {
          credentials: 'same-origin',
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/webp')
          throw new Error('Avatar unavailable')
        const blob = await response.blob()
        if (blob.size === 0 || blob.size > MAX_EXPORT_PHOTO_BYTES)
          throw new Error('Unexpected avatar size')
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('Avatar unreadable'))
          reader.onerror = () => reject(new Error('Avatar unreadable'))
          reader.readAsDataURL(blob)
        })
        image.setAttribute('href', dataUrl)
      } catch {
        image.remove()
      }
    }),
  )
}
