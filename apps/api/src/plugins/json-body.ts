// Request-body bounds (HARDENING H7.4: "Limits on request body, JSON depth, upload size, AI input
// length").
//
// Fastify caps the body's *size*; nothing capped its *nesting*. Several write schemas in this API
// are recursive by nature -- the rich-text document (`packages/contracts/src/rich-text.ts`), the
// canvas scene, nested personal tasks -- and Zod validates a recursive schema by recursing. A body
// well under the size limit can therefore be nested tens of thousands of levels deep
// (`{"type":"doc","content":[{"type":"doc","content":[ ... ` is ~26 bytes per level), which makes
// the *validator itself* overflow the stack. A `RangeError: Maximum call stack size exceeded` thrown
// inside a Zod parse is not a caught 422; in the worst case it takes the process down, and this
// product runs one API process on one server (H8.3). One unauthenticated-shaped POST would do it.
//
// The depth is measured on the raw text, before `JSON.parse` is called and long before Zod sees
// anything, in one linear pass with an early exit -- so the check itself cannot be the expensive part.
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

/** Deepest nesting any legitimate body in this product reaches, with a wide margin. */
export const MAX_JSON_DEPTH = 64

/**
 * Greatest bracket nesting in `text`, ignoring brackets inside JSON strings. Returns as soon as
 * `limit` is exceeded, so a hostile body costs O(bytes until the limit) rather than O(body).
 */
export function exceedsJsonDepth(text: string, limit: number = MAX_JSON_DEPTH): boolean {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') {
      depth += 1
      if (depth > limit) return true
    } else if (ch === '}' || ch === ']') depth -= 1
  }
  return false
}

export default fp(async function jsonBodyPlugin(app: FastifyInstance) {
  // Replaces Fastify's built-in `application/json` parser. Same contract as the default one -- an
  // empty body is `FST_ERR_CTP_EMPTY_JSON_BODY`, malformed JSON is `FST_ERR_CTP_INVALID_JSON_BODY`,
  // both already 400s -- with the depth check in front of `JSON.parse`.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (body === '' || body === null || body === undefined) {
        const err = new Error('Body cannot be empty when content-type is set to application/json')
        Object.assign(err, { statusCode: 400, code: 'FST_ERR_CTP_EMPTY_JSON_BODY' })
        done(err as Error, undefined)
        return
      }
      if (exceedsJsonDepth(body)) {
        const err = new Error(`JSON body is nested deeper than ${MAX_JSON_DEPTH} levels`)
        Object.assign(err, { statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' })
        done(err as Error, undefined)
        return
      }
      try {
        done(null, JSON.parse(body))
      } catch (cause) {
        const err = cause instanceof Error ? cause : new Error('Invalid JSON body')
        Object.assign(err, { statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' })
        done(err, undefined)
      }
    },
  )
})
