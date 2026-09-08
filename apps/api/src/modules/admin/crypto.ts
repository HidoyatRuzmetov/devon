// AES-256-GCM at-rest encryption for `app.sentinel_keys.private_key_enc` (TECH-SPEC §11 + ADR-014: the
// sentinel's ed25519 private key never leaves this database, let alone the browser -- only the public
// half is shown to the operator, plainly, since it is not a secret). Same shape as
// `modules/accounts/crypto.ts` (HKDF-SHA256 over the existing `CSRF_SECRET`, a fixed purpose-specific
// `info` string) so this module needs no new `.env` key either -- deliberately not importing that
// file's `deriveKey`, which is unexported on purpose (accounts owns its own derivation, admin owns
// this one; two purpose-strings can never collide).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/** GCM's full 128-bit authentication tag (H1.15). Pinned explicitly on both halves rather than left
 * to Node's default: without `authTagLength`, `decipher.setAuthTag()` accepts a 4-, 8-, 12-, 13-,
 * 14-, 15- or 16-byte tag, so a stored ciphertext whose tag had been truncated to 4 bytes would
 * still decrypt -- and a 32-bit tag is forgeable. With it pinned, anything but 16 bytes throws. */
const AUTH_TAG_LENGTH = 16

function deriveKey(csrfSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', csrfSecret, '', 'devon.admin.sentinel_key_enc', 32))
}

export function encryptSecret(plain: string, csrfSecret: string): string {
  const key = deriveKey(csrfSecret)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decryptSecret(encoded: string, csrfSecret: string): string {
  const [ivHex, tagHex, dataHex] = encoded.split(':')
  if (!ivHex || !tagHex || !dataHex) throw new Error('malformed encrypted secret')
  const key = deriveKey(csrfSecret)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'), {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
    'utf8',
  )
}
