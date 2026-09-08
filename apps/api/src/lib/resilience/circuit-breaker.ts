// Generic circuit breaker for outbound dependencies (H8.1: "timeouts and circuit breakers for AI,
// Telegram, ClamAV, MinIO"). Every state this class holds is a handful of scalars (H11.1: bounded
// memory) -- there is no per-call history, no growing map, nothing that scales with traffic.
//
// Classic three-state machine (closed -> open -> half-open -> closed|open):
//   - `closed`: calls run normally; consecutive failures are counted.
//   - `open`: calls are rejected immediately with `CircuitOpenError`, never reaching the dependency,
//     until `resetTimeoutMs` has passed since the breaker tripped.
//   - `half-open`: exactly one probe call is allowed through; success closes the breaker, failure
//     re-opens it (and restarts the reset timer).
//
// Deliberately in-process and per-dependency (one instance per integration, see `registry.ts`), never
// shared across processes -- a breaker's whole job is to protect *this* process's outbound sockets
// from a dependency that is down, not to coordinate a fleet (TECH-SPEC §12: the API is stateless, so
// nothing here may become a hidden source of cross-request or cross-instance state that would break
// that).
export type CircuitState = 'closed' | 'open' | 'half_open'

export class CircuitOpenError extends Error {
  constructor(public readonly breakerName: string) {
    super(`circuit "${breakerName}" is open -- failing fast without calling the dependency`)
    this.name = 'CircuitOpenError'
  }
}

export type CircuitBreakerOptions = {
  name: string
  /** Consecutive failures (in `closed`) before the breaker trips to `open`. */
  failureThreshold: number
  /** How long the breaker stays `open` before allowing one `half_open` probe. */
  resetTimeoutMs: number
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number
}

export type CircuitSnapshot = {
  name: string
  state: CircuitState
  consecutiveFailures: number
  lastError: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  /** Only meaningful while `state === 'open'` -- when the next probe is allowed. */
  opensUntil: string | null
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private consecutiveFailures = 0
  private openedAt = 0
  private lastError: string | null = null
  private lastSuccessAt: number | null = null
  private lastFailureAt: number | null = null
  private readonly now: () => number

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now
  }

  get name(): string {
    return this.options.name
  }

  /** Whether a call would be allowed to run right now, without side effects (the health/metrics
   * endpoints use this to report status without mutating state). */
  isCallAllowed(): boolean {
    if (this.state !== 'open') return true
    return this.now() - this.openedAt >= this.options.resetTimeoutMs
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0
    this.lastSuccessAt = this.now()
    this.state = 'closed'
  }

  private recordFailure(err: unknown): void {
    this.consecutiveFailures += 1
    this.lastFailureAt = this.now()
    this.lastError = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)
    if (this.state === 'half_open' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'open'
      this.openedAt = this.now()
    }
  }

  /**
   * Runs `fn` if the breaker allows it; throws `CircuitOpenError` immediately (never calling `fn`)
   * when it does not. A single probe is allowed through once `resetTimeoutMs` has passed while
   * `open` -- its outcome alone decides whether the breaker closes or re-opens.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.now() - this.openedAt < this.options.resetTimeoutMs) {
        throw new CircuitOpenError(this.options.name)
      }
      this.state = 'half_open'
    }
    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (err) {
      this.recordFailure(err)
      throw err
    }
  }

  /** Test/ops-only escape hatch: force the breaker back to a known-good state (never called from
   * request-handling code). */
  reset(): void {
    this.state = 'closed'
    this.consecutiveFailures = 0
    this.openedAt = 0
  }

  snapshot(): CircuitSnapshot {
    return {
      name: this.options.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      opensUntil:
        this.state === 'open' ? new Date(this.openedAt + this.options.resetTimeoutMs).toISOString() : null,
    }
  }
}
