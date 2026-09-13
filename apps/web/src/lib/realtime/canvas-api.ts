// Shared-canvas endpoints (v1.1 SPEC §10, EPIC-018). Mirrors
// `apps/api/src/modules/realtime/index.ts`'s `/canvas-shares/*` family.
//
// **The sharing rule, in one paragraph**, decided in `packages/db/migrations/1800_realtime_calendar.sql`
// and documented in `docs/ops/REALTIME-CALENDAR.md`: `app.personal_canvases` stays owner-only for
// ever. Sharing does not open a window onto it -- it publishes an explicit, revocable **copy** into
// exactly one project or one event the owner belongs to. The copy is the thing colleagues see, live
// cursors and all; the private original is never touched, and revoking closes the copy and nothing
// else. This is why the client has a second set of endpoints rather than a `?shared=true` flag on the
// personal ones: they are two different objects with two different owners.
import { z } from 'zod'
import { apiClient } from '../api-client.js'

export const canvasScopeSchema = z.enum(['project', 'event'])
export type CanvasScope = z.infer<typeof canvasScopeSchema>

export const sharedCanvasSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  sourceCanvasId: z.string(),
  ownerUserId: z.string(),
  scope: canvasScopeSchema,
  targetId: z.string(),
  title: z.string(),
  scene: z.unknown(),
  stickies: z.unknown(),
  allowEdit: z.boolean(),
  updatedAt: z.string(),
  version: z.number().int(),
  canEdit: z.boolean(),
  canManage: z.boolean(),
  channel: z.string(),
})
export type SharedCanvas = z.infer<typeof sharedCanvasSchema>

/** The list shape drops `scene`/`stickies`/`channel`/`canEdit` -- a list of shares is an index, and
 * shipping every canvas's whole scene to draw a list of titles would be absurd. */
export const sharedCanvasSummarySchema = sharedCanvasSchema.omit({
  scene: true,
  stickies: true,
  channel: true,
  canEdit: true,
})
export type SharedCanvasSummary = z.infer<typeof sharedCanvasSummarySchema>

export const sharedCanvasListSchema = z.object({ items: z.array(sharedCanvasSummarySchema) })

export type ShareCanvasInput = {
  canvasId: string
  scope: CanvasScope
  targetId: string
  allowEdit: boolean
}

export function listCanvasShares() {
  return apiClient.get('/api/v1/canvas-shares', sharedCanvasListSchema)
}

export function fetchCanvasShare(id: string) {
  return apiClient.get(`/api/v1/canvas-shares/${id}`, sharedCanvasSchema)
}

export function shareCanvas(input: ShareCanvasInput, csrfToken: string) {
  return apiClient.post('/api/v1/canvas-shares', input, sharedCanvasSchema, csrfToken)
}

export function updateCanvasShare(
  id: string,
  body: { scene: unknown; stickies: unknown; baseVersion?: number },
  csrfToken: string,
) {
  return apiClient.patch(`/api/v1/canvas-shares/${id}`, body, sharedCanvasSchema, csrfToken)
}

export function revokeCanvasShare(id: string, csrfToken: string) {
  return apiClient.delete(
    `/api/v1/canvas-shares/${id}`,
    z.object({ revoked: z.boolean() }),
    csrfToken,
  )
}
