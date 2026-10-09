// Real board movement through the current POST /cards/:id/move contract. Every VU shares
// one local synthetic head session and round-robins across active editable board cards.
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
  if (boardRes.status !== 200)
    throw new Error(`board fetch failed in setup: ${boardRes.status} ${boardRes.body}`)
  const board = boardRes.json()
  const cards = []
  for (const col of board.columns || [])
    for (const c of col.cards || [])
      if (c.canEdit !== false && !c.assigneeUnavailable)
        cards.push({ id: c.id, assigneeUserId: c.assigneeUserId })
  for (const c of board.unassigned || [])
    if (c.canEdit !== false && !c.assigneeUnavailable)
      cards.push({ id: c.id, assigneeUserId: null })
  if (cards.length === 0) throw new Error('no editable active cards on the local demo board')
  return { auth, cards }
}

let counter = __VU // offset so concurrent VUs don't all start on the same card
export default function ({ auth, cards }) {
  const card = cards[counter % cards.length]
  counter += 1
  const res = http.post(
    `${BASE_URL}/api/v1/cards/${card.id}/move`,
    JSON.stringify({
      toUserId: card.assigneeUserId,
      targetCardId: null,
      edge: counter % 2 === 0 ? 'before' : 'after',
    }),
    { headers: authHeaders(auth), tags: { name: 'POST /api/v1/cards/:id/move' } },
  )
  check(res, {
    'status is 200 or 409 (concurrent move on shared demo card)': (r) =>
      r.status === 200 || r.status === 409,
  })
  sleep(0.2)
}
