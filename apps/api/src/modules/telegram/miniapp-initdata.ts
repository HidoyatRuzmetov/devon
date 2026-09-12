// Telegram Mini App `initData` verification (v1.1 SPEC §9, EPIC-015).
//
// A Mini App is a web page Telegram opens in its own webview and hands a signed query string
// (`window.Telegram.WebApp.initData`). That string is the ONLY proof of who the viewer is, so this
// file is a security boundary: it is pure (no I/O, no database, no clock injection beyond an
// explicit `now`), exhaustively unit-tested (`apps/api/test/unit/telegram.miniapp.test.ts`), and it
// never trusts a single field of the payload before the HMAC has matched.
//
// The algorithm is Telegram's own (core.telegram.org/bots/webapps#validating-data-received-via-the-
// mini-app):
//   secret_key       = HMAC_SHA256(key: "WebAppData", message: <bot token>)
//   data_check_string = every received field except `hash`, as `key=value`, sorted by key, "\n"-joined
//   expected         = HMAC_SHA256(key: secret_key, message: data_check_string), hex
// and `expected` must equal the `hash` field, compared in constant time.
//
// Two deliberate details:
//  1. `signature` (Telegram's newer Ed25519 field, present since Bot API 8.0) is part of the payload
//     Telegram hashed, so it stays in the data-check string. Several Telegram clients in the wild
//     have shipped both behaviours, so a mismatch is retried once with `signature` excluded -- both
//     attempts are constant-time compares against the same untrusted `hash`, so the fallback widens
//     nothing: an attacker still has to produce a valid HMAC under the bot token for one of exactly
//     two well-defined strings.
//  2. `auth_date` is checked against a short freshness window. A Mini App session is minted from a
//     replayable string; an old `initData` captured from a log or a screenshot must not still open a
//     session tomorrow.
import { createHmac, timingSafeEqual } from 'node:crypto'

/** The `user` object Telegram puts inside `initData`, narrowed to the fields this product uses.
 * Nothing here is trusted before `verifyInitData` has returned `{ ok: true }`. */
export type TelegramInitUser = {
  id: number
  firstName: string
  lastName: string | null
  username: string | null
  languageCode: string | null
  isPremium: boolean
  allowsWriteToPm: boolean
}

export type VerifiedInitData = {
  user: TelegramInitUser
  authDate: Date
  /** `?startapp=<value>` -- the Mini App deep-link parameter the bot's buttons use to open a screen. */
  startParam: string | null
  queryId: string | null
  chatType: string | null
}

export type InitDataFailure =
  | 'missing'
  | 'malformed'
  | 'no_hash'
  | 'bad_hash'
  | 'expired'
  | 'no_user'
  | 'not_configured'

export type InitDataResult =
  | { ok: true; data: VerifiedInitData }
  | { ok: false; reason: InitDataFailure }

/** Telegram's own default window for `initData` freshness is 24 h; this product uses 15 minutes,
 * because the Mini App re-reads `initData` from `window.Telegram.WebApp` on every launch and the
 * exchange happens immediately after. Anything older is a replay, not a slow user. */
export const INIT_DATA_MAX_AGE_SECONDS = 15 * 60

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let left: Buffer
  let right: Buffer
  try {
    left = Buffer.from(a, 'hex')
    right = Buffer.from(b, 'hex')
  } catch {
    return false
  }
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function dataCheckString(pairs: readonly (readonly [string, string])[], omit: readonly string[]) {
  return pairs
    .filter(([key]) => !omit.includes(key))
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n')
}

function hmacHex(key: Buffer | string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex')
}

type RawTelegramUser = {
  id?: unknown
  first_name?: unknown
  last_name?: unknown
  username?: unknown
  language_code?: unknown
  is_premium?: unknown
  allows_write_to_pm?: unknown
}

