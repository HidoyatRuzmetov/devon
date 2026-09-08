// H26.1/H9.1 baseline: GET /api/v1/analytics/summary latency at 1/10/100 VUs -- the heaviest read on
// the six main routes (aggregation over the department's cards/events), and the one H9.1 asks to have
// stampede protection ("never cache private JSON across users; stampede protection for analytics
// aggregates"): repeated identical requests here are exactly a cache-stampede shape.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE_URL, loginOnce, authHeaders, SUMMARY_TREND_STATS } from './lib.js'

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '30s',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: { http_req_failed: ['rate<1'] },
}

export function setup() {
  return loginOnce()
}

export default function (auth) {
  const res = http.get(`${BASE_URL}/api/v1/analytics/summary`, {
    headers: authHeaders(auth),
    tags: { name: 'GET /api/v1/analytics/summary' },
  })
  check(res, { 'status is 200': (r) => r.status === 200 })
  sleep(0.2)
}
