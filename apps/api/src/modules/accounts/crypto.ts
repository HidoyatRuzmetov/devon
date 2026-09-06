// AES-256-GCM at-rest encryption for `app.user_security.totp_secret_enc` (TECH-SPEC §3.1 names the
// column `totp_secret_enc`, i.e. encrypted, not plain). No new secret is introduced for this (a new
// `.env` key is a shared-file edit to `apps/api/src/config.ts` this module does not need to make): the
// key is derived via HKDF-SHA256 from the existing `CSRF_SECRET` (already required, already
// production-guarded against its `.env.example` placeholder -- `src/config.ts`), with a fixed,
// purpose-specific `info` string so this derived key can never collide with any other use of the same
// secret elsewhere in the codebase.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

function deriveKey(csrfSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', csrfSecret, '', 'devon.accounts.totp_secret_enc', 32))
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
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}