function parseUser(raw: string): TelegramInitUser | null {
  let parsed: RawTelegramUser
  try {
    parsed = JSON.parse(raw) as RawTelegramUser
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  // Telegram ids are positive 64-bit integers, but every one issued so far fits comfortably inside
  // `Number.MAX_SAFE_INTEGER`; anything outside that range is not a Telegram account id.
  const id = typeof parsed.id === 'number' ? parsed.id : Number.NaN
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return {
    id,
    firstName: typeof parsed.first_name === 'string' ? parsed.first_name : '',
    lastName: typeof parsed.last_name === 'string' ? parsed.last_name : null,
    username: typeof parsed.username === 'string' ? parsed.username : null,
    languageCode: typeof parsed.language_code === 'string' ? parsed.language_code : null,
    isPremium: parsed.is_premium === true,
    allowsWriteToPm: parsed.allows_write_to_pm === true,
  }
}

/**
 * Verifies a raw `initData` query string against the bot token.
 *
 * `botToken` is the live credential; it never leaves this function (the derived secret key is not
 * cached across calls either -- one HMAC of a ~46-byte string per sign-in is not a measurable cost,
 * and a cached key is one more place a token-rotation has to reach).
 */
export function verifyInitData(
  initData: string | null | undefined,
  botToken: string | null,
  options: { now?: Date; maxAgeSeconds?: number } = {},
): InitDataResult {
  if (!botToken) return { ok: false, reason: 'not_configured' }
  if (!initData || initData.trim() === '') return { ok: false, reason: 'missing' }
  // A pathological length is rejected before any parsing work: Telegram's own payload is a few
  // hundred bytes, and an unauthenticated caller must not be able to buy CPU with a megabyte of
  // query string.
  if (initData.length > 8192) return { ok: false, reason: 'malformed' }

  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const pairs: [string, string][] = []
  for (const [key, value] of params.entries()) pairs.push([key, value])
  if (pairs.length === 0) return { ok: false, reason: 'malformed' }

  const hash = params.get('hash')
  if (!hash) return { ok: false, reason: 'no_hash' }

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const withSignature = hmacHex(secretKey, dataCheckString(pairs, ['hash']))
  let matched = constantTimeHexEqual(withSignature, hash)
  if (!matched && params.has('signature')) {
    // See this file's header, detail (1).
    const withoutSignature = hmacHex(secretKey, dataCheckString(pairs, ['hash', 'signature']))
    matched = constantTimeHexEqual(withoutSignature, hash)
  }
  if (!matched) return { ok: false, reason: 'bad_hash' }

  const authDateRaw = params.get('auth_date')
  const authDateSeconds = authDateRaw ? Number.parseInt(authDateRaw, 10) : Number.NaN
  if (!Number.isFinite(authDateSeconds)) return { ok: false, reason: 'expired' }
  const now = options.now ?? new Date()
  const maxAge = options.maxAgeSeconds ?? INIT_DATA_MAX_AGE_SECONDS
  const ageSeconds = now.getTime() / 1000 - authDateSeconds
  // A negative age beyond a minute means the payload claims to come from the future: a clock skew
  // this large is indistinguishable from a forged `auth_date` and is refused the same way.
  if (ageSeconds > maxAge || ageSeconds < -60) return { ok: false, reason: 'expired' }

  const userRaw = params.get('user')
  const user = userRaw ? parseUser(userRaw) : null
  // A Mini App opened from an inline button in a channel carries no `user` (`receiver`/`chat`
  // instead). This product binds a session to a person, so that launch mode simply cannot sign in.
  if (!user) return { ok: false, reason: 'no_user' }

  return {
    ok: true,
    data: {
      user,
      authDate: new Date(authDateSeconds * 1000),
      startParam: params.get('start_param'),
      queryId: params.get('query_id'),
      chatType: params.get('chat_type'),
    },
  }
}

/**
 * Builds a valid `initData` string for a given bot token. Used by the dev-mode stub
 * (`DEVON_MINIAPP_DEV_LOGIN`, see `miniapp.ts`) and by this module's own tests -- never on a request
 * path. Exported from a source file rather than a test helper because the dev stub route needs it at
 * runtime, and a second copy of the signing rules is exactly how the two would drift.
 */
export function signInitData(
  fields: Record<string, string>,
  botToken: string,
): string {
  const pairs = Object.entries(fields).map(([k, v]) => [k, v] as const)
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = hmacHex(secretKey, dataCheckString(pairs, ['hash']))
  const out = new URLSearchParams()
  for (const [key, value] of pairs) out.set(key, value)
  out.set('hash', hash)
  return out.toString()
}
