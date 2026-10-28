import { InputFile } from 'grammy'
import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const TELEGRAM_UPDATES = [
  'message',
  'callback_query',
  'my_chat_member',
  'chat_member',
] as const

/** Only the public certificate may leave this server. Reject accidental private-key files. */
export async function webhookOptions(secret: string, certificatePath?: string) {
  if (!certificatePath) return { secret_token: secret, allowed_updates: [...TELEGRAM_UPDATES] }
  const pem = await readFile(certificatePath)
  if (pem.length > 64 * 1024 || /PRIVATE KEY/.test(pem.toString('utf8')))
    throw new Error('Invalid public webhook certificate')
  const certificate = new X509Certificate(pem)
  if (Date.parse(certificate.validTo) <= Date.now()) throw new Error('Expired webhook certificate')
  return {
    secret_token: secret,
    allowed_updates: [...TELEGRAM_UPDATES],
    certificate: new InputFile(pem, 'webhook-public.crt'),
  }
}
