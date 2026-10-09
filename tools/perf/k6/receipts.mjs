export function k6Target(platform, port, native) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535)
    throw new Error('Invalid local performance port')
  return `http://${native || platform !== 'win32' ? '127.0.0.1' : 'host.docker.internal'}:${port}`
}

export function summarizeK6Receipt(json) {
  const metrics = json?.metrics
  if (!metrics || typeof metrics !== 'object') throw new Error('Missing actual k6 metrics')
  const duration = metrics.http_req_duration ?? {}
  return {
    reqs: metrics.http_reqs?.count ?? null,
    iterations: metrics.iterations?.count ?? 0,
    checksPassed: metrics.checks?.passes ?? 0,
    checksFailed: metrics.checks?.fails ?? 0,
    failedRate: metrics.http_req_failed?.value ?? null,
    p50: duration['p(50)'] ?? duration.med ?? null,
    p90: duration['p(90)'] ?? null,
    p95: duration['p(95)'] ?? null,
    p99: duration['p(99)'] ?? null,
    avg: duration.avg ?? null,
    max: duration.max ?? null,
  }
}

export function completedScenario(summary) {
  return Boolean(
    summary &&
    Number.isFinite(summary.reqs) &&
    summary.reqs > 0 &&
    Number.isFinite(summary.iterations) &&
    summary.iterations > 0 &&
    Number.isFinite(summary.checksPassed) &&
    summary.checksPassed > 0 &&
    summary.checksFailed === 0,
  )
}
