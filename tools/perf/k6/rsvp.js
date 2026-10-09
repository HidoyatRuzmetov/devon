// H26.1/H10.1 baseline: POST /api/v1/events/:eventId/rsvp latency at 1/10/100 VUs.
// Every VU shares the single demo.boshliq session (no per-VU demo users exist in this repo), and RSVP
// is an upsert keyed by (event_id, user_id) -- so at VUS>1 this deliberately hammers ONE row, which is
// the point: it is this baseline's signal for H10.1's "RSVP/seat/poll races tested with parallel
// requests" row-contention concern, not a simulation of many citizens RSVPing to different events.
import http from 'k6/http'
import { check, sleep } from 'k6'
import {
  BASE_URL,
  loginOnce,
  authHeaders,
  SUMMARY_TREND_STATS,
  ownedFixtureCreationAllowed,
} from './lib.js'

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '30s',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: { http_req_failed: ['rate<1'] },
}

export function setup() {
  const createFixture = ownedFixtureCreationAllowed()
  const auth = loginOnce()
  if (createFixture) {
    const future = Date.now() + 86_400_000
    const created = http.post(
      `${BASE_URL}/api/v1/events`,
      JSON.stringify({
        title: `Local performance RSVP ${Date.now()}`,
        startsAt: new Date(future).toISOString(),
        endsAt: new Date(future + 3_600_000).toISOString(),
        capacity: 100000,
        reminderOffsetsMinutes: [],
      }),
      { headers: authHeaders(auth) },
    )
    if (created.status !== 201)
      throw new Error(`owned future RSVP fixture creation failed: ${created.status}`)
    return { auth, eventId: created.json().id, created: true }
  }
  const eventsRes = http.get(`${BASE_URL}/api/v1/events`, { headers: authHeaders(auth) })
  if (eventsRes.status !== 200)
    throw new Error(`events fetch failed in setup: ${eventsRes.status} ${eventsRes.body}`)
  const events = eventsRes.json()
  // Must be an "open" event with no passed RSVP deadline -- upsertRsvp 409s ("rsvp_deadline_passed")
  // for status != "no" once the deadline (or the event itself) is in the past (apps/api/src/modules/
  // events/service.ts), and several demo events are deliberately already `done`/`cancelled`/`full`.
  const open = (events.items || []).find(
    (e) =>
      e.status === 'open' &&
      Date.parse(e.startsAt) > Date.now() &&
      (!e.rsvpDeadline || Date.parse(e.rsvpDeadline) > Date.now()),
  )
  const eventId = open && open.id
  if (!eventId)
    throw new Error('no "open" event on the demo calendar to RSVP to -- is the demo seed loaded?')
  return { auth, eventId }
}

export function teardown({ auth, eventId, created }) {
  if (!created) return
  const response = http.post(
    `${BASE_URL}/api/v1/events/${eventId}/cancel`,
    JSON.stringify({ reason: 'Local performance fixture cleanup' }),
    { headers: authHeaders(auth) },
  )
  check(response, { 'own future fixture cancelled': (r) => r.status === 200 })
}

const STATUSES = ['yes', 'maybe', 'no']
let i = 0
export default function ({ auth, eventId }) {
  const status = STATUSES[i % STATUSES.length]
  i += 1
  const res = http.post(
    `${BASE_URL}/api/v1/events/${eventId}/rsvp`,
    JSON.stringify({ status, guests: 0 }),
    { headers: authHeaders(auth), tags: { name: 'POST /api/v1/events/:id/rsvp' } },
  )
  check(res, { 'status is 200': (r) => r.status === 200 })
  sleep(0.2)
}
