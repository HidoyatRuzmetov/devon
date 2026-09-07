#!/usr/bin/env node
// AC-15 evidence producer: `node infra/sentinel/scripts/prove.mjs` (or `pnpm --filter @devon/sentinel
// prove` once this package joins the pnpm workspace -- see infra/README.md). Runs the four break
// attempts named in the work item ("non-loopback caller, unsigned, wrong key, replay"), each
// asserted to be rejected, plus the loopback-only bind evidence (`ss -ltnp` / `netstat`, whichever
// exists) and the no-destructive-path grep. Exits non-zero if anything does not reject as expected.
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createSentinel } from '../src/server.mjs'
import { isLoopbackAddress } from '../src/net.mjs'
import { buildSignedCommand, postCommand, getHealthz } from './client.mjs'
import { checkNoDestructivePath, checkDestructiveFileContainsCapability } from '../test/lib/grep-source.mjs'

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`[prove] ${ok ? 'PASS' : 'FAIL'} -- ${name}${detail ? `: ${detail}` : ''}`)
}

const workDir = mkdtempSync(join(tmpdir(), 'devon-sentinel-prove-'))
const keyA = generateKeyPairSync('ed25519') // the trusted key, matches the running config
const keyB = generateKeyPairSync('ed25519') // an unrelated key, for the "wrong key" attempt
const pubA = keyA.publicKey.export({ format: 'jwk' })
const privAJwk = keyA.privateKey.export({ format: 'jwk' })
const { privateKeyFromRaw } = await import('../src/keys.mjs')
const privA = privateKeyFromRaw(privAJwk.x, privAJwk.d)

const config = {
  host: '127.0.0.1',
  port: 0, // let the OS assign a free ephemeral port; printed once listening
  publicKeyB64: pubA.x,
  freshnessMs: 60_000,
  nonceRetentionMs: 300_000,
  maxBodyBytes: 4096,
  allowedCommands: Object.freeze(['noop', 'wipe']),
  logPath: join(workDir, 'sentinel.log'),
  nonceStorePath: join(workDir, 'nonces.log'),
}

const { server } = createSentinel(config)
await new Promise((resolve) => server.listen({ host: config.host, port: config.port }, resolve))
const addr = server.address()
console.log(`[prove] sentinel listening on ${addr.address}:${addr.port}`)

