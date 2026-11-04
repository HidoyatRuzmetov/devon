import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, IconButton } from '@devon/ui'
import { FlipHorizontal2, RotateCwSquare, Undo2 } from 'lucide-react'

export function AvatarCrop({
  file,
  onSave,
  onClose,
  aspectRatio = 1,
}: {
  file: File
  onSave: (file: File) => void
  onClose: () => void
  aspectRatio?: number
}) {
  const t = useT()
  const [image, setImage] = React.useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = React.useState(1),
    [rotation, setRotation] = React.useState(0),
    [flip, setFlip] = React.useState(false)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 }),
    [saving, setSaving] = React.useState(false),
    [failed, setFailed] = React.useState(false)
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const pointers = React.useRef(new Map<number, { x: number; y: number }>())
  const transform = React.useRef({ zoom: 1, x: 0, y: 0 })
  const SIZE = 640,
    HEIGHT = Math.round(SIZE / aspectRatio)
  React.useEffect(() => {
    if (
      file.size > 10 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      setFailed(true)
      return
    }
    const url = URL.createObjectURL(file),
      img = new Image()
    let active = true
    img.onload = () => {
      if (active) {
        if (img.naturalWidth * img.naturalHeight > 60_000_000) setFailed(true)
        else setImage(img)
      }
    }
    img.onerror = () => {
      if (active) setFailed(true)
    }
    img.src = url
    return () => {
      active = false
      URL.revokeObjectURL(url)
    }
  }, [file])
  function bounds(next: { x: number; y: number }, nextZoom = zoom) {
    if (!image) return { x: 0, y: 0 }
    const w = rotation % 180 ? image.naturalHeight : image.naturalWidth,
      h = rotation % 180 ? image.naturalWidth : image.naturalHeight
    const scale = Math.max(SIZE / w, HEIGHT / h) * nextZoom
    return {
      x: Math.max(-(w * scale - SIZE) / 2, Math.min((w * scale - SIZE) / 2, next.x)),
      y: Math.max(-(h * scale - HEIGHT) / 2, Math.min((h * scale - HEIGHT) / 2, next.y)),
    }
  }
  const clamped = bounds(offset)
  transform.current = { zoom, ...clamped }
  function applyTransform(nextZoom: number, point: { x: number; y: number }) {
    const boundedZoom = Math.max(1, Math.min(4, nextZoom))
    const next = bounds(point, boundedZoom)
    transform.current = { zoom: boundedZoom, ...next }
    setZoom(boundedZoom)
    setOffset(next)
  }
  // Trackpad pinch is ctrl+wheel. Non-passive handling prevents browser page zoom.
  React.useEffect(() => {
    const element = canvas.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!image || saving || failed) return
      const rect = element.getBoundingClientRect()
      const old = transform.current
      const nextZoom = Math.max(1, Math.min(4, old.zoom * Math.exp(-event.deltaY * 0.008)))
      const x = ((event.clientX - rect.left - rect.width / 2) * SIZE) / rect.width
      const y = ((event.clientY - rect.top - rect.height / 2) * HEIGHT) / rect.height
      applyTransform(nextZoom, {
        x: x + ((old.x - x) * nextZoom) / old.zoom,
        y: y + ((old.y - y) * nextZoom) / old.zoom,
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
    // Gesture state comes from the ref, including batched pointer moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rotation, saving, failed, HEIGHT])
  React.useEffect(() => {
    setOffset({ x: clamped.x, y: clamped.y })
  }, [clamped.x, clamped.y])
  React.useEffect(() => {
    if (!image || !canvas.current) return
    const context = canvas.current.getContext('2d')
    if (!context) return
    const w = rotation % 180 ? image.naturalHeight : image.naturalWidth,
      h = rotation % 180 ? image.naturalWidth : image.naturalHeight
    const scale = Math.max(SIZE / w, HEIGHT / h) * zoom
    context.clearRect(0, 0, SIZE, HEIGHT)
    context.save()
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, SIZE, HEIGHT)
    context.translate(SIZE / 2 + clamped.x, HEIGHT / 2 + clamped.y)
    context.rotate((rotation * Math.PI) / 180)
    context.scale(flip ? -scale : scale, scale)
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    context.restore()
  }, [image, zoom, rotation, flip, clamped.x, clamped.y, HEIGHT])
  function reset() {
    pointers.current.clear()
    transform.current = { zoom: 1, x: 0, y: 0 }
    setZoom(1)
    setRotation(0)
    setFlip(false)
    setOffset({ x: 0, y: 0 })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent title={t('photoEditor.title')} className="max-w-120" showClose={false}>
        <div className="my-4 flex justify-between gap-2">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t('checkins.cancel')}
          </Button>
          <Button
            disabled={!image || failed || saving}
            onClick={() => {
              setSaving(true)
              canvas.current?.toBlob(
                (blob) => {
                  if (blob) onSave(new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' }))
                  else {
                    setFailed(true)
                    setSaving(false)
                  }
                },
                'image/jpeg',
                0.94,
              )
            }}
          >
            {t('photoEditor.apply')}
          </Button>
        </div>

        <div
          className="relative mx-auto w-full max-w-88 overflow-hidden rounded-xl bg-muted shadow-inner"
          style={{ aspectRatio }}
        >
          <canvas
            ref={canvas}
            width={SIZE}
            height={HEIGHT}
            role="img"
            aria-label={t('photoEditor.preview')}
            className="h-full w-full touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => {
              if (saving || !image || failed || e.button !== 0 || pointers.current.size >= 2) return
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            }}
            onPointerMove={(e) => {
              const previous = pointers.current.get(e.pointerId)
              if (!previous || saving) return
              e.preventDefault()
              const before = [...pointers.current.values()]
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
              const rect = e.currentTarget.getBoundingClientRect()
              const scale = SIZE / rect.width
              const old = transform.current
              if (before.length === 2) {
                const after = [...pointers.current.values()]
                const distance = (points: typeof before) =>
                  Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
                const nextZoom = Math.max(
                  1,
                  Math.min(4, (old.zoom * distance(after)) / Math.max(1, distance(before))),
                )
                const center = (points: typeof before) => ({
                  x: ((points[0]!.x + points[1]!.x) / 2 - rect.left - rect.width / 2) * scale,
                  y: ((points[0]!.y + points[1]!.y) / 2 - rect.top - rect.height / 2) * scale,
                })
                const a = center(before),
                  b = center(after)
                applyTransform(nextZoom, {
                  x: b.x + ((old.x - a.x) * nextZoom) / old.zoom,
                  y: b.y + ((old.y - a.y) * nextZoom) / old.zoom,
                })
              } else {
                applyTransform(old.zoom, {
                  x: old.x + (e.clientX - previous.x) * scale,
                  y: old.y + (e.clientY - previous.y) * scale,
                })
              }
            }}
            onPointerUp={(e) => {
              pointers.current.delete(e.pointerId)
            }}
            onPointerCancel={(e) => {
              pointers.current.delete(e.pointerId)
            }}
            onLostPointerCapture={(e) => {
              pointers.current.delete(e.pointerId)
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 border border-white/60"
          >
            <div className="absolute inset-x-1/3 inset-y-0 border-x border-white/30" />
            <div className="absolute inset-y-1/3 inset-x-0 border-y border-white/30" />
            {aspectRatio === 1 ? (
              <div className="absolute inset-0 rounded-full border border-white/50 shadow-[0_0_0_4rem_#00000025]" />
            ) : null}
          </div>
        </div>
        {failed ? (
          <p role="alert" className="mt-3 text-small text-destructive">
            {t('photoEditor.error')}
          </p>
        ) : null}
        <fieldset
          disabled={!image || saving || failed}
          className="mt-5 flex justify-center gap-6 border-t border-border pt-4"
        >
          <IconButton
            aria-label={t('photoEditor.rotate')}
            onClick={() => {
              setRotation((r) => (r + 90) % 360)
              setOffset({ x: 0, y: 0 })
            }}
          >
            <RotateCwSquare />
          </IconButton>
          <IconButton
            aria-label={t('photoEditor.flip')}
            aria-pressed={flip}
            onClick={() => setFlip(!flip)}
          >
            <FlipHorizontal2 />
          </IconButton>
          <IconButton aria-label={t('photoEditor.reset')} onClick={reset}>
            <Undo2 />
          </IconButton>
        </fieldset>
      </DialogContent>
    </Dialog>
  )
}
