// RFC 9457 Problem Details (design.md §1.5, I-6, H1.13). `detail` is drawn from a frozen table of
// literal, English sentences -- never user input, an id, SQL or a stack path -- so a Problem body can
// never carry domain data by construction. `problem()` is the only way to build one; nothing in
// `@devon/api` should ever hand-assemble a Problem object field by field.
import { z } from 'zod'

export const PROBLEM_CODES = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'gone',
  'conflict',
  'validation_failed',
  'rate_limited',
  'maintenance',
  'internal',
] as const
export type ProblemCode = (typeof PROBLEM_CODES)[number]

export const problemSchema = z.object({
  type: z.string(), // 'https://devon.local/problems/forbidden' -- stable, no domain data
  title: z.string(), // short English, stable; clients localise from `code`
  status: z.number().int(),
  code: z.enum(PROBLEM_CODES),
  detail: z.string().optional(), // fixed sentences only; NEVER user input, ids, SQL, paths
  instance: z.string().optional(), // 'urn:devon:request:01J...'
  errors: z.array(z.object({ path: z.string(), code: z.string() })).optional(), // validation only
})
export type Problem = z.infer<typeof problemSchema>

type ProblemTableEntry = { status: number; title: string; detail: string }

/** Frozen literal table (design.md §1.5). Every sentence here is fixed English; a unit test asserts
 * none of them, nor anything `problem()` ever emits, contains a uuid, a login, an email, `select `,
 * `/src/`, or `at Object.` (mechanises AC-11's "no domain data" and H1.13). */
const PROBLEM_TABLE: Readonly<Record<ProblemCode, ProblemTableEntry>> = Object.freeze({
  unauthenticated: {
    status: 401,
    title: 'Unauthenticated',
    detail: 'Authentication is required to access this resource.',
  },
  forbidden: {
    status: 403,
    title: 'Forbidden',
    detail: 'You do not have permission to perform this action.',
  },
  not_found: {
    status: 404,
    title: 'Not Found',
    detail: 'The requested resource does not exist.',
  },
  gone: {
    status: 410,
    title: 'Gone',
    detail: 'This resource is no longer available.',
  },
  conflict: {
    status: 409,
    title: 'Conflict',
    detail: 'The request could not be completed because of a conflict with the current state.',
  },
  validation_failed: {
    status: 422,
    title: 'Validation Failed',
    detail: 'The request did not pass validation.',
  },
  rate_limited: {
    status: 429,
    title: 'Too Many Requests',
    detail: 'Too many requests. Slow down and try again.',
  },
  maintenance: {
    status: 503,
    title: 'Service Unavailable',
    detail: 'The service is temporarily unavailable for maintenance.',
  },
  internal: {
    status: 500,
    title: 'Internal Server Error',
    detail: 'An unexpected error occurred.',
  },
})

export type ProblemOptions = {
  /** 'urn:devon:request:<request id>' -- an opaque request identifier, never a domain id. */
  instance?: string
  /** `validation_failed` only: field path + machine-readable code, never the offending value. */
  errors?: ReadonlyArray<{ path: string; code: string }>
}

/** The only way to build a `Problem`. `type`/`title`/`status`/`detail` come from the frozen table
 * above and cannot be overridden by a caller, so no handler can accidentally interpolate domain data
 * into a response body a client is allowed to see. */
export function problem(code: ProblemCode, options: ProblemOptions = {}): Problem {
  const entry = PROBLEM_TABLE[code]
  return {
    type: `https://devon.local/problems/${code}`,
    title: entry.title,
    status: entry.status,
    code,
    detail: entry.detail,
    ...(options.instance !== undefined ? { instance: options.instance } : {}),
    ...(options.errors !== undefined ? { errors: options.errors.map((e) => ({ ...e })) } : {}),
  }
}
