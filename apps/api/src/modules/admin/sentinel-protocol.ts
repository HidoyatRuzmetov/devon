// The console-side half of the sentinel's wire contract (ADR-011, ADR-014). Deliberately duplicated,
// not imported, from `infra/sentinel/src/{canonical,keys}.mjs`: that package is dependency-free plain
// JS with no build step and no dependency on this monorepo's workspace (infra/README.md), so the two
// sides agree on the algorithm by written contract, each with its own short, auditable implementation
// -- the same reasoning `sentinel-client.ts`'s header already gives for not sharing code across that
// process boundary. Every function here is checked against `infra/sentinel/src/keys.mjs`'s own tests
// for the identical shape (base64url of 32 raw bytes, JWK OKP/Ed25519, `sign(null, message, key)`).
import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto'

/** Mirrors `infra/sentinel/src/canonical.mjs`'s `canonicalJson` exactly: keys sorted ascending, no
 * whitespace. Only ever called on the fixed, flat `{v, command, nonce, issued_at}` shape the wire
 * contract signs. */
export function canonicalJson(fields: Record<string, string | number>): string {
  const keys = Object.keys(fields).sort()
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(fields[k])}`)
  return `{${parts.join(',')}}`
}

/** Generates a fresh ed25519 keypair the same way `infra/sentinel/scripts/keygen.mjs` does for manual
 * use (ADR-014: "or, from EPIC-013, the super admin console"). Returns the raw base64url `x`
 * (public) and `d` (private) JWK members -- the exact on-the-wire shape `sentinel.conf`'s
 * `public_key=` line and this module's own encrypted storage both expect. */
export function generateSentinelKeypair(): { publicKeyB64: string; privateKeyB64: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pub = publicKey.export({ format: 'jwk' }) as { x: string }
  const priv = privateKey.export({ format: 'jwk' }) as { d: string }
  return { publicKeyB64: pub.x, privateKeyB64: priv.d }
}

function privateKeyFromRaw(publicKeyB64: string, privateKeyB64: string): KeyObject {
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: publicKeyB64, d: privateKeyB64 },
    format: 'jwk',
  })
}

/** Builds and signs exactly the envelope `infra/sentinel/src/server.mjs` verifies: `{v:1, command,
 * nonce, issued_at}` canonicalised and ed25519-signed, `nonce` a 32-byte hex string (matches
 * `server.mjs`'s `NONCE_RE`), `sig` base64url. */
export function buildSignedWipeCommand(
  publicKeyB64: string,
  privateKeyB64: string,
  nonceHex: string,
  issuedAt: string = new Date().toISOString(),
): { v: 1; command: 'wipe'; nonce: string; issued_at: string; sig: string } {
  const fields = { v: 1 as const, command: 'wipe' as const, nonce: nonceHex, issued_at: issuedAt }
  const message = canonicalJson(fields)
  const key = privateKeyFromRaw(publicKeyB64, privateKeyB64)
  const sigRaw = cryptoSign(null, Buffer.from(message, 'utf8'), key)
  const sig = sigRaw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { ...fields, sig }
}
