// AES-256-GCM at-rest encryption for `app.sentinel_keys.key_enc` (TECH-SPEC §11: the sentinel's HMAC
// secret "lives only in the sentinel's config and the encrypted admin settings"). Same shape as
// `modules/accounts/crypto.ts` (HKDF-SHA256 over the existing `CSRF_SECRET`, a fixed purpose-specific
// `info` string) so this module needs no new `.env` key either -- deliberately not importing that
// file's `deriveKey`, which is unexported on purpose (accounts owns its own derivation, admin owns
// this one; two purpose-strings can never collide).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

function deriveKey(csrfSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', csrfSecret, '', 'devon.admin.sentinel_key_enc', 32))
}

export function encryptSecret(plain: string, csrfSecret: string): string {
  const key = deriveKey(csrfSecret)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decryptSecret(encoded: string, csrfSecret: string): string {
  const [ivHex, tagHex, dataHex] = encoded.split(':')
  if (!ivHex || !tagHex || !dataHex) throw new Error('malformed encrypted secret')
  const key = deriveKey(csrfSecret)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
    'utf8',
  )
}
