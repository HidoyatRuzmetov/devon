// The shared copy of a canvas, with live cursors (v1.1 SPEC §10, EPIC-018).
//
// SHARED PRIMITIVE (see this package's notes): rendered from `features/personal`'s canvas detail,
// under the private editor, whenever the person has published that canvas somewhere.
//
// Two things are worth saying out loud about what this component is *not*:
//
//   * It is not a window onto the private canvas. It renders `app.shared_canvases`, a department-
//     owned copy, reached through `/canvas-shares/:id` -- a separate row with separate RLS. Nothing
//     here can read `app.personal_canvases`, which stays owner-only for ever (I-1).
//   * It is not a second editor. Editing the copy belongs on the project/event page where colleagues
//     actually meet; here the owner sees what they published, who is on it right now, and the one
//     control that matters -- taking it back.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Badge, Button, Card, Dialog, DialogContent, StateView, toast } from '@devon/ui'
import { MousePointer2, Share2, Undo2 } from 'lucide-react'
import { useMeQuery } from '../../../lib/session.js'
import {
  useCanvasShareQuery,
  useLiveCursors,
  useRevokeCanvasShare,
} from '../../../lib/realtime/canvas-hooks.js'
import { usePresence } from '../../../lib/realtime/index.js'
import { PresenceAvatars } from './live-indicators.js'
import type { SharedCanvasSummary } from '../../../lib/realtime/canvas-api.js'

/** A colleague's pointer, drawn over the shared canvas preview. */
function Cursor({ x, y, name }: { x: number; y: number; name: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-10 flex items-start gap-1 transition-[left,top] duration-75 ease-linear"
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      <MousePointer2 className="size-4 -scale-x-100 text-primary drop-shadow" />
      {name ? (
        <span className="rounded-sm bg-primary px-1.5 py-0.5 text-caption text-primary-foreground">
          {name}
        </span>
      ) : null}
    </span>
  )
}

export function SharedCanvasPanel({ share }: { share: SharedCanvasSummary }): React.JSX.Element {
  const t = useT()
  const viewerId = useMeQuery().data?.user.id ?? null
  const detail = useCanvasShareQuery(share.id)
  const revoke = useRevokeCanvasShare()
  const [confirming, setConfirming] = React.useState(false)
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)

  const channel = detail.data?.channel ?? null
  const watchers = usePresence(channel)
  const { cursors, publishCursor } = useLiveCursors(
    // Cursors only where they are wanted: a read-only share is a thing colleagues look at, and four
    // pointers drifting over something nobody may change is noise.
    detail.data?.allowEdit ? channel : null,
    viewerId,
  )

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const el = surfaceRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    // Fractions, not pixels -- see `useLiveCursors`' own note on why.
    publishCursor((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
  }

  function surface(): React.JSX.Element {
    if (detail.isPending) {
      return <StateView kind="loading" titleKey="realtime.canvas.loading.title" compact />
    }
    if (detail.isError) {
      return (
        <StateView
          kind="error"
          titleKey="realtime.canvas.error.title"
          bodyKey="realtime.canvas.error.body"
          action={{ labelKey: 'calendar.actions.retry', onAction: () => void detail.refetch() }}
          compact
        />
      )
    }
    return (
      <div
        ref={surfaceRef}
        onPointerMove={onPointerMove}
        className="relative min-h-32 overflow-hidden rounded-md border border-dashed border-border bg-surface-2 p-3"
      >
        <p className="text-caption text-muted-foreground">
          {cursors.length > 0
            ? t('realtime.canvas.cursors.label')
            : t('realtime.canvas.cursors.nobody')}
        </p>
        {cursors.map((cursor) => (
          <Cursor key={cursor.userId} x={cursor.x} y={cursor.y} name={cursor.name} />
        ))}
      </div>
    )
  }

  const scopeLabel =
    share.scope === 'project'
      ? t('realtime.canvas.shared.toProject', { name: share.title })
      : t('realtime.canvas.shared.toEvent', { name: share.title })

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">
            <Share2 aria-hidden="true" className="size-3.5" />
            {t('realtime.canvas.shared.badge')}
          </Badge>
          <span className="text-body text-foreground">{scopeLabel}</span>
          <Badge tone="neutral">
            {share.allowEdit
              ? t('realtime.canvas.shared.editable')
              : t('realtime.canvas.shared.readOnly')}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars members={watchers} />
          {share.canManage ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              <Undo2 aria-hidden="true" className="size-4" />
              {t('realtime.canvas.revoke.action')}
            </Button>
          ) : null}
        </div>
      </div>

      {surface()}

      {/* Revoking closes a thing colleagues may be looking at this second, and it cannot be undone
          with one press (re-sharing makes a fresh copy). So this asks first -- one of the few places
          in the product that does, for the same reason renewing a feed secret does. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent title={t('realtime.canvas.revoke.confirmTitle')} className="max-w-md">
          <div className="flex flex-col gap-4">
            <p className="text-body text-muted-foreground">
              {t('realtime.canvas.revoke.confirmBody')}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('realtime.canvas.revoke.cancel')}
              </Button>
              <Button
                variant="primary"
                loading={revoke.isPending}
                onClick={() =>
                  revoke.mutate(share.id, {
                    onSuccess: () => {
                      setConfirming(false)
                      toast.success(t('realtime.canvas.revoke.toast'))
                    },
                  })
                }
              >
                {t('realtime.canvas.revoke.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export default SharedCanvasPanel
