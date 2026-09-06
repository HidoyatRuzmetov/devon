// Typed errors this module's `repo.ts` throws and `index.ts`'s route handlers catch and turn into an
// RFC 9457 `Problem` via `sendProblem` -- keeps the business-rule decisions (settings gating, version
// conflicts, cross-department references) readable in `repo.ts` without threading a `Result` type
// through every call.
import type { ProblemCode } from '@devon/contracts'

export class StructureError extends Error {
  constructor(
    public readonly code: Extract<ProblemCode, 'forbidden' | 'not_found' | 'conflict'>,
    message: string,
  ) {
    super(message)
    this.name = 'StructureError'
  }
}
