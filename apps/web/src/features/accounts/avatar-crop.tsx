import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, IconButton } from '@devon/ui'
import { FlipHorizontal2, RotateCcw, RotateCw } from 'lucide-react'

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
  const canvas = React.useRef<HTMLCanvasElement>(null),
    pointer = React.useRef<{ id: number; x: number; y: number } | null>(null)
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
  function bounds(next: { x: number; y: number }) {
    if (!image) return { x: 0, y: 0 }
    const w = rotation % 180 ? image.naturalHeight : image.naturalWidth,
      h = rotation % 180 ? image.naturalWidth : image.naturalHeight
    const scale = Math.max(SIZE / w, HEIGHT / h) * zoom
    return {
      x: Math.max(-(w * scale - SIZE) / 2, Math.min((w * scale - SIZE) / 2, next.x)),
      y: Math.max(-(h * scale - HEIGHT) / 2, Math.min((h * scale - HEIGHT) / 2, next.y)),
    }
  }
  const clamped = bounds(offset)
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
      <DialogContent title={t('photoEditor.title')} className="max-w-120">
        <p className="my-3 text-small text-muted-foreground">
          {t(aspectRatio === 1 ? 'photoEditor.hint' : 'personnel.photoHint')}
        </p>
        <div
          className="relative mx-auto w-full max-w-72 overflow-hidden rounded-lg bg-muted"
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
              if (saving) return
              e.currentTarget.setPointerCapture(e.pointerId)
              pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
            }}
            onPointerMove={(e) => {
              const p = pointer.current
              if (!p || p.id !== e.pointerId) return
              const scale = SIZE / e.currentTarget.getBoundingClientRect().width
              setOffset(
                bounds({
                  x: clamped.x + (e.clientX - p.x) * scale,
                  y: clamped.y + (e.clientY - p.y) * scale,
                }),
              )
              pointer.current = { id: p.id, x: e.clientX, y: e.clientY }
            }}
            onPointerUp={() => {
              pointer.current = null
            }}
            onPointerCancel={() => {
              pointer.current = null
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
        <fieldset disabled={!image || saving || failed} className="mt-4 space-y-3">
          <label className="flex items-center gap-3 text-small">
            {t('photoEditor.zoom')}
            <input
              className="min-w-0 flex-1 accent-primary"
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <output className="w-12 text-right tabular-nums">{Math.round(zoom * 100)}%</output>
          </label>
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <IconButton
                aria-label={t('photoEditor.rotate')}
                onClick={() => {
                  setRotation((r) => (r + 90) % 360)
                  setOffset({ x: 0, y: 0 })
                }}
              >
                <RotateCw />
              </IconButton>
              <IconButton
                aria-label={t('photoEditor.flip')}
                aria-pressed={flip}
                onClick={() => setFlip(!flip)}
              >
                <FlipHorizontal2 />
              </IconButton>
              <IconButton aria-label={t('photoEditor.reset')} onClick={reset}>
                <RotateCcw />
              </IconButton>
            </div>
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={t('photoEditor.position')}
            >
              {(['left', 'up', 'down', 'right'] as const).map((direction, index) => (
                <IconButton
                  key={direction}
                  aria-label={t(`photoEditor.${direction}`)}
                  onClick={() =>
                    setOffset(
                      bounds({
                        x:
                          clamped.x + (direction === 'left' ? -20 : direction === 'right' ? 20 : 0),
                        y: clamped.y + (direction === 'up' ? -20 : direction === 'down' ? 20 : 0),
                      }),
                    )
                  }
                >
                  {['←', '↑', '↓', '→'][index]}
                </IconButton>
              ))}
            </div>
          </div>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
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
      </DialogContent>
    </Dialog>
  )
}
