// Browser side of web push (v1.1 SPEC §10, EPIC-019): register the service worker, ask the person
// once, hand the resulting subscription to the API, and take it away again on request.
//
// Everything here is defensive by construction. Web push is the single most environment-dependent
// API in the product -- it does not exist at all in a non-secure context, Safari only offers it to
// an installed home-screen app, a corporate policy can block it outright, and the permission prompt
// can be dismissed rather than answered. So every function returns a *described outcome* rather than
// throwing, and the screen renders that description in words; nothing here ever leaves the caller
// guessing why a button did nothing.

/** Every state the push panel can honestly be in. */
export type PushSupport =
  /** No `serviceWorker`, no `PushManager`, or not a secure context. */
  | 'unsupported'
  /** Supported, and the person has not been asked yet (or has dismissed the prompt). */
  | 'prompt'
  /** Supported and allowed. */
  | 'granted'
  /** The browser has blocked notifications for this origin; only the person can undo that. */
  | 'denied'

export type PushEnableResult =
  | { ok: true; endpoint: string; keys: { p256dh: string; auth: string } }
  | { ok: false; reason: 'unsupported' | 'denied' | 'dismissed' | 'failed' }

/** The one registration URL, in every environment: the API serves the worker and widens its scope
 * with `Service-Worker-Allowed: /` (see `apps/api/src/modules/realtime/service-worker.ts`). Vite
 * proxies `/api` in development and Caddy proxies it in production, so this is same-origin both
 * times and needs no build-time switch. */
const SERVICE_WORKER_URL = '/api/v1/realtime/sw.js'

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator)) return 'unsupported'
  if (!('PushManager' in window)) return 'unsupported'
  if (!('Notification' in window)) return 'unsupported'
  // A service worker is only available in a secure context. `localhost` counts as one, which is why
  // development works over plain http.
  if (!window.isSecureContext) return 'unsupported'
  const permission = Notification.permission
  if (permission === 'granted') return 'granted'
  if (permission === 'denied') return 'denied'
  return 'prompt'
}

/** VAPID hands out the application server key base64url-encoded; `PushManager.subscribe` wants the
 * raw bytes. Hand-rolled rather than pulled from a library: it is eight lines and adding a
 * dependency for a base64 variant would be the wrong trade. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(normalised)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A short, human name for this browser, shown in the "connected devices" list so a person can tell
 * their phone from their desk machine and remove the right one.
 *
 * Deliberately coarse -- a family name and a platform word, nothing that identifies the device
 * beyond what its owner already knows (I-2: no personal data we were not asked for). Parsed from the
 * user-agent string, which is the only thing available; a wrong guess costs a slightly odd label and
 * nothing else. */
export function describeThisBrowser(): string {
  if (typeof navigator === 'undefined') return ''
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  const platform = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return platform ? `${browser} · ${platform}` : browser
}

/** Registers (or reuses) the push service worker and waits until it is actually in control. */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL)
  if (existing) {
    // A registration that exists but has no active worker yet (first load of a fresh tab) is not
    // usable for `pushManager.subscribe` -- wait for the one the browser is bringing up.
    await navigator.serviceWorker.ready
    return existing
  }
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' })
  return navigator.serviceWorker.ready
}

/** The subscription this browser already holds, if any -- what the screen reads to decide whether
 * reminders are on *here*, as opposed to on some other device of the same person. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() === 'unsupported') return null
  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL)
    if (!registration) return null
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

export function subscriptionKeys(subscription: PushSubscription): {
  p256dh: string
  auth: string
} {
  return {
    p256dh: arrayBufferToBase64Url(subscription.getKey('p256dh')),
    auth: arrayBufferToBase64Url(subscription.getKey('auth')),
  }
}

/**
 * Asks for permission if needed, subscribes, and returns what the API needs to store.
 *
 * `userVisibleOnly: true` is not optional -- Chrome refuses a subscription without it, and it is
 * also the promise this product wants to make: every push this deployment can send results in a
 * visible notification, never a silent background wake-up.
 */
export async function enablePush(vapidPublicKey: string): Promise<PushEnableResult> {
  const support = pushSupport()
  if (support === 'unsupported') return { ok: false, reason: 'unsupported' }
  if (support === 'denied') return { ok: false, reason: 'denied' }
  if (!vapidPublicKey) return { ok: false, reason: 'failed' }

  let permission: NotificationPermission = Notification.permission
  if (permission !== 'granted') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }
  if (permission === 'denied') return { ok: false, reason: 'denied' }
  // "default" here means the prompt was dismissed rather than answered -- a different fact from a
  // refusal, and the screen says so differently (the person can simply try again).
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' }

  try {
    const registration = await readyRegistration()
    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      }))
    return { ok: true, endpoint: subscription.endpoint, keys: subscriptionKeys(subscription) }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/** Cancels this browser's subscription. Returns the endpoint that was cancelled so the caller can
 * tell the API which row to drop; `null` when there was nothing to cancel. */
export async function disablePush(): Promise<string | null> {
  const subscription = await currentSubscription()
  if (!subscription) return null
  const { endpoint } = subscription
  try {
    await subscription.unsubscribe()
  } catch {
    // The browser may already have dropped it (a rotation, a cleared site). Telling the API to
    // forget the endpoint is still the right next step, so this is not an error.
  }
  return endpoint
}
