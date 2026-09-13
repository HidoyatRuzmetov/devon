// React Query hooks over `canvas-api.ts`, plus the live-cursor layer for a shared canvas.
//
// Cursors are the one thing in this product a browser publishes directly to Centrifugo rather than
// through the API (`canvas:` is the only namespace with `allow_publish_for_subscriber`). The reason
// is arithmetic: a cursor at 10 Hz through an HTTP endpoint is ten authenticated requests per second
// per participant, which is a denial of service you wrote yourself. Safety is preserved by
// Centrifugo stamping every client publication with the connection's own `info` -- so even here a
// participant cannot put a colleague's name on a cursor -- and by the channel being reachable only
// with a per-channel token the API mints after `can()` (`modules/realtime/index.ts`).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '../api-schemas.js'
import * as api from './canvas-api.js'
import { publishToCanvas, subscribeChannel } from './client.js'

function useCsrfToken(): string {
  const queryClient = useQueryClient()
  return queryClient.getQueryData<Me | null>(['me'])?.csrfToken ?? ''
}

export const canvasShareKeys = {
  list: () => ['realtime', 'canvas-shares'] as const,
  detail: (id: string) => ['realtime', 'canvas-share', id] as const,
}

export function useCanvasSharesQuery() {
  return useQuery({ queryKey: canvasShareKeys.list(), queryFn: api.listCanvasShares })
}

/** Every live share of one private canvas. Usually zero or one, which is why the filter is done here
 * rather than as a second endpoint. */
export function useSharesOfCanvas(sourceCanvasId: string | null) {
  const query = useCanvasSharesQuery()
  const items = React.useMemo(
    () =>
      sourceCanvasId
        ? (query.data?.items ?? []).filter((s) => s.sourceCanvasId === sourceCanvasId)
        : [],
    [query.data, sourceCanvasId],
  )
  return { ...query, shares: items }
}

export function useCanvasShareQuery(id: string | null) {
  return useQuery({
    queryKey: canvasShareKeys.detail(id ?? ''),
    queryFn: () => api.fetchCanvasShare(id!),
    enabled: id !== null,
  })
}

export function useShareCanvas() {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: (input: api.ShareCanvasInput) => api.shareCanvas(input, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: canvasShareKeys.list() }),
  })
}

export function useRevokeCanvasShare() {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.revokeCanvasShare(id, csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: canvasShareKeys.list() }),
  })
}

export function useUpdateCanvasShare(id: string) {
  const queryClient = useQueryClient()
  const csrfToken = useCsrfToken()
  return useMutation({
    mutationFn: (body: { scene: unknown; stickies: unknown; baseVersion?: number }) =>
      api.updateCanvasShare(id, body, csrfToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: canvasShareKeys.detail(id) })
      void queryClient.invalidateQueries({ queryKey: canvasShareKeys.list() })
    },
  })
}

export type LiveCursor = {
  userId: string
  name: string
  /** Fractions of the canvas viewport (0..1), never pixels: two people on two screen sizes must see
   * each other's cursor over the same *content*, and a pixel coordinate would put a colleague's
   * pointer somewhere else entirely on a laptop. */
  x: number
  y: number
  at: number
}

const CURSOR_TTL_MS = 5000
/** 20 Hz is smooth; publishing at the pointer's own rate is not meaningfully smoother and is several
 * times the traffic. */
const CURSOR_THROTTLE_MS = 50

/**
 * Live cursors on one shared canvas: publishes this person's, collects everyone else's.
 *
 * Only ever called for a *shared* canvas -- the private one has no channel, and `channel` is null
 * there, which makes every function below a no-op. That is the whole enforcement story on the client
 * side, and the server's is that `canvas:<id>` only exists for a row in `app.shared_canvases`.
 */
export function useLiveCursors(
  channel: string | null,
  viewerId: string | null,
): {
  cursors: LiveCursor[]
  publishCursor: (x: number, y: number) => void
} {
  const [cursors, setCursors] = React.useState<LiveCursor[]>([])
  const lastSent = React.useRef(0)

  React.useEffect(() => {
    if (!channel) {
      setCursors([])
      return
    }
    return subscribeChannel(channel, (message) => {
      if (message.type !== 'cursor') return
      const userId = typeof message.payload['userId'] === 'string' ? message.payload['userId'] : ''
      const x = typeof message.payload['x'] === 'number' ? message.payload['x'] : null
      const y = typeof message.payload['y'] === 'number' ? message.payload['y'] : null
      const name = typeof message.payload['name'] === 'string' ? message.payload['name'] : ''
      if (!userId || x === null || y === null) return
      if (viewerId && userId === viewerId) return
      setCursors((current) => [
        ...current.filter((c) => c.userId !== userId),
        { userId, name, x, y, at: Date.now() },
      ])
    })
  }, [channel, viewerId])

  // One timer for every cursor on the canvas, not one per cursor (H11.1: bounded work, timers
  // cleared). A pointer that stopped moving five seconds ago belongs to somebody who has left.
  React.useEffect(() => {
    if (cursors.length === 0) return
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - CURSOR_TTL_MS
      setCursors((current) => {
        const next = current.filter((c) => c.at > cutoff)
        return next.length === current.length ? current : next
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cursors.length])

  const publishCursor = React.useCallback(
    (x: number, y: number) => {
      if (!channel) return
      const now = Date.now()
      if (now - lastSent.current < CURSOR_THROTTLE_MS) return
      lastSent.current = now
      // No name and no user id in the body: Centrifugo attaches the connection's own `info`, and the
      // API echoes it back on the publication -- which is exactly why a forged cursor is not
      // expressible. The coordinates are the only thing the browser gets to say.
      void publishToCanvas(channel, { type: 'cursor', payload: { x, y } })
    },
    [channel],
  )

  return { cursors, publishCursor }
}
