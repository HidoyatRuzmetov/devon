// RFC 9457 replies (design.md §1.5). `application/problem+json` and `Cache-Control: private, no-store`
// are set here, once, so no handler can forget either (I-6, design.md §1.7 conventions).
import type { FastifyReply } from 'fastify'
import { problem, type ProblemCode, type ProblemOptions } from '@devon/contracts'

export function sendProblem(
  reply: FastifyReply,
  code: ProblemCode,
  options: ProblemOptions = {},
): void {
  const body = problem(code, options)
  reply
    .code(body.status)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .header('cache-control', 'private, no-store')
    .send(body)
}
