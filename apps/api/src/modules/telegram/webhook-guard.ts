// Webhook authentication and replay protection (HARDENING H1.14, H10.1).
//
// Three independent problems the previous implementation had, all fixed here:
//
// 1. The `secret_token` Telegram was told to send (`setWebhook(url, { secret_token })`) was never
//    checked. Telegram puts it in `X-Telegram-Bot-Api-Secret-Token` on every delivery, and that is
//    the header Telegram's own documentation calls the way to "ensure that the request comes from a
//    webhook set by you". Only the copy in the URL path was compared -- and a URL leaks: into proxy
//    access logs (`infra/Caddyfile` logs every request), into `Referer`, into error reports. Both
//    are now required, so a secret recovered from a log alone is not enough.
// 2. Both comparisons were `!==` on strings, which returns as soon as two bytes differ. Over enough
//    requests that is a byte-by-byte oracle for the secret. Both are `timingSafeEqual` now.
// 3. Nothing stopped a captured delivery from being replayed. Telegram's `update_id` is strictly
//    increasing per bot, so a bounded high-water mark plus a small window of recently-seen ids
//    rejects a replay without keeping unbounded state (H11.1: every map in this process is bounded).
import { timingSafeEqual, createHash } from 'node:crypto'

export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token'

/** Constant-time string comparison. Both sides are hashed first so the comparison is over two
 * equal-length digests -- `timingSafeEqual` throws on a length mismatch, and the length of the
 * secret must not itself be observable through that throw. */
export function secretsEqual(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}

/**
 * Bounded replay window for Telegram `update_id`s (H10.1, H11.1).
 *
 * Telegram guarantees `update_id` increases monotonically for a bot and re-sends an update only
 * until it is acknowledged, so "already seen, or older than everything in the window" is exactly the
 * replay condition. The window is a fixed-capacity insertion-ordered `Set`: at most `capacity` ids
 * are ever held, and the oldest is evicted on overflow, so a flood of updates cannot grow this
 * process's heap.
 */
export class UpdateReplayWindow {
  readonly #seen = new Set<number>()
  #lowWaterMark = Number.NEGATIVE_INFINITY

  constructor(private readonly capacity = 2048) {}

  /** `true` when this id has not been seen and is not older than the window; records it. */
  accept(updateId: number): boolean {
    if (!Number.isFinite(updateId)) return false
    if (this.#seen.has(updateId)) return false
    if (updateId <= this.#lowWaterMark) return false

    this.#seen.add(updateId)
    if (this.#seen.size > this.capacity) {
      const oldest = this.#seen.values().next()
      if (!oldest.done) {
        this.#seen.delete(oldest.value)
        // Everything at or below the evicted id is now outside the window and is refused outright,
        // rather than being silently re-accepted once it has fallen out of the `Set`.
        this.#lowWaterMark = Math.max(this.#lowWaterMark, oldest.value)
      }
    }
    return true
  }

  get size(): number {
    return this.#seen.size
  }

  /** A failed handler has not acknowledged delivery; allow Telegram's bounded retries to retry it. */
  release(updateId: number): void {
    this.#seen.delete(updateId)
  }
}
