// Shared timeout helper for outbound calls that do not already take an `AbortSignal` (H8.1: "every
// outbound call has a timeout"). `glm-provider.ts`, `s3-store.ts` and `clamav.ts` each already bound
// their own I/O this way; this is the same shape for the remaining call sites (Telegram) so every
// integration adapter under `resilience/registry.ts` uses one timeout idiom, not four.
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/** Races `promise` against a timer. The timer is always cleared (H11.1 "timers cleared") whichever
 * side wins -- a resolved/rejected `promise` after the timeout has already fired is simply ignored by
 * the caller (the timeout's rejection already propagated), never a leak: nothing here holds a
 * reference to `promise` once this function returns. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    // Never the sole reason the process stays alive.
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