try {
  // --- bind evidence -------------------------------------------------------------------------
  record('bind address is 127.0.0.1 (never 0.0.0.0)', addr.address === '127.0.0.1', `server.address()=${JSON.stringify(addr)}`)

  let bindListing = null
  for (const [cmd, args] of [
    ['ss', ['-ltnp']],
    ['netstat', ['-ano']],
  ]) {
    try {
      const full = execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 })
      // Filtered to the lines that matter -- an unfiltered `netstat -ano` on a workstation runs to
      // hundreds of lines having nothing to do with this process; the sentinel's own port is what
      // the reviewer needs to see (loopback-only, nothing on 0.0.0.0/[::] for this port).
      const relevant = full
        .split(/\r?\n/)
        .filter((l) => l.includes(String(addr.port)) || /^\s*(Proto|Netid)/i.test(l))
        .join('\n')
      bindListing = relevant || full
      console.log(`[prove] ${cmd} ${args.join(' ')} evidence (filtered to port ${addr.port}):\n${bindListing}`)
      break
    } catch {
      /* try the next tool; environments differ (this repo is developed on Windows, deployed on Linux) */
    }
  }
  if (!bindListing) console.log('[prove] neither ss nor netstat is available on this machine -- paste the equivalent from the target host.')

  // --- attempt 1: a genuinely valid command (baseline; also supplies the nonce for the replay attempt) ---
  const validPayload = buildSignedCommand(privA, 'noop')
  const okRes = await postCommand({ port: addr.port, body: validPayload })
  record('valid signed noop is accepted', okRes.status === 200 && okRes.body?.ok === true, `status=${okRes.status} body=${JSON.stringify(okRes.body)}`)

  // --- attempt 2: unsigned (no sig field at all) ----------------------------------------------
  const unsignedPayload = { v: 1, command: 'noop', nonce: validPayload.nonce.replace(/^./, '0'), issued_at: new Date().toISOString() }
  const unsignedRes = await postCommand({ port: addr.port, body: unsignedPayload })
  record('unsigned command is rejected', unsignedRes.status === 400 && unsignedRes.body?.error === 'malformed', `status=${unsignedRes.status} body=${JSON.stringify(unsignedRes.body)}`)

  // --- attempt 3: wrong key (structurally valid signature, wrong keypair) ---------------------
  const privBJwk = keyB.privateKey.export({ format: 'jwk' })
  const privB = privateKeyFromRaw(privBJwk.x, privBJwk.d)
  const wrongKeyPayload = buildSignedCommand(privB, 'noop')
  const wrongKeyRes = await postCommand({ port: addr.port, body: wrongKeyPayload })
  record('wrong-key signature is rejected', wrongKeyRes.status === 401 && wrongKeyRes.body?.error === 'bad_signature', `status=${wrongKeyRes.status} body=${JSON.stringify(wrongKeyRes.body)}`)

  // --- attempt 4: replay (resend the exact accepted payload from attempt 1) -------------------
  const replayRes = await postCommand({ port: addr.port, body: validPayload })
  record('replayed command is rejected', replayRes.status === 401 && replayRes.body?.error === 'replay', `status=${replayRes.status} body=${JSON.stringify(replayRes.body)}`)

  // --- attempt 5: non-loopback caller -----------------------------------------------------------
  // A real non-loopback socket cannot originate from this same process without another network
  // interface; the deterministic proof is the pure address check plus the bind assertion above.
  // container-network-style bridge addresses (the disproof's explicit example) are included.
  const nonLoopbackSamples = ['203.0.113.7', '172.17.0.2', '10.0.0.5', '::ffff:172.17.0.2', 'fe80::1']
  const allRejectedByCheck = nonLoopbackSamples.every((a) => isLoopbackAddress(a) === false)
  record('isLoopbackAddress() rejects non-loopback samples incl. a container-bridge-style address', allRejectedByCheck, JSON.stringify(nonLoopbackSamples))
  const loopbackSamples = ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']
  const allAcceptedByCheck = loopbackSamples.every((a) => isLoopbackAddress(a) === true)
  record('isLoopbackAddress() accepts every loopback form', allAcceptedByCheck, JSON.stringify(loopbackSamples))

  // --- healthz sanity (not a break attempt, just confirms the allow-list surface) ---------------
  const health = await getHealthz({ port: addr.port })
  record('/healthz reports commands=["noop","wipe"]', health.status === 200 && JSON.stringify(health.body?.commands) === JSON.stringify(['noop', 'wipe']), JSON.stringify(health.body))

  // --- no destructive code path outside wipe-executor.mjs (ADR-014: proved, not claimed) --------
  const grep = checkNoDestructivePath({ excludeFiles: ['wipe-executor.mjs'] })
  record('no destructive verb appears in infra/sentinel/src outside wipe-executor.mjs', grep.clean, grep.clean ? 'checked ' + grep.filesChecked + ' file(s)' : JSON.stringify(grep.hits))
  const capability = checkDestructiveFileContainsCapability('wipe-executor.mjs')
  record('wipe-executor.mjs exists and actually contains the wipe capability', capability.found && capability.hasCapability, JSON.stringify(capability))
} finally {
  server.close()
  rmSync(workDir, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n[prove] ${results.length - failed.length}/${results.length} checks passed.`)
if (failed.length) {
  console.error('[prove] FAILED checks:')
  for (const f of failed) console.error(`  - ${f.name}`)
  process.exit(1)
}
