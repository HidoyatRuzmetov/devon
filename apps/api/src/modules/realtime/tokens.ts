// Centrifugo JWTs (HS256), signed here and verified by Centrifugo itself against
// `client.token.hmac_secret_key`.
//
// Two kinds, and the difference matters:
//   * a **connection token** says who the browser is (`sub`) and how long the connection may live;
//   * a **subscription token** says which one channel that browser may join (`channel` + `sub`).
//
// Centrifugo's channel defaults are all `allow_*_for_client: false` (verified against
// `centrifugo defaultconfig` for the pinned v6 image), which means a client cannot subscribe to
// anything without one of these -- the safe direction. So every subscription this product makes is
// a channel the API said yes to, one `can()` call at a time, moments before the token was minted.
//
// No dependency: a JWS with a fixed header is three base64url segments and one HMAC, and adding a
// JWT library to sign a 200-byte payload would be the kind of dependency TECH-SPEC §1.2 asks us not
// to take. `node:crypto`'s `timingSafeEqual` is not needed here -- nothing in this file *verifies* a
// token, Centrifugo does.
import { createHmac } from 'node:crypto'

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const payload = base64url(JSON.stringify(claims))
  const signingInput = `${HEADER}.${payload}`
  const signature = base64url(createHmac('sha256', secret).update(signingInput).digest())
  return `${signingInput}.${signature}`
}

export type ConnectionInfo = {
  /** Shown to other people in presence lists: a display name and an avatar, never an email, never a
   * phone number, never a personal field value (I-2's tiering applies to presence too). */
  name: string
  /** The storage key, not a URL: the client already owns the one function that turns a key into a
   * sized avatar URL (`apps/web/src/lib/avatar.ts`), and a presigned URL inside a long-lived token
   * would expire before the token does. */
  avatarKey: string | null
}

export type ConnectionTokenInput = {
  userId: string
  ttlSeconds: number
  info: ConnectionInfo
  /** Channels Centrifugo subscribes the connection to server-side, with no client round trip. Used
   * for the person's own `personal#<id>` channel, whose answer never depends on anything but who
   * they are. */
  channels?: readonly string[]
  now?: () => number
}

export function signConnectionToken(input: ConnectionTokenInput, secret: string): string {
  const nowSeconds = Math.floor((input.now?.() ?? Date.now()) / 1000)
  const claims: Record<string, unknown> = {
    sub: input.userId,
    iat: nowSeconds,
    exp: nowSeconds + input.ttlSeconds,
    info: input.info,
  }
  if (input.channels && input.channels.length > 0) claims['channels'] = [...input.channels]
  return signJwt(claims, secret)
}

export type SubscriptionTokenInput = {
  userId: string
  channel: string
  ttlSeconds: number
  now?: () => number
}

export function signSubscriptionToken(input: SubscriptionTokenInput, secret: string): string {
  const nowSeconds = Math.floor((input.now?.() ?? Date.now()) / 1000)
  return signJwt(
    {
      sub: input.userId,
      channel: input.channel,
      iat: nowSeconds,
      exp: nowSeconds + input.ttlSeconds,
    },
    secret,
  )
}

/** Decodes a JWS payload without verifying it -- tests only, so an assertion can read the claims a
 * signer produced. Never used on an inbound token: this API verifies no JWT at all. */
export function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}
