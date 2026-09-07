// The console-side half of TECH-SPEC §11's wipe switch (ADR-011, ADR-014): signs a `wipe` command
// with the active ed25519 keypair (`app.sentinel_keys`, `sentinel-protocol.ts`) and POSTs it to
// `infra/sentinel/src/server.mjs`, which listens on `127.0.0.1` only -- this module is therefore the
// only thing on the machine ever expected to call it, exactly like `infra/sentinel/scripts/client.mjs`
// (its own operator-tooling counterpart) does. `actor` rides along unsigned (ADR-014: informational
// log attribution only, never part of what is verified) so `/var/log/devon-wipe.log` can say "by
// <user>" without widening the signed envelope for every command.
import { randomBytes } from 'node:crypto'
import { buildSignedWipeCommand } from './sentinel-protocol.js'

const DEFAULT_SENTINEL_URL = 'http://127.0.0.1:8787'
const REQUEST_TIMEOUT_MS = 5_000

export type SentinelWipeResult = { ok: true; response: string } | { ok: false; error: string }

/**
 * `sentinelUrl` defaults to `DEVON_SENTINEL_URL` (no `config.ts` entry: this is the one host process
 * this module talks to, not instance-wide config every module shares, so an inline, documented env
 * read keeps `config.ts` -- a file outside this module's paths -- untouched) or the sentinel's own
 * documented default port. A network failure, a timeout, or a non-2xx response are all reported as
 * `{ ok: false }`, never thrown -- the caller (`repo.ts`'s `executeWipe`) always has an audit row to
 * write either way.
 */
export async function sendWipeCommand(
  publicKeyB64: string,
  privateKeyB64: string,
  actor: string,
  sentinelUrl: string = process.env['DEVON_SENTINEL_URL'] ?? DEFAULT_SENTINEL_URL,
): Promise<SentinelWipeResult> {
  const nonce = randomBytes(32).toString('hex')
  const command = buildSignedWipeCommand(publicKeyB64, privateKeyB64, nonce)
  const body = { ...command, actor }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${sentinelUrl}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
