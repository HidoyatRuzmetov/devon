// The sentinel's HTTP surface (design.md §1.9, ADR-011). Verification order is fixed and load-bearing
// for AC-15's evidence: peer address -> size -> parse -> signature -> freshness -> nonce unseen ->
// command allow-list. Every branch below appears in exactly that order.
//
// EPIC-000 shipped exactly one command ("noop") and no destructive code path at all. EPIC-013 /
// ADR-014 adds "wipe" -- the destructive verbs it needs live in exactly one file, `wipe-executor.mjs`,
// never inline here; `test/no-destructive-path.test.mjs` now proves that every OTHER file under
// `src/` (this one included) still contains none, so the blast radius stays that one small, auditable
// file rather than spreading through the request-handling code.
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { isLoopbackAddress } from './net.mjs'
import { canonicalJson } from './canonical.mjs'
import { publicKeyFromRaw, verifySignature } from './keys.mjs'
import { NonceStore } from './nonces.mjs'
import { executeWipe } from './wipe-executor.mjs'

const NONCE_RE = /^[0-9a-f]{64}$/i

/** @param {ReturnType<import('./config.mjs').loadConfig>} config */
export function createSentinel(config) {
  if (config.host !== '127.0.0.1') {
    // No environment variable or config-file value can widen this. Binding anywhere else is the
    // one thing AC-15's disproof calls out by name; refusing to start is the fail-closed answer.
    throw new Error(
      `refusing to start: host must be "127.0.0.1", got ${JSON.stringify(config.host)} (ADR-011).`,
    )
  }
  if (!(config.nonceRetentionMs > config.freshnessMs)) {
    throw new Error(
      'nonce_retention_ms must be strictly greater than freshness_ms, or a pruned nonce could ' +
        'replay inside the still-valid freshness window (design.md risk (n)).',
    )
  }

  const publicKey = publicKeyFromRaw(config.publicKeyB64)
  const nonces = new NonceStore(config.nonceStorePath, config.nonceRetentionMs)
  mkdirSync(dirname(config.logPath), { recursive: true })

  function logLine(line) {
    try {
      appendFileSync(config.logPath, `${new Date().toISOString()} ${line}\n`)
    } catch (err) {
      // A log write failure must never stop the sentinel from answering a request -- surface it on
      // stderr (captured by the service supervisor) instead.
      console.error(`[sentinel] could not append to ${config.logPath}: ${err.message}`)
    }
  }

  function reply(res, peer, status, code, extra) {
    logLine(`peer=${peer} status=${status} outcome=${code ?? 'ok'}`)
    const body = JSON.stringify(code ? { error: code } : { ok: true, ...extra })
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  }

  const server = createServer((req, res) => {
    const peer = req.socket.remoteAddress ?? 'unknown'

    if (req.method === 'GET' && req.url === '/healthz') {
      return reply(res, peer, 200, null, { commands: [...config.allowedCommands] })
    }

    if (req.method !== 'POST' || req.url !== '/command') {
      return reply(res, peer, 404, 'not_found')
    }

    // 1. peer address -- independently of the bind itself (belt-and-braces with the 'connection'
    //    handler below, and with the fixed host === '127.0.0.1' assertion above).
    if (!isLoopbackAddress(peer)) return reply(res, peer, 403, 'forbidden')

    const chunks = []
    let size = 0
    let oversize = false

    req.on('data', (chunk) => {
      if (oversize) return // still draining the socket below; the response is already sent
      size += chunk.length
      // 2. size -- enforced as bytes arrive, so an oversized body cannot be buffered in full first.
      // The connection is drained rather than destroyed: destroying it mid-stream races the 413
      // response against the client's write and surfaces as a connection reset instead of a Problem.
      if (size > config.maxBodyBytes) {
        oversize = true
        chunks.length = 0
        return reply(res, peer, 413, 'too_large')
      }
      chunks.push(chunk)
    })

    req.on('error', () => {
      /* the client went away mid-request; nothing left to answer */
    })

    req.on('end', () => {
      if (oversize) return // already answered from the 'data' handler above

      // 3. parse
      let payload
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(res, peer, 400, 'malformed')
      }

      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        payload.v !== 1 ||
        typeof payload.command !== 'string' ||
        payload.command.length === 0 ||
        typeof payload.nonce !== 'string' ||
        !NONCE_RE.test(payload.nonce) ||
        typeof payload.issued_at !== 'string' ||
        Number.isNaN(Date.parse(payload.issued_at)) ||
        typeof payload.sig !== 'string' ||
        payload.sig.length === 0 ||
        // `actor` is optional and, per the header comment above the `wipe` branch below, deliberately
        // NOT part of the signed fields -- it still has to be a string when present, or absent, never
        // some other JSON type that would make `sanitizeActor` downstream do something surprising.
        (payload.actor !== undefined && typeof payload.actor !== 'string')
      ) {
        return reply(res, peer, 400, 'malformed')
      }

      const { v, command, nonce, issued_at: issuedAt, sig, actor } = payload
      const message = canonicalJson({ v, command, nonce, issued_at: issuedAt })

      // 4. signature
      if (!verifySignature(publicKey, message, sig)) {
        return reply(res, peer, 401, 'bad_signature')
      }

      // 5. freshness
      const issuedMs = Date.parse(issuedAt)
      if (Math.abs(Date.now() - issuedMs) > config.freshnessMs) {
        return reply(res, peer, 401, 'expired')
      }

      // 6. nonce unseen
      if (!nonces.checkAndRecord(nonce)) {
        return reply(res, peer, 401, 'replay')
      }

      // 7. command allow-list -- "noop" and "wipe" (EPIC-013 / ADR-014); see config.mjs for why this
      //    list is fixed in code rather than read from the conf file.
      if (!config.allowedCommands.includes(command)) {
        return reply(res, peer, 400, 'unknown_command')
      }

      if (command === 'wipe') {
        // `actor` (unsigned, informational only -- see the validation block above) is logged by
        // `wipe-executor.mjs` for "wiped at <time> by <user>"; it is never consulted for the
        // authorization decision, which is already final by this point (a validly signed, fresh,
        // unreplayed command from the one trusted keypair).
        const result = executeWipe(config, { actor })
        if (!result.ok) return reply(res, peer, 500, 'wipe_failed', { steps: result.steps })
        return reply(res, peer, 200, null, { command, at: new Date().toISOString(), steps: result.steps })
      }

      // "noop": does nothing and exists to prove the pipeline above end to end (AC-15). Executing
      // "noop" is, by construction, executing nothing.
      return reply(res, peer, 200, null, { command, at: new Date().toISOString() })
    })
  })

  server.on('connection', (socket) => {
    // Defence in depth: refuse the raw connection before any HTTP parsing happens for a
    // non-loopback peer, in addition to the per-request check above (design.md risk (m)).
    if (!isLoopbackAddress(socket.remoteAddress)) socket.destroy()
  })

  return { server, config, logLine }
}
