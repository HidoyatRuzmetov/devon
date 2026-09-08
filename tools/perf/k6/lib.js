// Shared helpers for the k6 scripts in this directory (H26.1/H12.1 baseline load tests).
// Every script logs in once in setup() (runs once on the k6 test-runner, not per VU) as demo.boshliq
// and hands the session + CSRF cookie values to every VU via the object setup() returns -- k6 VUs
// cannot share a live cookie jar with the setup() context, so the Cookie/x-csrf-token headers are
// built by hand and attached to every request instead of relying on k6's per-VU auto cookie jar.
import http from 'k6/http'
import { fail } from 'k6'

export const BASE_URL = __ENV.TARGET || 'http://host.docker.internal:3000'
const DEMO_USER = __ENV.DEVON_PERF_USER || 'demo.boshliq'
const DEMO_PASSWORD = __ENV.DEVON_PERF_PASSWORD || 'Ishonchli#2026'

export function loginOnce() {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ login: DEMO_USER, password: DEMO_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  if (res.status !== 204) {
    fail(`login failed: ${res.status} ${res.body}`)
  }
  const sid = res.cookies['devon_sid'] && res.cookies['devon_sid'][0] && res.cookies['devon_sid'][0].value
  const csrf = res.cookies['devon_csrf'] && res.cookies['devon_csrf'][0] && res.cookies['devon_csrf'][0].value
  if (!sid || !csrf) fail(`login did not return devon_sid/devon_csrf cookies (got: ${JSON.stringify(res.cookies)})`)
  return { sid, csrf }
}

export function authHeaders(auth, extra) {
  return Object.assign(
    {
      Cookie: `devon_sid=${auth.sid}; devon_csrf=${auth.csrf}`,
      'x-csrf-token': auth.csrf,
      'Content-Type': 'application/json',
    },
    extra || {},
  )
}

export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max']
