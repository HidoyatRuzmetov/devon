// H26.1/H12.1 baseline: GET /api/v1/board latency at 1/10/100 VUs.
// Run: see tools/perf/k6/run-all.mjs (docker run --rm --network host -v ...:/scripts -v ...:/out
//   grafana/k6 run --vus <n> --duration <t> -e TARGET=http://host.docker.internal:3000
//   --summary-export=/out/board-load-<n>vu.json /scripts/board-load.js)
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE_URL, loginOnce, authHeaders, SUMMARY_TREND_STATS } from './lib.js'

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '30s',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: { http_req_failed: ['rate<1'] }, // report-only: never abort the run, keep the numbers
}

export function setup() {
  return loginOnce()
}

export default function (auth) {
  const res = http.get(`${BASE_URL}/api/v1/board`, { headers: authHeaders(auth), tags: { name: 'GET /api/v1/board' } })
  check(res, { 'status is 200': (r) => r.status === 200 })
  sleep(0.2)
}
