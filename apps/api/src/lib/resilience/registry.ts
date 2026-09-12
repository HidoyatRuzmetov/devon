// One `CircuitBreaker` per outbound dependency this API talks to (H8.1). Module-singleton by design --
// exactly like `plugins/storage.ts`'s "first upload opens the socket" and `modules/ai/service.ts`'s
// cached provider, a breaker's whole point is per-process state, and the API has exactly one process
// per instance (TECH-SPEC §12 "stateless API": these breakers are process-local resilience state, not
// request/session state -- two instances tripping their own AI breaker independently is correct, not a
// statefulness violation, the same way each instance's own TCP connections are its own).
//
// Thresholds are deliberately generous (a handful of consecutive failures, not one) so a single
// transient blip never trips the breaker and masks a dependency that is actually fine -- the point is
// to stop *sustained* outages from making every request pay a full timeout, not to react to the first
// failure.
import { CircuitBreaker, type CircuitSnapshot } from './circuit-breaker.js'

export const ai = new CircuitBreaker({ name: 'ai', failureThreshold: 3, resetTimeoutMs: 30_000 })
export const telegram = new CircuitBreaker({
  name: 'telegram',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
})
export const clamav = new CircuitBreaker({
  name: 'clamav',
  failureThreshold: 3,
  resetTimeoutMs: 20_000,
})
export const storage = new CircuitBreaker({
  name: 'storage',
  failureThreshold: 5,
  resetTimeoutMs: 15_000,
})

const all = { ai, telegram, clamav, storage } as const

export function circuitSnapshots(): Record<keyof typeof all, CircuitSnapshot> {
  return {
    ai: ai.snapshot(),
    telegram: telegram.snapshot(),
    clamav: clamav.snapshot(),
    storage: storage.snapshot(),
  }
}

/** Test-only: every breaker back to `closed` with a clean slate, so one test's induced failures never
 * leak into the next (vitest resets modules between files, but not always between `it()`s in the same
 * file when the registry is imported once at module scope). */
export function __resetAllCircuitsForTests(): void {
  for (const breaker of Object.values(all)) breaker.reset()
}
