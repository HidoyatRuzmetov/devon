// SSRF-safe link title unfurling for card links (TECH-SPEC §3.2's "links with title unfurl (SSRF-safe:
// block private ranges)"). Every step here exists because a naive "just fetch the URL" lets a card
// link probe the department's own network (cloud metadata endpoints, internal admin panels, localhost
// services) using the server as a proxy -- OWASP ASVS 5.0 L2's SSRF control.
import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIPv4, isIPv6, type LookupFunction } from 'node:net'

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
    ['224.0.0.0', 3], // multicast and reserved upper range
  ]
  return ranges.some(([base, bits]) => ipv4InCidr(ip, base, bits))
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  return (
    lower === '::1' ||
    /^fe[89ab][0-9a-f]:/.test(lower) || // full link-local /10
    lower.startsWith('ff') || // multicast
    lower.startsWith('fc') ||
    lower.startsWith('fd') || // unique local
    lower === '::' ||
    lower.startsWith('::ffff:') // IPv4-mapped -- re-check as v4 below
  )
}

export type ResolvedAddress = { address: string; family: 4 | 6 }

/**
 * Throws `UnsafeUrlError` unless `url` is a plain http(s) URL that resolves only to public
 * addresses, and returns the addresses it approved so the connection can be pinned to exactly those
 * (see `pinnedLookup`). Exported for `test/unit/link-unfurl.test.ts`.
 */
export async function assertPublicUrl(url: URL): Promise<ResolvedAddress[]> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('only http/https URLs are allowed')
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed')
  }
  // WHATWG URL retains IPv6 brackets; net.isIPv6 and DNS require the bare address.
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeUrlError('local hostnames are not allowed')
  }

  // Resolve DNS ourselves (rather than letting the HTTP client do it) so a DNS answer that only
  // appears at request time -- "DNS rebinding" -- is checked before any request is sent, not after.
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
  return addresses.map((a) => ({ address: a.address, family: a.family as 4 | 6 }))
}

/**
 * A `lookup` that answers only with the addresses `assertPublicUrl` already approved.
 *
 * Without it that check is advisory: it resolves the hostname, approves the answer, then hands the
 * *hostname* to the HTTP client, which resolves it a second time. An attacker who runs the
 * authoritative DNS for their own domain publishes a one-second TTL that answers with a public
 * address on the first query and `169.254.169.254` (or `127.0.0.1`, or an internal admin panel) on
 * the second -- DNS rebinding, the standard bypass for exactly this shape of SSRF filter. Pinning
 * the socket to the vetted address closes the window: the name is resolved once, and the bytes go
 * to the address that was approved.
 *
 * The TLS handshake still uses the hostname (`servername` below), so certificate validation is
 * unaffected -- which is why this is a `lookup` hook and not a rewrite of the URL to an IP literal.
 */
export function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  // `net.LookupFunction` is typed for `dns.lookup`'s overloads (options-or-callback in the second
  // slot, and a callback whose arity depends on `all`). This shim answers both shapes from the
  // already-approved list and never touches the resolver, which is the whole point.
  const fn = (
    _hostname: string,
    options: { all?: boolean | undefined } | ((...args: unknown[]) => void),
    callback?: (...args: unknown[]) => void,
  ): void => {
    const cb = (typeof options === 'function' ? options : callback)!
    const all = typeof options === 'function' ? false : options.all === true
    if (all) {
      cb(null, addresses)
      return
    }
    const first = addresses[0]!
    cb(null, first.address, first.family)
  }
  return fn as unknown as LookupFunction
}

export function extractTitle(html: string): string | null {
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

/**
 * GETs `url` over a socket pinned to `addresses`, reading at most `MAX_BODY_BYTES` and stopping as
 * soon as `</head>` has been seen. Resolves `null` for anything that is not a readable 2xx -- a
 * redirect included: `node:http` never follows one on its own, which is the behaviour this wants,
 * because the redirect target is a *new* URL that has had none of `assertPublicUrl`'s checks run
 * against it. (Following it would have to re-run them, hop by hop, and a link chip is not worth that
 * surface; the caller falls back to the URL as its own title.)
 */
export function fetchHtmlHead(url: URL, addresses: ResolvedAddress[]): Promise<string | null> {
  return new Promise((resolve) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const req = send(
      url,
      {
        method: 'GET',
        headers: { accept: 'text/html', 'user-agent': 'DevonLinkPreview/1.0' },
        lookup: pinnedLookup(addresses),
        // TLS is still negotiated for the hostname, so an IP-pinned socket does not weaken
        // certificate validation.
        servername: url.hostname,
        timeout: FETCH_TIMEOUT_MS,
      },
      (res: IncomingMessage) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.destroy()
          finish(null)
          return
        }
        let received = 0
        let html = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          received += Buffer.byteLength(chunk, 'utf8')
          html += chunk
          if (received >= MAX_BODY_BYTES || /<\/head>/i.test(html)) {
            res.destroy()
            finish(html)
          }
        })
        res.on('end', () => finish(html))
        res.on('error', () => finish(html.length > 0 ? html : null))
      },
    )
    // A server that accepts the connection and then says nothing must not hold a handler's worth of
    // resources open for longer than the budget (H2.7: timeouts on every outbound call).
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy()
      finish(null)
    })
    req.on('error', () => finish(null))
    req.end()
  })
}

/** Fetches `rawUrl` and extracts its `<title>`, refusing anything that is not a public http(s) URL.
 * Never throws for a URL that is merely unreachable or slow -- the caller gets the URL back as its own
 * title (a link chip with no fetched title is a normal, expected state, not an error). Only a genuinely
 * unsafe URL (`UnsafeUrlError`) is the caller's problem to turn into a 422. */
export async function unfurlLink(rawUrl: string): Promise<UnfurlResult> {
  const url = new URL(rawUrl)
  const addresses = await assertPublicUrl(url)

  try {
    const html = await fetchHtmlHead(url, addresses)
    if (html === null) return { url: rawUrl, title: rawUrl, favicon: null }
    const title = extractTitle(html) ?? rawUrl
    return { url: rawUrl, title, favicon: `${url.origin}/favicon.ico` }
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err
    return { url: rawUrl, title: rawUrl, favicon: null }
  }
}
