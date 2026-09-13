// Web Push (VAPID, RFC 8030 / 8291 / 8292) -- v1.1 SPEC §10, EPIC-019.
//
// What it is for: a reminder or a mention reaching a xodim's phone when WorkPortal is not the tab in
// front of them. Opt-in per person, per browser, revocable from the same screen, and silent by
// default for everything else -- a government internal tool that pushes chatter to a phone gets its
// permission revoked once and never gets it back.
//
// `web-push@3.6.7` does the two things that must not be hand-rolled: the VAPID JWT (ES256 over the
// push service's origin) and the aes128gcm payload encryption to the browser's own P-256 key. Both
// are cryptographic protocol work with a wrong answer that fails silently, which is exactly when a
// battle-tested library earns its place (TECH-SPEC §1.2 "pin exact versions" -- it is pinned).
//
// The keypair is instance-wide and generated once, on first use, into `app.push_vapid_keys` (see the
// migration's note): a self-hosted ministry box has no place to paste a key into, and rotating it
// silently unsubscribes every browser. `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` in the environment win
// when both are set, for the operator who would rather keep it outside the database.
import webpush from 'web-push'
import { withTimeout } from '../../lib/resilience/timeout.js'
import { CircuitBreaker } from '../../lib/resilience/circuit-breaker.js'
import {
  listPushSubscriptions,
  loadVapidKeys,
  markPushFailure,
  markPushSent,
  saveVapidKeys,
  type VapidKeypair,
} from './repo.js'

const PUSH_TIMEOUT_MS = 5000

const breaker = new CircuitBreaker({
  name: 'web-push',
  failureThreshold: 8,
  resetTimeoutMs: 30_000,
})

let cached: VapidKeypair | null = null
let loading: Promise<VapidKeypair> | null = null

/** The `mailto:` a push service is told to contact if this deployment misbehaves (RFC 8292 §2.1).
 * Deliberately a non-personal address: it identifies the deployment, not a civil servant. */
function vapidSubject(publicUrl: string): string {
  try {
    const host = new URL(publicUrl).hostname
    return `mailto:workportal@${host}`
  } catch {
    return 'mailto:workportal@localhost'
  }
}

export async function vapidKeys(): Promise<VapidKeypair> {
  if (cached) return cached
  const fromEnv = {
    publicKey: (process.env['VAPID_PUBLIC_KEY'] ?? '').trim(),
    privateKey: (process.env['VAPID_PRIVATE_KEY'] ?? '').trim(),
  }
  if (fromEnv.publicKey && fromEnv.privateKey) {
    cached = fromEnv
    return cached
  }
  // One in-flight generation per process: two concurrent first requests must not each write a
  // keypair (the insert is `on conflict do nothing`, so even then only one would survive -- this
  // just avoids the pointless second round trip).
  loading ??= (async () => {
    const existing = await loadVapidKeys()
    if (existing) return existing
    const generated = webpush.generateVAPIDKeys()
    return saveVapidKeys({ publicKey: generated.publicKey, privateKey: generated.privateKey })
  })()
  try {
    cached = await loading
    return cached
  } finally {
    loading = null
  }
}

export type PushMessage = {
  title: string
  body: string
  /** Where clicking the notification lands, relative to the app's own origin. */
  deepLink: string
  /** Collapses an older notification about the same subject instead of stacking a second one. */
  tag: string
  reason: string
}

export type PushSendResult = { sent: number; failed: number; skipped: boolean }

/**
 * Sends one message to every enabled browser of one person. Never throws: a push that does not
 * arrive is a missed nicety, and the inbox row it mirrors is already committed.
 *
 * `sendNotification` calls are made in parallel over a person's own handful of devices (at most 20
 * by the repo's own `limit`), which is a bounded fan-out, not a query in a loop -- the subscription
 * list itself was fetched in one statement.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage,
  publicUrl: string,
): Promise<PushSendResult> {
  const subscriptions = await listPushSubscriptions(userId)
  if (subscriptions.length === 0) return { sent: 0, failed: 0, skipped: true }

  const keys = await vapidKeys()
  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    deepLink: message.deepLink,
    tag: message.tag,
    reason: message.reason,
  })

  const options = {
    vapidDetails: {
      subject: vapidSubject(publicUrl),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    },
    TTL: 3600,
  }

  const outcomes = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await breaker.execute(() =>
          withTimeout(
            webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.authSecret },
              },
              payload,
              options,
            ),
            PUSH_TIMEOUT_MS,
            'web-push.send',
          ),
        )
        return { ok: true as const, endpoint: sub.endpoint }
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        await markPushFailure(userId, sub.endpoint, status === 404 || status === 410)
        return { ok: false as const, endpoint: sub.endpoint }
      }
    }),
  )

  const delivered = outcomes.filter((o) => o.ok).map((o) => o.endpoint)
  await markPushSent(userId, delivered)
  return {
    sent: delivered.length,
    failed: outcomes.length - delivered.length,
    skipped: false,
  }
}

/** Test-only: forget the memoised keypair between cases. */
export function __resetPushKeysForTests(): void {
  cached = null
  loading = null
}
