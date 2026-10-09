// H1.6 (server-side URL validation, SSRF-safe unfurling) and H2.7 (timeouts on every outbound call).
//
// The unfurler is the only place in this API that fetches a URL a user typed, so it is the only
// place an attacker can aim the server's own network position at something they cannot reach
// themselves. These tests cover the refusals it must make, and -- the point of the pinning work --
// that the socket really goes to the address that was approved rather than to whatever DNS says
// second.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertPublicUrl,
  extractTitle,
  fetchHtmlHead,
  pinnedLookup,
  unfurlLink,
  UnsafeUrlError,
} from '../../src/modules/work/link-unfurl.js'

describe('assertPublicUrl refuses what must never be fetched (H1.6)', () => {
  const refused: Array<[string, string]> = [
    ['file:///etc/passwd', 'a file: URL'],
    ['gopher://example.com/', 'a gopher: URL'],
    ['ftp://example.com/x', 'an ftp: URL'],
    ['http://user:pass@example.com/', 'credentials embedded in the URL'],
    ['http://localhost:3000/admin', 'localhost by name'],
    ['http://api.localhost/', 'a .localhost subdomain'],
    ['http://printer.local/', 'an mDNS .local name'],
    ['http://127.0.0.1:3000/', 'IPv4 loopback'],
    ['http://127.42.7.9/', 'anywhere in 127/8'],
    ['http://169.254.169.254/latest/meta-data/', 'the cloud metadata address'],
    ['http://10.1.2.3/', 'RFC 1918 10/8'],
    ['http://172.16.9.9/', 'RFC 1918 172.16/12'],
    ['http://192.168.1.1/', 'RFC 1918 192.168/16'],
    ['http://100.64.3.4/', 'CGNAT 100.64/10'],
    ['http://0.0.0.0/', '"this network"'],
    ['http://[::1]:8080/', 'IPv6 loopback'],
    ['http://[fd00::1]/', 'an IPv6 unique-local address'],
    ['http://[fe80::1]/', 'an IPv6 link-local address'],
    ['http://[::ffff:169.254.169.254]/', 'the metadata address written as IPv4-mapped IPv6'],
  ]

  for (const [url, why] of refused) {
    it(`refuses ${why}: ${url}`, async () => {
      await expect(assertPublicUrl(new URL(url))).rejects.toBeInstanceOf(UnsafeUrlError)
    })
  }

  it('an IP literal that is public is allowed, and comes back as the address to connect to', async () => {
    await expect(assertPublicUrl(new URL('http://93.184.216.34/'))).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ])
  })

  it('unfurlLink propagates the refusal rather than swallowing it into a plain title', async () => {
    await expect(unfurlLink('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      UnsafeUrlError,
    )
  })
})

describe('pinnedLookup answers only from the approved list (H1.6, DNS rebinding)', () => {
  const approved = [{ address: '93.184.216.34', family: 4 as const }]

  it('answers the single-address form with the approved address', () => {
    const seen: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising dns.lookup's shape
    ;(pinnedLookup(approved) as any)('evil.example', {}, (...args: unknown[]) => seen.push(...args))
    expect(seen).toEqual([null, '93.184.216.34', 4])
  })

  it('answers the { all: true } form with the whole approved list', () => {
    let answer: unknown
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising dns.lookup's shape
    ;(pinnedLookup(approved) as any)('evil.example', { all: true }, (_e: unknown, a: unknown) => {
      answer = a
    })
    expect(answer).toEqual(approved)
  })

  it('answers the callback-in-second-position form too', () => {
    const seen: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising dns.lookup's shape
    ;(pinnedLookup(approved) as any)('evil.example', (...args: unknown[]) => seen.push(...args))
    expect(seen).toEqual([null, '93.184.216.34', 4])
  })
})

describe('unfurlLink against a real server (H1.6, H2.7)', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
        return
      }
      if (req.url === '/huge') {
        res.writeHead(200, { 'content-type': 'text/html' })
        // No </head> and more than the byte budget: the reader must stop on its own.
        res.write('<html><body>')
        res.write('x'.repeat(400_000))
        res.end('</body></html>')
        return
      }
      if (req.url === '/drip') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('<html><head>')
        // Real bytes keep the socket active: an inactivity timeout alone never bounds this call.
        const drip = setInterval(() => res.write(' '), 10)
        res.on('close', () => clearInterval(drip))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        '<html><head><title>  Oylik   hisobot &amp; reja </title></head><body>hi</body></html>',
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('reads and normalises the <title>', async () => {
    // 127.0.0.1 is refused by `assertPublicUrl` by design, so this drives the fetch half directly
    // with an approved-address list that points at the loopback test server -- exactly the shape
    // `unfurlLink` builds after a public hostname has passed the checks.
    const url = new URL(`http://example.invalid:${port}/`)
    const html = await fetchHtmlHead(url, [{ address: '127.0.0.1', family: 4 }])
    expect(html).not.toBeNull()
    expect(extractTitle(html!)).toBe('Oylik hisobot & reja')
  })

  it('does not follow a redirect towards a private address', async () => {
    const url = new URL(`http://example.invalid:${port}/redirect`)
    // A 3xx is not a readable 2xx: no title, and above all no second request to 169.254.169.254.
    await expect(fetchHtmlHead(url, [{ address: '127.0.0.1', family: 4 }])).resolves.toBeNull()
  })

  it('stops reading a body with no </head> once the byte budget is spent', async () => {
    const url = new URL(`http://example.invalid:${port}/huge`)
    const html = await fetchHtmlHead(url, [{ address: '127.0.0.1', family: 4 }])
    expect(html).not.toBeNull()
    expect(html!.length).toBeLessThan(400_000)
  })

  it('bounds a continuously active response by the whole-call deadline', async () => {
    const url = new URL(`http://example.invalid:${port}/drip`)
    const started = Date.now()
    await expect(fetchHtmlHead(url, [{ address: '127.0.0.1', family: 4 }], 100)).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
