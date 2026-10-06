import { readFile } from 'node:fs/promises'
import { X509Certificate } from 'node:crypto'
import { InputFile } from 'grammy'

/** Only the public certificate may leave this server. Reject accidental private-key files. */
export async function webhookOptions(secret: string, certificatePath?: string) {
  if (!certificatePath) return { secret_token: secret }
  const pem = await readFile(certificatePath)
  if (pem.length > 64 * 1024 || /PRIVATE KEY/.test(pem.toString('utf8')))
    throw new Error('Invalid public webhook certificate')
  const certificate = new X509Certificate(pem)
  if (Date.parse(certificate.validTo) <= Date.now()) throw new Error('Expired webhook certificate')
  return { secret_token: secret, certificate: new InputFile(pem, 'webhook-public.crt') }
}
