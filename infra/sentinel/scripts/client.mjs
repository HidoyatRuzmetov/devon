// Shared helper for scripts that talk to a running sentinel (scripts/prove.mjs, scripts/send.mjs).
// Not imported by src/ -- this is operator/test tooling, not part of the running service.
import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { canonicalJson } from '../src/canonical.mjs'
import { signMessage } from '../src/keys.mjs'

export function buildSignedCommand(privateKeyObject, command, overrides = {}) {
  const fields = {
    v: 1,
    command,
    nonce: overrides.nonce ?? randomBytes(32).toString('hex'),
    issued_at: overrides.issuedAt ?? new Date().toISOString(),
  }
  const sig = overrides.sig ?? signMessage(privateKeyObject, canonicalJson(fields))
  return { ...fields, sig }
}

export function postCommand({ host = '127.0.0.1', port, path = '/command', body, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const req = request(
      { host, port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }, timeout: timeoutMs },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            /* non-JSON body (e.g. an aborted connection) -- caller sees status + raw text */
          }
          resolve({ status: res.statusCode, body: parsed, raw: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('request timed out')))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

export function getHealthz({ host = '127.0.0.1', port, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path: '/healthz', method: 'GET', timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        let parsed = null
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          /* ignore */
        }
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('timeout', () => req.destroy(new Error('request timed out')))
    req.on('error', reject)
    req.end()
  })
}
