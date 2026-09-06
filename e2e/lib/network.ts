// Same-origin network assertion (design.md §3.4 / H21.1, this item's handoff: "Same-origin network
// assertion on every shell route"). "Every network request made by the shell is same-origin" -- no
// CDN, no analytics, no external font, no telemetry call (design.md §3.2).
import type { Page, Request } from '@playwright/test'

export interface NetworkRecorder {
  requests: Request[]
  stop(): void
  foreignOrigins(pageOrigin: string): string[]
}

/** `data:`/`blob:` URLs have no network origin at all and are not "foreign" -- they never leave the
 * browser. Everything else must share the page's origin. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return null
    return parsed.origin
  } catch {
    return null
  }
}

export function recordNetwork(page: Page): NetworkRecorder {
  const requests: Request[] = []
  const onRequest = (req: Request): void => {
    requests.push(req)
  }
  page.on('request', onRequest)
  return {
    requests,
    stop() {
      page.off('request', onRequest)
    },
    foreignOrigins(pageOrigin: string): string[] {
      const foreign = new Set<string>()
      for (const req of requests) {
        const origin = originOf(req.url())
        if (origin && origin !== pageOrigin) foreign.add(origin)
      }
      return [...foreign]
    },
  }
}
