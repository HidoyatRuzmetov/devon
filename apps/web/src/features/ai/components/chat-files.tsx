import * as React from 'react'
import type { AiChatAttachment } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Button, IconButton } from '@devon/ui'
import { Check, File, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { ApiError, NetworkError } from '../../../lib/api-client.js'
import { useConversationUploadMutation, type ChatUploadTransfer } from '../conversations.js'

type QueuedFile = {
  localId: string
  conversationId: string
  file: File
  status: 'queued' | 'uploading' | 'scanning' | 'approval' | 'failed' | 'ready'
  attachment?: AiChatAttachment | undefined
  transfer?: ChatUploadTransfer | undefined
  finalizeId?: string | undefined
  error?: string | undefined
  retryable?: boolean | undefined
}

export function useChatFiles(
  conversationId: string | null,
  ensureConversation: () => Promise<string | null>,
) {
  const upload = useConversationUploadMutation()
  const [queue, setQueue] = React.useState<QueuedFile[]>([])
  const [limitError, setLimitError] = React.useState(false)
  const controllers = React.useRef(new Map<string, AbortController>())
  const removed = React.useRef(new Set<string>())
  const disposed = React.useRef(false)
  const queueRef = React.useRef(queue)
  queueRef.current = queue
  React.useEffect(() => {
    disposed.current = false
    const active = controllers.current
    return () => {
      disposed.current = true
      for (const controller of active.values()) controller.abort()
    }
  }, [])
  const update = (id: string, patch: Partial<QueuedFile>) =>
    setQueue((items) => items.map((item) => (item.localId === id ? { ...item, ...patch } : item)))
  async function run(item: QueuedFile) {
    if (controllers.current.has(item.localId) || removed.current.has(item.localId)) return
    const controller = new AbortController()
    controllers.current.set(item.localId, controller)
    update(item.localId, { status: item.finalizeId ? 'scanning' : 'uploading', error: undefined })
    let finalizeId = item.finalizeId
    try {
      const attachment = await upload.mutateAsync({
        conversationId: item.conversationId,
        file: item.file,
        signal: controller.signal,
        ...(item.transfer ? { transfer: item.transfer } : {}),
        ...(item.finalizeId ? { finalizeId: item.finalizeId } : {}),
        onTransfer: (transfer) => update(item.localId, { transfer }),
        onScanning: (id) => {
          finalizeId = id
          update(item.localId, { status: 'scanning', finalizeId: id, transfer: undefined })
        },
      })
      if (controller.signal.aborted) return
      if (attachment === 'approval') update(item.localId, { status: 'approval', retryable: true })
      else
        update(item.localId, {
          status: 'ready',
          attachment,
          transfer: undefined,
          finalizeId: undefined,
        })
    } catch (error) {
      if (controller.signal.aborted) return
      const transient =
        error instanceof NetworkError || (error instanceof ApiError && error.status === 503)
      const key =
        error instanceof ApiError && error.status === 413
          ? 'attachments.tooLarge'
          : error instanceof ApiError && error.errors.some((detail) => detail.code === 'infected')
            ? 'attachments.infected'
            : transient && finalizeId
              ? 'attachments.scanUnavailable'
              : transient
                ? 'attachments.uploadUnavailable'
                : 'attachments.error'
      update(item.localId, {
        status: 'failed',
        error: key,
        retryable: transient,
        ...(!transient ? { transfer: undefined, finalizeId: undefined } : {}),
      })
    } finally {
      controllers.current.delete(item.localId)
    }
  }
  async function add(files: File[]) {
    const id = await ensureConversation()
    if (!id) return
    const available = Math.max(
      0,
      10 - queueRef.current.filter((item) => item.conversationId === id).length,
    )
    setLimitError(files.length > available)
    const entries = files.slice(0, available).map(
      (file): QueuedFile => ({
        localId: crypto.randomUUID(),
        conversationId: id,
        file,
        status: 'queued',
      }),
    )
    setQueue((items) => [...items, ...entries])
    for (const entry of entries) {
      // Removing a queued file while another transfer runs must not upload it later.
      if (disposed.current) break
      if (removed.current.has(entry.localId)) continue
      // Finalization buffers two copies. One approved 1 GiB file can consume the server's entire
      // 2 GiB transfer budget, so the next transfer waits for the previous scan to release it.
      // eslint-disable-next-line no-restricted-syntax
      await run(entry) // nosemgrep: query-in-loop -- serial upload/scan queue respects shared buffer capacity.
    }
  }
  function remove(id: string) {
    removed.current.add(id)
    controllers.current.get(id)?.abort()
    setQueue((items) => items.filter((item) => item.localId !== id))
    setLimitError(false)
  }
  function consumed(ids: string[]) {
    setQueue((items) =>
      items.filter((item) => !item.attachment || !ids.includes(item.attachment.id)),
    )
  }
  const files = queue.filter((item) => item.conversationId === conversationId)
  return {
    files,
    add,
    remove,
    consumed,
    retry: (id: string) => {
      const item = queueRef.current.find((entry) => entry.localId === id)
      if (item) void run(item)
    },
    ready: files.flatMap((item) => (item.attachment ? [item.attachment] : [])),
    blocked: files.some((item) => item.status !== 'ready'),
    uploading: queue.some((item) => ['queued', 'uploading', 'scanning'].includes(item.status)),
    limitError,
  }
}

export function ChatFileQueue({
  files,
  remove,
  retry,
  limitError,
}: {
  files: QueuedFile[]
  remove: (id: string) => void
  retry: (id: string) => void
  limitError: boolean
}) {
  const t = useT()
  if (!files.length && !limitError) return null
  return (
    <div
      className="mb-2 max-h-36 space-y-1.5 overflow-y-auto overscroll-contain"
      aria-label={t('assistantActions.queuedFiles')}
    >
      {files.map((item) => (
        <div
          key={item.localId}
          className="rounded-md border border-border bg-background px-2 py-1.5"
        >
          <div className="flex items-center gap-2">
            <File className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span
              className="min-w-0 flex-1 truncate text-caption font-medium"
              title={item.file.name}
            >
              {item.file.name}
            </span>
            <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
              {Math.max(1, Math.round(item.file.size / 1024))} KB
            </span>
            {item.status === 'ready' ? (
              <Check
                className="size-3.5 text-success"
                aria-label={t('assistantActions.fileReady')}
              />
            ) : ['queued', 'uploading', 'scanning'].includes(item.status) ? (
              <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
            ) : null}
            <IconButton
              aria-label={t('attachments.removeName', { name: item.file.name })}
              tooltip={t('attachments.removeName', { name: item.file.name })}
              className="size-7 min-h-7 min-w-7"
              onClick={() => remove(item.localId)}
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
          {item.status !== 'ready' ? (
            <div className="mt-0.5 flex items-center justify-between gap-2" role="status">
              <span
                className={
                  item.status === 'failed'
                    ? 'text-caption text-destructive'
                    : 'text-caption text-muted-foreground'
                }
              >
                {t(
                  item.error ??
                    (item.status === 'approval'
                      ? 'assistantActions.fileApproval'
                      : item.status === 'scanning'
                        ? 'attachments.scanning'
                        : 'attachments.uploading'),
                )}
              </span>
              {item.retryable ? (
                <Button size="sm" variant="ghost" onClick={() => retry(item.localId)}>
                  <RotateCcw className="mr-1 size-3" aria-hidden="true" />
                  {t('overviewChat.retry')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {limitError ? (
        <p role="alert" className="text-caption text-destructive">
          {t('assistantActions.fileLimit')}
        </p>
      ) : null}
    </div>
  )
}
