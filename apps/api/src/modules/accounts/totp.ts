// RFC 4226 (HOTP) / RFC 6238 (TOTP) from scratch on `node:crypto` -- no third-party TOTP dependency
// exists anywhere in this workspace's lockfile, and the algorithm is small and precisely specified
// enough that adding one would cost more (a new pinned version, a new transitive tree) than it saves.
// Base32 (RFC 4648 §6) is what every authenticator app (Google Authenticator, Aegis, andOTP, ...)
// expects for the secret it scans from the QR/manual-entry code.
import { createHmac, randomBytes } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6
/** How many 30s steps of clock drift either side of "now" a submitted code is still accepted for
 * (TECH-SPEC's "2FA optional" says nothing about drift tolerance; ±1 step is the standard Google
 * Authenticator / RFC 6238 §5.2 recommendation, wide enough for ordinary clock skew, narrow enough
 * that a code is never valid for more than 90 seconds). */
const WINDOW_STEPS = 1

export function generateTotpSecret(): string {
  const bytes = randomBytes(20) // 160 bits, RFC 4226 §4's recommended HOTP secret length
  let bits = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  }
  return out
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function totpAt(secret: string, at: Date): string {
  return hotp(secret, Math.floor(at.getTime() / 1000 / STEP_SECONDS))
}

/** True iff `code` matches any step within `±WINDOW_STEPS` of `at` (default: now). Every valid input
 * shape (6 ASCII digits) takes the same code path regardless of match/no-match; there is no early
 * return that would let a timing side-channel narrow down which step matched. */
export function verifyTotp(secret: string, code: string, at: Date = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS)
  let matched = false
  for (let delta = -WINDOW_STEPS; delta <= WINDOW_STEPS; delta += 1) {
    if (hotp(secret, counter + delta) === code) matched = true
  }
  return matched
}

export function otpauthUri(secret: string, login: string, issuer = 'WorkPortal'): string {
  const label = encodeURIComponent(`${issuer}:${login}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // unambiguous, lowercase (typed by hand)

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(10)
    let raw = ''
    for (const byte of bytes) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`)
  }
  return codes
}
