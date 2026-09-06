// HMAC-signed, expiring tokens for the local-disk driver's "presigned" URLs (`local-store.ts`). The
// S3 driver gets this for free from SigV4; the local driver needs an equivalent so that the browser
// flow is byte-for-byte the same for both drivers: an opaque URL that only works for one key, one
// method, one user, for a few minutes. Payload is base64url JSON, signature is HMAC-SHA256 over the
// exact payload bytes, compared in constant time.
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SignedTokenPayload = {
  key: string
  userId: string
  method: 'PUT' | 'GET'
  contentType: string | null
  /** Unix milliseconds. */
  exp: number
}

/** The signing key is derived, never the raw secret, so a token can never be used to learn anything
 * about the secret it came from (and so this can share `CSRF_SECRET` without the two ever colliding
 * on the same HMAC input space). */
export function deriveSigningKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('devon.storage.local-signing.v1', 'utf8').digest()
}

function hmac(signingKey: Buffer, payload: string): string {
  return createHmac('sha256', signingKey).update(payload, 'utf8').digest('base64url')
}

export function signToken(payload: SignedTokenPayload, signingKey: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${hmac(signingKey, encoded)}`
}

export function verifyToken(
  token: string,
  signingKey: Buffer,
  now: number = Date.now(),
): SignedTokenPayload | null {
  const dot = token.indexOf('.')
  if (dot <= 0 || token.length > 4096) return null
  const encoded = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = hmac(signingKey, encoded)
  const a = Buffer.from(signature, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (
    typeof p['key'] !== 'string' ||
    typeof p['userId'] !== 'string' ||
    (p['method'] !== 'PUT' && p['method'] !== 'GET') ||
    (p['contentType'] !== null && typeof p['contentType'] !== 'string') ||
    typeof p['exp'] !== 'number'
  ) {
    return null
  }
  if (p['exp'] <= now) return null
  return {
    key: p['key'],
    userId: p['userId'],
    method: p['method'],
    contentType: p['contentType'] as string | null,
    exp: p['exp'],
  }
}
