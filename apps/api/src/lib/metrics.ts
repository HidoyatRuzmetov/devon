// A small, dependency-free Prometheus text-exposition writer (H15.1: "/metrics endpoint (Prometheus
// format)"). No client library is pulled in on purpose -- the one candidate at this codebase's pinned-
// versions bar (`prom-client`) is itself deprecated upstream in favour of a pre-1.0, unproven
// replacement package, and this codebase's own convention for a small, well-understood wire protocol
// is to speak it directly (see `lib/storage/clamav.ts`'s header for the identical reasoning about
// clamd's INSTREAM protocol) rather than take on a dependency for ~150 lines of formatting.
//
// Every structure below is BOUNDED (H11.1): a route/method/status label combination is drawn from a
// small, closed set (this app's own route table -- see `route-label` usage in `metrics-plugin.ts`),
// never from unbounded user input, so the label-keyed maps below can never grow without limit for the
// lifetime of a process.

export type Labels = Record<string, string>

function labelKey(labels: Labels): string {
  // Sorted so the same label SET always produces the same map key regardless of insertion order.
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${JSON.stringify(labels[k])}`)
    .join(',')
}

const LABEL_VALUE_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
}

function escapeLabelValue(value: string): string {
  return value.replace(/[\\"\n]/g, (c) => LABEL_VALUE_ESCAPES[c]!)
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels)
  if (entries.length === 0) return ''
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',')}}`
}

/** Monotonically increasing count, optionally labeled (e.g. `http_requests_total{route,method,status}`). */
export class Counter {
  private readonly values = new Map<string, { labels: Labels; value: number }>()
  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels)
    const entry = this.values.get(key)
    if (entry) entry.value += by
    else this.values.set(key, { labels, value: by })
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

/** A point-in-time value that can go up or down (e.g. `db_pool_connections_in_use`). */
export class Gauge {
  private readonly values = new Map<string, { labels: Labels; value: number }>()
  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  set(value: number, labels: Labels = {}): void {
    this.values.set(labelKey(labels), { labels, value })
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`]
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

/** Fixed-bucket histogram (Prometheus's classic shape: cumulative `_bucket{le=...}` counters plus
 * `_sum`/`_count`) -- used for request-latency and DB-timing distributions (H15.1 "latency histograms
 * per route", "DB timing"). Buckets are a small, fixed array set at construction, so `observe()` never
 * allocates a new bucket -- the label-keyed map is the only thing that grows, and only up to the
 * number of distinct label combinations this app's own route table produces (bounded, see this
 * file's header). */
export class Histogram {
  private readonly series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >()
  constructor(
    public readonly name: string,
    public readonly help: string,
    private readonly buckets: readonly number[],
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels)
    let series = this.series.get(key)
    if (!series) {
      series = { labels, counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 }
      this.series.set(key, series)
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) series.counts[i]! += 1
    }
    series.sum += value
    series.count += 1
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`]
    for (const { labels, counts, sum, count } of this.series.values()) {
      for (let i = 0; i < this.buckets.length; i++) {
        lines.push(
          `${this.name}_bucket${formatLabels({ ...labels, le: String(this.buckets[i]) })} ${counts[i]}`,
        )
      }
      lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${count}`)
      lines.push(`${this.name}_sum${formatLabels(labels)} ${sum}`)
      lines.push(`${this.name}_count${formatLabels(labels)} ${count}`)
    }
    return lines.join('\n')
  }
}

type Metric = { render(): string }

class Registry {
  private readonly metrics: Metric[] = []
  register<T extends Metric>(metric: T): T {
    this.metrics.push(metric)
    return metric
  }
  render(): string {
    return this.metrics.map((m) => m.render()).join('\n\n') + '\n'
  }
}

/** Module-singleton registry, exactly like `lib/resilience/registry.ts`'s breakers -- one process,
 * one set of counters, never rebuilt per request. */
export const registry = new Registry()

// -- HTTP (H15.1: "latency histograms per route", "error rates") -----------------------------------
export const httpRequestDuration = registry.register(
  new Histogram(
    'devon_http_request_duration_seconds',
    'HTTP request duration in seconds, labeled by method, route and status code',
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ),
)
export const httpRequestsTotal = registry.register(
  new Counter(
    'devon_http_requests_total',
    'Total HTTP requests, labeled by method, route and status',
  ),
)
export const httpSlowRequestsTotal = registry.register(
  new Counter(
    'devon_http_slow_requests_total',
    'HTTP requests slower than the slow-request threshold (see request-logging.ts)',
  ),
)

// -- AI (H15.1: "AI latency/cost") ------------------------------------------------------------------
export const aiRequestDuration = registry.register(
  new Histogram(
    'devon_ai_request_duration_seconds',
    'AI feature-run duration in seconds, labeled by feature and status',
    [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
  ),
)
export const aiCostUzsTotal = registry.register(
  new Counter('devon_ai_cost_uzs_total', 'Total AI spend in UZS, labeled by feature'),
)
export const aiTokensTotal = registry.register(
  new Counter('devon_ai_tokens_total', 'Total AI tokens consumed, labeled by feature and kind'),
)

// -- Circuit breakers (H8.1/H15.1) ------------------------------------------------------------------
export const circuitBreakerState = registry.register(
  new Gauge(
    'devon_circuit_breaker_state',
    'Circuit breaker state by name: 0=closed, 1=half_open, 2=open',
  ),
)
export const circuitBreakerFailuresTotal = registry.register(
  new Counter(
    'devon_circuit_breaker_failures_total',
    'Total failures recorded by each circuit breaker',
  ),
)

// -- Queues (H15.1: "queue metrics") -----------------------------------------------------------------
export const queuePendingGauge = registry.register(
  new Gauge('devon_queue_pending', 'Pending items in a background queue, labeled by queue name'),
)
export const queueDeadLetterGauge = registry.register(
  new Gauge('devon_queue_dead_letter', 'Dead-lettered jobs, labeled by queue name'),
)
