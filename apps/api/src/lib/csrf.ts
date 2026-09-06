// Double-submit CSRF check for the one mutating endpoint this item ships (`PATCH /api/v1/me`).
// ADR-003 chooses `SameSite=Lax` over `Strict` for the whole product (cross-site top-level GETs like
// `/join/:key` need it); this is the compensating control it names. Two independent checks: the
// `X-CSRF-Token` header must match the non-HttpOnly `devon_csrf` cookie value (defeats a request that
// cannot read the cookie at all), AND its hash must match `sessions.csrf_hash` for the *current*
// session (defeats a cookie set by a sibling subdomain for a different session -- "cookie tossing").
import type { FastifyReply, FastifyRequest } from 'fastify'
import { sendProblem } from './problem-reply.js'
import { sha256Hex, hashesEqual } from './tokens.js'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './cookies.js'

export function checkCsrf(req: FastifyRequest, reply: FastifyReply): boolean {
  const header = req.headers[CSRF_HEADER_NAME]
  const cookie = req.cookies[CSRF_COOKIE_NAME]
  const headerValue = Array.isArray(header) ? header[0] : header

  if (!headerValue || !cookie || headerValue !== cookie || !req.csrfHash) {
    sendProblem(reply, 'forbidden')
    return false
  }
  if (!hashesEqual(sha256Hex(headerValue), req.csrfHash)) {
    sendProblem(reply, 'forbidden')
    return false
  }
  return true
}
