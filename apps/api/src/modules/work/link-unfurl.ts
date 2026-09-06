// SSRF-safe link title unfurling for card links (TECH-SPEC §3.2's "links with title unfurl (SSRF-safe:
// block private ranges)"). Every step here exists because a naive "just fetch the URL" lets a card
// link probe the department's own network (cloud metadata endpoints, internal admin panels, localhost
// services) using the server as a proxy -- OWASP ASVS 5.0 L2's SSRF control.
import { lookup } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'

const FETCH_TIMEOUT_MS = 4000
const MAX_BODY_BYTES = 200_000

export class UnsafeUrlError extends Error {}

function ipv4InCidr(ip: string, base: string, bits: number): boolean {
  const toInt = (s: string) =>
    s.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (toInt(ip) & mask) === (toInt(base) & mask)
}

/** Blocks loopback, link-local, private (RFC 1918), CGNAT, and "this network" ranges -- every range
 * that would let a card link reach something other than the public internet. */
function isPrivateIPv4(ip: string): boolean {
  const ranges: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // CGNAT
    ['127.0.0.0', 8],
    ['169.254.0.0', 16], // link-local, incl. cloud metadata (169.254.169.254)
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4], // multicast+
  ]
  return ranges.some(([base, bits]) => ipv4InCidr(ip, base, bits))
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  return (
    lower === '::1' ||
    lower.startsWith('fe80:') || // link-local
    lower.startsWith('fc') ||
    lower.startsWith('fd') || // unique local
    lower === '::' ||
    lower.startsWith('::ffff:') // IPv4-mapped -- re-check as v4 below
  )
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('only http/https URLs are allowed')
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed')
  }
  const hostname = url.hostname
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeUrlError('local hostnames are not allowed')
  }

  // Resolve DNS ourselves (rather than letting `fetch` do it) so a DNS answer that only appears at
  // request time -- "DNS rebinding" -- is checked before any request is sent, not after.
  const addresses = isIPv4(hostname)
    ? [{ address: hostname, family: 4 as const }]
    : isIPv6(hostname)
      ? [{ address: hostname, family: 6 as const }]
      : await lookup(hostname, { all: true })

  if (addresses.length === 0) throw new UnsafeUrlError('hostname did not resolve')
  for (const addr of addresses) {
    if (addr.family === 4 && isPrivateIPv4(addr.address)) {
      throw new UnsafeUrlError('resolves to a private/reserved IP address')
    }
    if (addr.family === 6) {
      if (isPrivateIPv6(addr.address))
        throw new UnsafeUrlError('resolves to a private IPv6 address')
      const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr.address)
      if (mapped && isPrivateIPv4(mapped[1]!)) {
        throw new UnsafeUrlError('resolves to a private/reserved IP address')
      }
    }
  }
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match) return null
  const decoded = match[1]!
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return decoded.length > 0 ? decoded.slice(0, 300) : null
}

export type UnfurlResult = { url: string; title: string; favicon: string | null }

/** Fetches `rawUrl` and extracts its `<title>`, refusing anything that is not a public http(s) URL.
 * Never throws for a URL that is merely unreachable or slow -- the caller gets the URL back as its own
 * title (a link chip with no fetched title is a normal, expected state, not an error). Only a genuinely
 * unsafe URL (`UnsafeUrlError`) is the caller's problem to turn into a 422. */
export async function unfurlLink(rawUrl: string): Promise<UnfurlResult> {
  const url = new URL(rawUrl)
  await assertPublicUrl(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual', // a redirect to a private address must be re-checked, not silently followed
      headers: { accept: 'text/html', 'user-agent': 'DevonLinkPreview/1.0' },
    })
    if (res.status >= 300 && res.status < 400) {
      return { url: rawUrl, title: rawUrl, favicon: null }
    }
    if (!res.ok || !res.body) return { url: rawUrl, title: rawUrl, favicon: null }

    const reader = res.body.getReader()
    let received = 0
    let html = ''
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (received >= MAX_BODY_BYTES || /<\/head>/i.test(html)) {
        await reader.cancel().catch(() => {})
        break
      }
    }
    const title = extractTitle(html) ?? rawUrl
    return { url: rawUrl, title, favicon: `${url.origin}/favicon.ico` }
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err
    return { url: rawUrl, title: rawUrl, favicon: null }
  } finally {
    clearTimeout(timeout)
  }
}
