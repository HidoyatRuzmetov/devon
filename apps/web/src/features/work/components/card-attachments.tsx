import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useT } from '@devon/i18n'
import { Button, Input, toast, toastWithUndo } from '@devon/ui'
import { ApiError, apiClient } from '../../../lib/api-client.js'
import { useMeQuery } from '../../../lib/session.js'

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  createdAt: z.string(),
})
const uploadSchema = z.object({
  uploadId: z.string(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
})

export function CardAttachments({
  cardId,
  canEdit,
  subjectType = 'card',
}: {
  cardId: string
  canEdit: boolean
  subjectType?: 'card' | 'page'
}) {
  const t = useT()
  const csrf = useMeQuery().data?.csrfToken ?? ''
  const qc = useQueryClient()
  const base = `/api/v1/${subjectType === 'card' ? 'cards' : 'pages'}/${encodeURIComponent(cardId)}/attachments`
  const key = [subjectType === 'card' ? 'work' : 'pages', 'attachments', cardId]
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiClient.get(base, z.array(attachmentSchema)),
  })
  const approvals = useQuery({
    queryKey: [...key, 'approvals'],
    queryFn: () =>
      apiClient.get(
        `${base}/approvals`,
        z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
      ),
    enabled: canEdit,
  })
  const [stage, setStage] = React.useState<'uploading' | 'scanning' | null>(null)
  const [approvalRequested, setApprovalRequested] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [pendingUpload, setPendingUpload] = React.useState<{
    file: File
    signed: z.infer<typeof uploadSchema>
  } | null>(null)
  const activeUpload = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => activeUpload.current?.abort(), [])
  const finalize = async (id: string) => {
    setStage('scanning')
    return apiClient.post(`${base}/${encodeURIComponent(id)}/finalize`, {}, attachmentSchema, csrf)
  }
  const upload = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file && pendingId) return finalize(pendingId)
      if (!file && !pendingUpload) return
      if (file) {
        setPendingId(null)
        setPendingUpload(null)
      }
      setApprovalRequested(false)
      setStage('uploading')
      const controller = new AbortController()
      activeUpload.current = controller
      let transfer = pendingUpload
      if (file) {
        const signed = await apiClient.post(
          `${base}/upload-url`,
          { name: file.name, size: file.size },
          z.union([uploadSchema, z.object({ approvalRequired: z.literal(true) })]),
          csrf,
        )
        if ('approvalRequired' in signed) {
          setApprovalRequested(true)
          return 'approval'
        }
        transfer = { file, signed }
        // Retain the approved transfer before PUT: capacity refusals must retry the same
        // signed URL instead of spending another approval on a fresh upload request.
        setPendingUpload(transfer)
      }
      if (!transfer) return
      const { signed } = transfer
      controller.signal.throwIfAborted()
      await apiClient.uploadFile(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: transfer.file,
        signal: controller.signal,
      })
      controller.signal.throwIfAborted()
      setPendingUpload(null)
      setPendingId(signed.uploadId)
      return finalize(signed.uploadId)
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: [...key, 'approvals'] })
      if (result === 'approval') return
      setPendingId(null)
      setPendingUpload(null)
      void qc.invalidateQueries({ queryKey: key })
      toast(t('attachments.saved'))
    },
    onError: (error) => {
      if (!(error instanceof ApiError && error.status === 503)) setPendingUpload(null)
    },
    onSettled: () => {
      activeUpload.current = null
      setStage(null)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`${base}/${encodeURIComponent(id)}`, csrf),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: key })
      toastWithUndo({
        message: t('attachments.removed'),
        durationMs: 20_000,
        undoLabel: t('action.undo'),
        onUndo: () => {
          void apiClient
            .post(`${base}/${encodeURIComponent(id)}/undo-delete`, {}, z.unknown(), csrf)
            .then(() => qc.invalidateQueries({ queryKey: key }))
            .catch(() => toast(t('attachments.error')))
        },
      })
    },
  })
  const error = upload.error instanceof ApiError ? upload.error : null
  const cancelled = upload.error instanceof Error && upload.error.name === 'AbortError'
  const retryScan = error?.status === 503 && pendingId
  const retryUpload = error?.status === 503 && pendingUpload
  return (
    <section className="flex flex-col gap-3" aria-label={t('attachments.title')}>
      <h3 className="text-small font-semibold">{t('attachments.title')}</h3>
      {list.isPending ? (
        <p className="text-small text-muted-foreground">{t('state.loading')}</p>
      ) : null}
      {list.isError ? (
        <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
          {t('state.error.action')}
        </Button>
      ) : null}
      {list.data?.length === 0 ? (
        <p className="text-small text-muted-foreground">{t('attachments.empty')}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {list.data?.map((file) => (
          <li key={file.id} className="flex items-center gap-2 rounded-sm border border-border p-2">
            <a
              className="min-w-0 flex-1 truncate text-small text-primary underline"
              href={`${base}/${encodeURIComponent(file.id)}/download`}
              download={file.name}
            >
              {file.name}
            </a>
            <span className="text-caption text-muted-foreground">
              {Math.max(1, Math.round(file.size / 1024))} KB
            </span>
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('attachments.removeName', { name: file.name })}
                disabled={remove.isPending}
                onClick={() => remove.mutate(file.id)}
              >
                {t('work.action.delete')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div aria-live="polite" className="space-y-2">
        {approvals.data?.map((request) => (
          <p key={request.id} className="break-words rounded-sm bg-muted/40 p-2 text-small">
            <strong>{request.name}</strong> · {t(`portal.files.${request.status}`)}
          </p>
        ))}
      </div>
      {canEdit ? (
        <label className="flex flex-col gap-2 text-small">
          {t('attachments.add')}
          <Input
            type="file"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) upload.mutate(file)
              e.target.value = ''
            }}
          />
          <span className="text-caption text-muted-foreground">{t('portal.files.hint')}</span>
        </label>
      ) : null}
      {approvalRequested ? (
        <p role="status" className="text-small text-info">
          {t('portal.files.requested')}
        </p>
      ) : null}
      {stage ? (
        <p role="status" className="text-small text-muted-foreground">
          {t(`attachments.${stage}`)}
        </p>
      ) : null}
      {stage === 'uploading' ? (
        <Button size="sm" variant="secondary" onClick={() => activeUpload.current?.abort()}>
          {t('attachments.cancel')}
        </Button>
      ) : null}
      {cancelled ? (
        <p role="status" className="text-small text-muted-foreground">
          {t('attachments.cancelled')}
        </p>
      ) : null}
      {(upload.isError && !cancelled) || remove.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t(
            retryScan
              ? 'attachments.scanUnavailable'
              : retryUpload
                ? 'attachments.uploadUnavailable'
                : error?.status === 413
                  ? 'attachments.tooLarge'
                  : error?.errors.some((item) => item.code === 'infected')
                    ? 'attachments.infected'
                    : 'attachments.error',
          )}
        </p>
      ) : null}
      {retryScan || retryUpload ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => upload.mutate(null)}
          disabled={upload.isPending}
        >
          {t('state.error.action')}
        </Button>
      ) : null}
    </section>
  )
}
