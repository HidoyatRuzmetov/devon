import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Field, Input } from '@devon/ui'
import { ApiError, apiClient } from '../../../lib/api-client.js'
import { finalizeEventThumbnailUpload, requestEventThumbnailUpload } from '../api.js'
import { useCsrfToken } from '../hooks.js'

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export function EventThumbnailPicker({
  thumbnailUrl,
  onChange,
  onBusyChange,
}: {
  thumbnailUrl: string | null
  onChange: (thumbnail: { uploadId: string; thumbnailUrl: string } | null) => void
  onBusyChange: (busy: boolean) => void
}) {
  const t = useT()
  const csrf = useCsrfToken()
  const [stage, setStage] = React.useState<'uploading' | 'scanning' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [retryUploadId, setRetryUploadId] = React.useState<string | null>(null)
  const controller = React.useRef<AbortController | null>(null)
  const active = React.useRef(false)
  React.useEffect(() => () => controller.current?.abort(), [])

  async function upload(file?: File) {
    if (active.current) return
    if (file && (!IMAGE_TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES)) {
      setError('events.form.thumbnailInvalid')
      return
    }
    active.current = true
    onBusyChange(true)
    setError(null)
    const current = new AbortController()
    controller.current = current
    let uploadId = file ? null : retryUploadId
    try {
      if (file) {
        setRetryUploadId(null)
        setStage('uploading')
        const signed = await requestEventThumbnailUpload(file, csrf)
        current.signal.throwIfAborted()
        await apiClient.uploadFile(signed.url, {
          method: signed.method,
          headers: signed.headers,
          body: file,
          signal: current.signal,
        })
        current.signal.throwIfAborted()
        uploadId = signed.uploadId
      }
      if (!uploadId) return
      setStage('scanning')
      const saved = await finalizeEventThumbnailUpload(uploadId, csrf)
      current.signal.throwIfAborted()
      onChange(saved)
      setRetryUploadId(null)
    } catch (failure) {
      if (!current.signal.aborted) {
        const scanUnavailable =
          failure instanceof ApiError && failure.status === 503 && uploadId !== null
        setRetryUploadId(scanUnavailable ? uploadId : null)
        setError(
          scanUnavailable ? 'events.form.thumbnailScanUnavailable' : 'events.form.thumbnailFailed',
        )
      }
    } finally {
      active.current = false
      controller.current = null
      setStage(null)
      onBusyChange(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={t('events.form.thumbnailLabel')} htmlFor="event-thumbnail">
        <Input
          id="event-thumbnail"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={stage !== null}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </Field>
      <p className="text-caption text-muted-foreground">{t('events.form.thumbnailHint')}</p>
      {thumbnailUrl ? (
        <div className="flex flex-col gap-2">
          <img
            src={thumbnailUrl}
            alt={t('events.form.thumbnailPreview')}
            className="aspect-video w-full rounded-md border border-border object-cover"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={stage !== null}
            onClick={() => {
              onChange(null)
              setRetryUploadId(null)
              setError(null)
            }}
          >
            {t('events.form.thumbnailRemove')}
          </Button>
        </div>
      ) : null}
      {stage ? (
        <p role="status" className="text-small text-muted-foreground">
          {t(
            stage === 'uploading'
              ? 'events.form.thumbnailUploading'
              : 'events.form.thumbnailScanning',
          )}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {t(error)}
        </p>
      ) : null}
      {retryUploadId ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={stage !== null}
          onClick={() => void upload()}
        >
          {t('events.actions.retry')}
        </Button>
      ) : null}
    </div>
  )
}
