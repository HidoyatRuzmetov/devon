// Canvas list + the active editor (TECH-SPEC §3.3). No route param for "which canvas is open" --
// `src/lib/router.tsx`'s five core routes (and this feature's one route) are exact-path only, so the
// selection lives in this component's own state instead, same tradeoff MODULE-GUIDE.md documents for
// every feature today.
import * as React from 'react'
import { useT, useLocale, formatDateTime } from '@devon/i18n'
import { ArrowLeft, Check, Loader2, Plus, Share2, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  EmptyPersonalIllustration,
  IconButton,
  Input,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import { useSharesOfCanvas } from '../../lib/realtime/canvas-hooks.js'
import { CanvasShareDialog } from '../calendar/components/canvas-share-dialog.js'
import { SharedCanvasPanel } from '../calendar/components/shared-canvas-panel.js'
import { CanvasEditor } from './canvas-editor.js'
import { useQueuedSave } from './lib/use-queued-save.js'
import type { Canvas, PatchCanvasInput } from './types.js'
import {
  useCanvasQuery,
  useCanvasesQuery,
  useCreateCanvasMutation,
  useDeleteCanvasMutation,
  usePatchCanvasMutation,
} from './use-personal.js'

export function CanvasView() {
  const t = useT()
  const locale = useLocale()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const canvasesQuery = useCanvasesQuery()
  const createCanvas = useCreateCanvasMutation()
  const deleteCanvasMutation = useDeleteCanvasMutation()

  if (selectedId) {
    return (
      <CanvasDetail
        key={selectedId}
        id={selectedId}
        onBack={() => setSelectedId(null)}
        onDeleted={() => setSelectedId(null)}
      />
    )
  }

  if (canvasesQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (canvasesQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => canvasesQuery.refetch() }}
      />
    )
  }

  const canvases = canvasesQuery.data

  function scheduleDelete(id: string) {
    if (!deleteCanvasMutation.isPending) deleteCanvasMutation.mutate(id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          loading={createCanvas.isPending}
          onClick={() =>
            createCanvas.mutate(
              { title: t('personal.canvas.newTitle') },
              {
                onSuccess: (created) => setSelectedId(created.id),
                onError: () => toast(t('toast.saveError')),
              },
            )
          }
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('personal.canvas.create')}
        </Button>
      </div>

      {canvases.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="personal.canvas.empty.title"
          bodyKey="personal.canvas.empty.body"
          illustration={<EmptyPersonalIllustration />}
          action={{
            labelKey: 'personal.canvas.create',
            onAction: () =>
              createCanvas.mutate(
                { title: t('personal.canvas.newTitle') },
                { onSuccess: (c) => setSelectedId(c.id) },
              ),
          }}
        />
      ) : (
        <Stagger as="ul" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {canvases.map((canvas) => (
            <StaggerItem key={canvas.id} as="li">
              <Card padding="md" interactive className="flex h-full flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedId(canvas.id)}
                  className="flex h-24 items-center justify-center rounded-sm border border-dashed border-border text-small text-muted-foreground transition-colors duration-(--dur-micro) hover:bg-accent"
                >
                  {t('personal.canvas.open')}
                </button>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-body font-medium text-foreground">
                    {canvas.title}
                  </span>
                  <IconButton
                    aria-label={t('personal.canvas.delete')}
                    disabled={deleteCanvasMutation.isPending}
                    aria-busy={deleteCanvasMutation.isPending}
                    onClick={() => scheduleDelete(canvas.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <span className="text-caption text-muted-foreground">
                  {formatDateTime(new Date(canvas.updatedAt), locale)}
                </span>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}

function CanvasDetail({
  id,
  onBack,
  onDeleted,
}: {
  id: string
  onBack: () => void
  onDeleted: () => void
}) {
  const t = useT()
  const canvasQuery = useCanvasQuery(id)
  const patchCanvas = usePatchCanvasMutation(id)
  const deleteCanvasMutation = useDeleteCanvasMutation()
  const [title, setTitle] = React.useState('')
  // Title and drawing edits share one versioned queue; an older response cannot clear a newer title draft.
  const titleDraft = React.useRef('')
  const titleDirty = React.useRef(false)
  const titleVersion = React.useRef(0)
  const sceneVersion = React.useRef<number | null>(null)
  const [titleError, setTitleError] = React.useState(false)
  const queuedSave = useQueuedSave<Canvas, PatchCanvasInput>(
    canvasQuery.data ?? null,
    (input) => patchCanvas.mutateAsync(input),
    (updated, patch) => {
      if (patch.title !== undefined && titleDraft.current.trim() === patch.title)
        titleDirty.current = false
      if (patch.scene !== undefined || patch.stickies !== undefined)
        sceneVersion.current = updated.version
    },
  )

  // v1.1 EPIC-018. The canvas itself stays owner-only for ever; *sharing* publishes a revocable copy
  // into one project or event (`lib/realtime/canvas-api.ts` states the rule in full). So this screen
  // gains exactly two things: a button that explains that bargain before it is taken, and a panel
  // per live share showing what colleagues can see and who is on it right now.
  const [sharing, setSharing] = React.useState(false)
  const { shares } = useSharesOfCanvas(id)

  React.useEffect(() => {
    if (canvasQuery.data && !titleDirty.current) {
      titleVersion.current = canvasQuery.data.version
      if (sceneVersion.current === null) sceneVersion.current = canvasQuery.data.version
      titleDraft.current = canvasQuery.data.title
      setTitle(canvasQuery.data.title)
    }
    // Keyed on the one field each effect actually reacts to, not the whole (frequently-refetched) query object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasQuery.data?.title])

  function saveTitle(retry = false) {
    if (retry && canvasQuery.data) {
      titleVersion.current = canvasQuery.data.version
      sceneVersion.current = canvasQuery.data.version
    }
    if (!titleDirty.current) return retry ? queuedSave.retry({}) : Promise.resolve(true)
    if (!titleDraft.current.trim()) {
      setTitleError(true)
      return Promise.resolve(false)
    }
    const patch = { title: titleDraft.current.trim() }
    return retry ? queuedSave.retry(patch) : queuedSave.enqueue(patch, titleVersion.current)
  }

  if (canvasQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (canvasQuery.isError || !canvasQuery.data) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: onBack }}
      />
    )
  }

  const canvas = canvasQuery.data

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton aria-label={t('personal.canvas.back')} onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <Input
          aria-label={t('personal.canvas.title')}
          value={title}
          maxLength={300}
          aria-invalid={titleError || undefined}
          aria-describedby={titleError ? `canvas-title-error-${id}` : undefined}
          onChange={(e) => {
            if (!titleDirty.current) titleVersion.current = canvas.version
            titleDraft.current = e.target.value
            titleDirty.current = true
            setTitle(e.target.value)
            if (e.target.value.trim()) setTitleError(false)
          }}
          onBlur={() => void saveTitle()}
          className="h-auto min-h-9 min-w-24 max-w-80 flex-1 border-none bg-transparent px-1 text-h3 font-medium shadow-none focus-visible:ring-0"
        />
        <span
          aria-live="polite"
          className={cn('flex shrink-0 items-center gap-1 text-caption text-muted-foreground')}
        >
          {queuedSave.isPending && (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t('personal.canvas.autosave.saving')}
            </>
          )}
          {queuedSave.state === 'saved' && (
            <>
              <Check className="size-3.5 text-success" aria-hidden="true" />
              {t('personal.canvas.autosave.saved')}
            </>
          )}
        </span>
        <IconButton aria-label={t('realtime.canvas.share.action')} onClick={() => setSharing(true)}>
          <Share2 className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={t('personal.canvas.delete')}
          disabled={deleteCanvasMutation.isPending}
          aria-busy={deleteCanvasMutation.isPending}
          onClick={() => deleteCanvasMutation.mutate(canvas.id, { onSuccess: onDeleted })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

      {titleError ? (
        <p id={`canvas-title-error-${id}`} role="alert" className="text-small text-destructive">
          {t('personal.save.titleRequired')}
        </p>
      ) : null}
      {queuedSave.state === 'error' || queuedSave.state === 'conflict' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-small text-destructive">
            {t(queuedSave.state === 'conflict' ? 'personal.save.conflict' : 'personal.save.error')}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void saveTitle(true)}>
            {t('personal.save.retry')}
          </Button>
        </div>
      ) : null}

      {shares.map((share) => (
        <SharedCanvasPanel key={share.id} share={share} />
      ))}

      <CanvasShareDialog open={sharing} onOpenChange={setSharing} canvasId={canvas.id} />

      <CanvasEditor
        key={id}
        scene={canvas.scene}
        stickies={canvas.stickies}
        onChange={({ scene, stickies }) => {
          void queuedSave.enqueue({ scene, stickies }, sceneVersion.current ?? canvas.version)
        }}
      />
    </div>
  )
}
