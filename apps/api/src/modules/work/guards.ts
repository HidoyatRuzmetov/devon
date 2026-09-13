// The work module's permission helpers, in one file so `index.ts` (the v1.0 card routes) and
// `plus-routes.ts` (the v1.1 SPEC §7 surfaces) make the *same* decision rather than two copies of
// it. Every function here reduces to `can()` from `@devon/contracts`; none of them hand-rolls a
// `role === 'head'` check (I-7).
import type { FastifyReply, FastifyRequest } from 'fastify'
import { can } from '@devon/contracts'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from './context.js'
import * as repo from './repo.js'
import type { CardDTO } from './schemas.js'

export function departmentChildSubject(departmentId: string | null) {
  return {
    kind: 'department_child' as const,
    departmentId: departmentId ?? '',
  }
}

/** v1.1 SPEC §2.2 (D6d): a shared vocabulary (labels), the workload grid and the department's goals
 * are head-shaped -- one set of decisions everyone works under, not something any member may add
 * to. Head-only for reads *and* writes. */
export function departmentManagedSubject(departmentId: string | null) {
  return {
    kind: 'department_managed' as const,
    departmentId: departmentId ?? '',
  }
}

/** The viewer's own personal scope: a focus list, a reminder. Owner-only, with no head or super
 * admin exception, exactly like the personal workspace (I-1). */
export function ownViewerSubject(req: FastifyRequest) {
  return { kind: 'personal' as const, ownerUserId: req.actor?.userId ?? '' }
}

/** `''` (no membership) never satisfies `can()` for any real department id, so this is a safe,
 * fail-closed default -- a request with no active department is denied, never accidentally scoped
 * to "no filter at all". */
export function requireDepartmentId(req: {
  actor: { departmentId: string | null } | null
}): string | null {
  return req.actor?.departmentId ?? null
}

/**
 * v1.1 SPEC §2.1 (D6a/b/c/e). The route-level `can()` has already proven membership; this is the
 * per-object half of the same decision, made by the same function (`can()` with `{kind:'owned'}`),
 * never a hand-rolled `role === 'head'`.
 *
 * Answers 404 for a card that is not this department's -- identical to what every read route says
 * about a foreign id (H1.2) -- and 403 for a real card the caller neither gave, was given, nor
 * created. Returns the owner set on success so a caller that needs it (the watcher route) can
 * refine further.
 */
export async function requireCardOwnership(
  req: FastifyRequest,
  reply: FastifyReply,
  departmentId: string,
  cardId: string,
): Promise<{ ok: true; ownerUserIds: string[] } | { ok: false }> {
  const owners = await repo.getCardOwners(contextFromRequest(req), departmentId, cardId)
  if (!owners) {
    sendProblem(reply, 'not_found')
    return { ok: false }
  }
  const decision = can(req.actor, 'update', {
    kind: 'owned',
    departmentId,
    ownerUserIds: owners.ownerUserIds,
  })
  if (!decision.allowed) {
    sendProblem(reply, 'forbidden')
    return { ok: false }
  }
  return { ok: true, ownerUserIds: owners.ownerUserIds }
}

/** Stamps the server's answer to "may this viewer edit this card?" onto every card DTO that leaves
 * this module, so the board, the table and the card sheet hide or disable exactly what the server
 * would refuse (PERMISSIONS-AUDIT Step 5). Pure JS over rows already loaded -- no extra query. */
export function withCanEdit<T extends CardDTO>(
  cards: T[],
  actorUserId: string,
  isHead: boolean,
): T[] {
  return cards.map((card) => ({
    ...card,
    canEdit:
      isHead ||
      card.createdByUserId === actorUserId ||
      card.giverUserId === actorUserId ||
      card.assigneeUserId === actorUserId,
  }))
}
