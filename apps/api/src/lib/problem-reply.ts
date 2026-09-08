// RFC 9457 replies (design.md §1.5). `application/problem+json` and `Cache-Control: private, no-store`
// are set here, once, so no handler can forget either (I-6, design.md §1.7 conventions).
import type { FastifyReply } from 'fastify'
import { problem, type ProblemCode, type ProblemOptions } from '@devon/contracts'

export type SendProblemOptions = ProblemOptions & {
  /**
   * Override the HTTP status *and* the body's `status` member. The one legitimate use is a
   * transport-level failure that has no `ProblemCode` of its own but must not be reported with the
   * code's table status: a body past `bodyLimit` is `validation_failed` semantically but `413`, not
   * `422`, on the wire (`src/app.ts`'s `FST_ERR_CTP_BODY_TOO_LARGE` branch). `type`/`title`/`detail`
   * still come from the frozen table -- this never lets a handler write its own Problem text.
   */
  status?: number
}

export function sendProblem(
  reply: FastifyReply,
  code: ProblemCode,
  options: SendProblemOptions = {},
): void {
  const { status, ...problemOptions } = options
  const body = problem(code, problemOptions)
  const httpStatus = status ?? body.status
  reply
    .code(httpStatus)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .header('cache-control', 'private, no-store')
    .send(status === undefined ? body : { ...body, status: httpStatus })
}
