// Canvas list + the active editor (TECH-SPEC §3.3). No route param for "which canvas is open" --
// `src/lib/router.tsx`'s five core routes (and this feature's one route) are exact-path only, so the
// selection lives in this component's own state instead, same tradeoff MODULE-GUIDE.md documents for
// every feature today.
import * as React from 'react'
import { useT, useLocale, formatDateTime } from '@devon/i18n'
import { ArrowLeft, Check, Loader2, Plus, Trash2 } from 'lucide-react'
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
  toastWithUndo,
} from '@devon/ui'
import { CanvasEditor } from './canvas-editor.js'
import {
  useCanvasQuery,
  useCanvasesQuery,
  useCreateCanvasMutation,
  useDelayedDelete,
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
  const { schedule, cancel } = useDelayedDelete((id) => deleteCanvasMutation.mutateAsync(id))
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set())

  if (selectedId) {
    return (
      <CanvasDetail
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

  const canvases = canvasesQuery.data.filter((c) => !hiddenIds.has(c.id))

  function scheduleDelete(id: string) {
    setHiddenIds((prev) => new Set(prev).add(id))
    schedule(id)
    toastWithUndo({
      message: t('personal.canvas.deleted.toast'),
      undoLabel: t('action.undo'),
      onUndo: () => {
        cancel(id)
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      },
    })
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
  // Tracks the latest known `version` outside the render closure so a rapid sequence of autosaves
  // (each already debounced 800ms inside `CanvasEditor`) sends the version the *previous* save
  // actually produced, not a stale one captured when this component last rendered -- avoiding a
  // spurious 409 from the API's optimistic-concurrency check on fast successive edits. Declared
  // (and its effects run) unconditionally, above every early return, per the rules of hooks.
  const versionRef = React.useRef(0)

  React.useEffect(() => {
    if (canvasQuery.data) setTitle(canvasQuery.data.title)
    // Keyed on the one field each effect actually reacts to, not the whole (frequently-refetched) query object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasQuery.data?.title])

  React.useEffect(() => {
    if (canvasQuery.data) versionRef.current = canvasQuery.data.version
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasQuery.data?.version])

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
      <div className="flex items-center gap-2">
        <IconButton aria-label={t('personal.canvas.back')} onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== canvas.title) {
              patchCanvas.mutate({ title: title.trim(), version: canvas.version })
            }
          }}
          className="h-9 max-w-80 flex-1 border-none bg-transparent px-1 text-h3 font-medium shadow-none focus-visible:ring-0"
        />
        <span
          aria-live="polite"
          className={cn(
            'hidden shrink-0 items-center gap-1 text-caption text-muted-foreground sm:flex',
          )}
        >
          {patchCanvas.isPending && (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t('personal.canvas.autosave.saving')}
            </>
          )}
          {!patchCanvas.isPending && patchCanvas.isSuccess && (
            <>
              <Check className="size-3.5 text-success" aria-hidden="true" />
              {t('personal.canvas.autosave.saved')}
            </>
          )}
        </span>
        <IconButton
          aria-label={t('personal.canvas.delete')}
          onClick={() => deleteCanvasMutation.mutate(canvas.id, { onSuccess: onDeleted })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <CanvasEditor
        scene={canvas.scene}
        stickies={canvas.stickies}
        onChange={({ scene, stickies }) =>
          patchCanvas.mutate(
            { scene, stickies, version: versionRef.current },
            { onSuccess: (updated) => (versionRef.current = updated.version) },
          )
        }
      />
    </div>
  )
}
