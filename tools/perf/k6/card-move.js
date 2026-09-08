// H26.1/H10.1 baseline: PATCH /api/v1/cards/:id ("card move") latency at 1/10/100 VUs.
// `version` is deliberately omitted from the patch body -- the handler only enforces optimistic
// concurrency when a caller sends `version` (apps/api/src/modules/work/index.ts), and every VU here
// shares the single demo.boshliq session (no per-VU demo users exist), so sending a fixed `version`
// would make every VU after the first hit a 409 on the same card. Each VU instead round-robins over
// every real card on the board (fetched once in setup()) so load spreads across rows instead of
// hammering a single one -- the (department_id, id) row lock contention that DOES matter is measured
// by tools/perf/k6/rsvp.js, which intentionally targets one row.
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
  const auth = loginOnce()
  const boardRes = http.get(`${BASE_URL}/api/v1/board`, { headers: authHeaders(auth) })
  if (boardRes.status !== 200) throw new Error(`board fetch failed in setup: ${boardRes.status} ${boardRes.body}`)
  const board = boardRes.json()
  const cardIds = []
  for (const col of board.columns || []) for (const c of col.cards || []) cardIds.push(c.id)
  for (const c of board.unassigned || []) cardIds.push(c.id)
  if (cardIds.length === 0) throw new Error('no cards on demo board to move -- is the demo seed loaded?')
  return { auth, cardIds }
}

let counter = __VU // offset so concurrent VUs don't all start on the same card
export default function ({ auth, cardIds }) {
  const id = cardIds[counter % cardIds.length]
  counter += 1
  // Alternate between two orderKeys so the write is a real, visible move rather than a no-op.
  const orderKey = counter % 2 === 0 ? 'a0100' : 'a0200'
  const res = http.patch(
    `${BASE_URL}/api/v1/cards/${id}`,
    JSON.stringify({ orderKey }),
    { headers: authHeaders(auth), tags: { name: 'PATCH /api/v1/cards/:id' } },
  )
  check(res, { 'status is 200 or 409 (concurrent move on shared demo card)': (r) => r.status === 200 || r.status === 409 })
  sleep(0.2)
}
