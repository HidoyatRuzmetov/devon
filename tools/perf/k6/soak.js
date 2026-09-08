// H11.1 baseline: 10-minute soak at 10 VUs mixing all four endpoints, while a companion process
// samples the API's RSS every 30s (tools/perf/memory/sample-rss.mjs) -- "k6 soak (30 min) shows flat
// memory" (H11.1); this baseline runs 10 minutes per the task's ask, same method, shorter window.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE_URL, loginOnce, authHeaders } from './lib.js'

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '10m',
  thresholds: { http_req_failed: ['rate<1'] },
}

export function setup() {
  const auth = loginOnce()
  const boardRes = http.get(`${BASE_URL}/api/v1/board`, { headers: authHeaders(auth) })
  const board = boardRes.json()
  const cardIds = []
  for (const col of board.columns || []) for (const c of col.cards || []) cardIds.push(c.id)
  const eventsRes = http.get(`${BASE_URL}/api/v1/events`, { headers: authHeaders(auth) })
  const events = eventsRes.json()
  const open = (events.items || []).find((e) => e.status === 'open')
  return { auth, cardIds, eventId: open && open.id }
}

let i = 0
export default function ({ auth, cardIds, eventId }) {
  i += 1
  const step = i % 4
  if (step === 0) {
    const r = http.get(`${BASE_URL}/api/v1/board`, { headers: authHeaders(auth) })
    check(r, { board_ok: (x) => x.status === 200 })
  } else if (step === 1 && cardIds.length) {
    const id = cardIds[i % cardIds.length]
    const r = http.patch(`${BASE_URL}/api/v1/cards/${id}`, JSON.stringify({ orderKey: i % 2 ? 'a0300' : 'a0400' }), { headers: authHeaders(auth) })
    check(r, { move_ok: (x) => x.status === 200 || x.status === 409 })
  } else if (step === 2 && eventId) {
    const r = http.post(`${BASE_URL}/api/v1/events/${eventId}/rsvp`, JSON.stringify({ status: i % 2 ? 'yes' : 'maybe', guests: 0 }), { headers: authHeaders(auth) })
    check(r, { rsvp_ok: (x) => x.status === 200 })
  } else {
    const r = http.get(`${BASE_URL}/api/v1/analytics/summary`, { headers: authHeaders(auth) })
    check(r, { analytics_ok: (x) => x.status === 200 })
  }
  sleep(1)
}
