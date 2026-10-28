import { InputFile } from 'grammy'
import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { webhookOptions } from '../../src/modules/telegram/webhook-options.js'

const certificatePath = fileURLToPath(new URL('../fixtures/telegram-public.crt', import.meta.url))
describe('Telegram custom webhook certificate', () => {
  afterEach(() => vi.restoreAllMocks())
  it('uses the existing public-CA registration when no custom certificate is configured', async () => {
    expect(await webhookOptions('dummy-secret')).toEqual({
      secret_token: 'dummy-secret',
      allowed_updates: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
    })
  })
  it('uploads a valid public certificate as InputFile rather than a file path string', async () => {
    const cert = new X509Certificate(await readFile(certificatePath))
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(cert.validFrom) + 60000)
    const options = await webhookOptions('dummy-secret', certificatePath)
    expect(options.certificate).toBeInstanceOf(InputFile)
    expect(options.secret_token).toBe('dummy-secret')
  })
  it('refuses expired certificates', async () => {
    const cert = new X509Certificate(await readFile(certificatePath))
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(cert.validTo) + 1)
    await expect(webhookOptions('dummy-secret', certificatePath)).rejects.toThrow('Expired')
  })
  it('refuses private keys even when a valid public certificate precedes them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devon-public-cert-test-'))
    try {
      const path = join(dir, 'combined.pem')
      await writeFile(
        path,
        `${await readFile(certificatePath, 'utf8')}\n-----BEGIN PRIVATE KEY-----\ndummy\n-----END PRIVATE KEY-----`,
      )
      await expect(webhookOptions('dummy-secret', path)).rejects.toThrow('Invalid public')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
