import { access, readFile, readdir, stat, statfs } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { loadAiConfig } from '@devon/ai'
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { isTelegramPollingHealthy } from '../telegram/polling.js'

export type ProbeResult = {
  status: 'ok' | 'degraded' | 'down' | 'not_configured'
  detail: { code: string; params?: Record<string, string | number> } | null
  latencyMs: number | null
}
const result = (status: ProbeResult['status'], code?: string): ProbeResult => ({
  status,
  detail: code ? { code } : null,
  latencyMs: null,
})

/** Health uses the same configuration as uploads, never a second shadow setting. */
export async function probeStorage(env: NodeJS.ProcessEnv = process.env): Promise<ProbeResult> {
  try {
    if (env['STORAGE_DRIVER'] === 's3') {
      const client = new S3Client({
        ...(env['STORAGE_S3_ENDPOINT'] ? { endpoint: env['STORAGE_S3_ENDPOINT'] } : {}),
        region: env['STORAGE_S3_REGION'] || 'us-east-1',
        forcePathStyle: env['STORAGE_S3_FORCE_PATH_STYLE'] !== 'false',
        credentials: {
          accessKeyId: env['STORAGE_S3_ACCESS_KEY'] || '',
          secretAccessKey: env['STORAGE_S3_SECRET_KEY'] || '',
        },
      })
      try {
        await client.send(new HeadBucketCommand({ Bucket: env['STORAGE_S3_BUCKET'] || 'devon' }), {
          abortSignal: AbortSignal.timeout(3000),
        })
        return result('ok')
      } finally {
        client.destroy()
      }
    }
    const dir = env['STORAGE_LOCAL_DIR'] || env['DEVON_STORAGE_DIR'] || '.data/storage'
    await access(dir, constants.R_OK | constants.W_OK)
    const stats = await statfs(dir)
    const gb = Math.round(((stats.bavail * stats.bsize) / 1024 ** 3) * 10) / 10
    return {
      status: gb < 2 ? 'degraded' : 'ok',
      detail: { code: 'storage.free', params: { gb } },
      latencyMs: null,
    }
  } catch {
    return result('down', 'storage.unavailable')
  }
}

export async function probeAi(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  const config = loadAiConfig(env)
  if (!config.apiKey) return result('not_configured')
  const started = Date.now()
  try {
    const res = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return result('down', 'ai.rejected')
    const body = (await res.json()) as { data?: { id: string }[] }
    if (!Array.isArray(body.data) || !body.data.some((model) => model.id === config.model))
      return result('down', 'ai.modelUnavailable')
    return { ...result('ok'), latencyMs: Date.now() - started }
  } catch {
    return result('down', 'ai.unreachable')
  }
}

export async function probeTelegram(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  pollingHealthy: () => boolean = isTelegramPollingHealthy,
): Promise<ProbeResult> {
  const token = env['TELEGRAM_BOT_TOKEN']
  if (!token) return result('not_configured')
  if (env['NODE_ENV'] === 'development' && env['TELEGRAM_POLLING_ENABLED'] !== 'true')
    return result('not_configured')
  const started = Date.now()
  try {
    // One deadline bounds both authentication and delivery-configuration checks.
    const signal = AbortSignal.timeout(3000)
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`, {
      signal,
    })
    if (!res.ok || !((await res.json()) as { ok?: boolean }).ok)
      return result('down', 'telegram.unreachable')
    if (env['NODE_ENV'] === 'production') {
      const secret = env['TELEGRAM_WEBHOOK_SECRET']
      const baseUrl = (env['TELEGRAM_WEBHOOK_BASE_URL'] || env['DEVON_PUBLIC_URL'])?.replace(
        /\/+$/,
        '',
      )
      const polling = env['TELEGRAM_TRANSPORT'] === 'polling'
      if (!polling && (!secret || !baseUrl)) return result('down', 'telegram.webhookMismatch')
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
        signal,
      })
      if (!response.ok) return result('down', 'telegram.unreachable')
      const webhook = (await response.json()) as {
        ok?: boolean
        result?: {
          url?: string
          pending_update_count?: number
          last_error_date?: number
          last_error_message?: string
        }
      }
      if (!webhook.ok) return result('down', 'telegram.unreachable')
      if (polling) {
        if (webhook.result?.url || !pollingHealthy())
          return result('down', 'telegram.deliveryDelayed')
        return { ...result('ok'), latencyMs: Date.now() - started }
      }
      // Do not follow, log or return Telegram's URL: it includes our secret and may point elsewhere.
      if (webhook.result?.url !== `${baseUrl}/api/v1/telegram/webhook/${secret}`)
        return result('down', 'telegram.webhookMismatch')
      const pending = webhook.result.pending_update_count ?? 0
      const errorAge = Date.now() / 1000 - (webhook.result.last_error_date ?? 0)
      if (
        pending > 0 &&
        errorAge >= 0 &&
        errorAge < 900 &&
        /SSL|certificate|\b(?:401|403|404)\b/i.test(webhook.result.last_error_message ?? '')
      )
        return result('down', 'telegram.deliveryDelayed')
      if (pending > 100 || (pending > 0 && errorAge >= 0 && errorAge < 900))
        return result('degraded', 'telegram.deliveryDelayed')
    }
    return { ...result('ok'), latencyMs: Date.now() - started }
  } catch {
    return result('down', 'telegram.unreachable')
  }
}

/** Production publishes non-sensitive success metadata; the API cannot read database dumps. */
export async function probeBackups(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<ProbeResult> {
  const statusFile = env['DEVON_BACKUP_STATUS_FILE']
  const dir = env['DEVON_BACKUP_DIR'] || env['BACKUP_DIR']
  if (!statusFile && !dir) return result('not_configured')
  try {
    let newest = 0
    if (statusFile) {
      const status = JSON.parse(await readFile(statusFile, 'utf8')) as {
        completedAt?: string
        bytes?: number
      }
      if (!status.completedAt || !status.bytes || status.bytes <= 0)
        return result('degraded', 'backups.none')
      newest = Date.parse(status.completedAt)
    } else if (dir) {
      const entries = (await readdir(dir)).filter((name) => /^devon-.+\.dump(?:\.gpg)?$/.test(name))
      const files = await Promise.all(entries.map((name) => stat(join(dir, name))))
      newest = files
        .filter((s) => s.isFile() && s.size > 0)
        .reduce((latest, s) => Math.max(latest, s.mtimeMs), 0)
    }
    if (!Number.isFinite(newest) || newest <= 0 || newest > now + 300_000)
      return result('degraded', 'backups.none')
    const hours = (now - newest) / 3_600_000
    return {
      status: hours > 48 ? 'degraded' : 'ok',
      detail: { code: 'backups.latest', params: { hours: Math.max(0, Math.round(hours)) } },
      latencyMs: null,
    }
  } catch {
    return result('down', 'backups.unreadable')
  }
}
