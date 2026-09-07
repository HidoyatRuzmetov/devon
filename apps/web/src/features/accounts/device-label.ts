// `/account` "Qurilmalar va seanslar" (device-list item handoff): the sessions endpoint stores
// exactly the raw `User-Agent` header the browser sent at login and nothing structured (`deviceLabel`
// in the schema is a column nothing writes yet -- see `apps/api/src/modules/accounts/repo.ts`), so a
// readable "Chrome · Windows" label is built from that string client-side. Best-effort only: wrong on
// an unusual UA is a cosmetic miss, never a security signal (the IP and last-seen time next to it are
// still the real evidence) -- this never needs to be exhaustive, just cover what real browsers send.
const BROWSER_PATTERNS: ReadonlyArray<{ label: string; test: RegExp }> = [
  // Order matters: Edge/Opera/Samsung UAs also contain "Chrome", and Chrome's own UA contains
  // "Safari" -- the more specific token has to be checked first.
  { label: 'Edge', test: /Edg\/\d/ },
  { label: 'Opera', test: /(OPR|Opera)\/\d/ },
  { label: 'Samsung Internet', test: /SamsungBrowser\/\d/ },
  { label: 'Firefox', test: /Firefox\/\d/ },
  { label: 'Chrome', test: /(Chrome|CriOS|HeadlessChrome)\/\d/ },
  { label: 'Safari', test: /Version\/\d.*Safari\// },
]

const OS_PATTERNS: ReadonlyArray<{ label: string; test: RegExp }> = [
  { label: 'iOS', test: /iPhone|iPad|iPod/ },
  { label: 'Android', test: /Android/ },
  { label: 'Windows', test: /Windows NT/ },
  { label: 'macOS', test: /Mac OS X|Macintosh/ },
  { label: 'Chrome OS', test: /CrOS/ },
  { label: 'Linux', test: /Linux/ },
]

export interface DeviceDescription {
  /** "Chrome · Windows", "Safari · iOS", or a locale-appropriate "Unknown device" when the UA
   *  string is missing or matches nothing above. */
  label: string
  browser: string | null
  os: string | null
}

export function describeUserAgent(userAgent: string | null): DeviceDescription {
  if (!userAgent) return { label: '', browser: null, os: null }
  const browser = BROWSER_PATTERNS.find((p) => p.test.test(userAgent))?.label ?? null
  const os = OS_PATTERNS.find((p) => p.test.test(userAgent))?.label ?? null
  const label = browser && os ? `${browser} · ${os}` : (browser ?? os ?? '')
  return { label, browser, os }
}
