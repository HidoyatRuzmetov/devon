// Typed domain errors for the events module. `index.ts`'s route handlers catch these and map them to
// the exact RFC 9457 `Problem` the rest of the codebase already uses (`apps/api/src/lib/problem-
// reply.ts`) -- `service.ts` never touches Fastify's `reply` itself, so it stays testable with plain
// function calls (see `apps/api/test/unit/events/*.test.ts`).
export class EventNotFoundError extends Error {
  constructor(message = 'Event not found') {
    super(message)
    this.name = 'EventNotFoundError'
  }
}

export class EventForbiddenError extends Error {
  constructor(message = 'Not allowed to manage this event') {
    super(message)
    this.name = 'EventForbiddenError'
  }
}

/** 409: capacity full with waitlisting disabled, RSVP deadline passed, poll closed, voting on the
 * wrong option shape for the poll's kind, feedback submitted twice, etc. */
export class EventConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EventConflictError'
  }
}
