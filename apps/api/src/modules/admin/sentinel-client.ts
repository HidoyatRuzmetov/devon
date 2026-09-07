// The console-side half of TECH-SPEC §11's wipe switch: signs a command with the shared HMAC key
// (`app.sentinel_keys`, `crypto.ts`) and POSTs it to `infra/sentinel/server.mjs`, which listens on
// `127.0.0.1` only (never reachable from outside the host, by the sentinel's own design) -- this
// module is therefore the only thing on the machine ever expected to call it. The wire format
// (`{requestId, issuedAtMs, action}` + an `X-Devon-Sentinel-Signature` header) is intentionally
// duplicated, not imported, from `infra/sentinel/sign.mjs`: `infra/sentinel/**` is a standalone Node
// service with no dependency on this package (it must keep working even if `apps/api` fails to build),
// so the two sides agree on the algorithm (HMAC-SHA256 over `${requestId}.${issuedAtMs}.${action}`,
// hex-encoded) by written contract, each with its own short, auditable implementation -- exactly the
// kind of small, duplicated primitive the project's "no shared crypto import across a process
// boundary that must survive the other side's outage" reasoning favours over a shared package.
import { createHmac } from 'node:crypto'

const DEFAULT_SENTINEL_URL = 'http://127.0.0.1:8787'
const REQUEST_TIMEOUT_MS = 5_000

export type SentinelWipeResult = { ok: true; response: string } | { ok: false; error: string }

function sign(requestId: string, issuedAtMs: number, action: string, key: Buffer): string {
  return createHmac('sha256', key).update(`${requestId}.${issuedAtMs}.${action}`).digest('hex')
}

/**
 * `sentinelUrl` defaults to `DEVON_SENTINEL_URL` (no `config.ts` entry: this is the one host process
 * this whole module talks to, not instance-wide config every module shares, so an inline, documented
 * env read keeps `config.ts` -- a file outside this module's paths -- untouched) or the sentinel's own
 * documented default port. A network failure, a timeout, or a non-2xx response are all reported as
 * `{ ok: false }`, never thrown -- the caller (`repo.ts`'s `executeWipe`) always has an audit row to
 * write either way.
 */
export async function sendWipeCommand(
  keyHex: string,
  requestId: string,
  sentinelUrl: string = process.env['DEVON_SENTINEL_URL'] ?? DEFAULT_SENTINEL_URL,
): Promise<SentinelWipeResult> {
  const issuedAtMs = Date.now()
  const action = 'wipe'
  const signature = sign(requestId, issuedAtMs, action, Buffer.from(keyHex, 'hex'))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${sentinelUrl}/wipe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-devon-sentinel-signature': signature,
      },
      body: JSON.stringify({ requestId, issuedAtMs, action }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok)
      return { ok: false, error: `sentinel responded ${res.status}: ${text.slice(0, 500)}` }
    return { ok: true, response: text.slice(0, 500) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return { ok: false, error: `sentinel unreachable: ${message}` }
  } finally {
    clearTimeout(timeout)
  }
}
