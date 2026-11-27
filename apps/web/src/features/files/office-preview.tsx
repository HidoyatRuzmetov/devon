import * as React from 'react'
import { useT } from '@devon/i18n'
import { apiClient } from '../../lib/api-client.js'
import { previewEndpoint } from './interactive-html.js'
import PdfPreview from './pdf-preview.js'
import { PreviewError, previewLimits } from './file-types.js'

function encode(data: Uint8Array) {
  const parts: string[] = []
  for (let index = 0; index < data.length; index += 32768)
    parts.push(String.fromCharCode(...data.subarray(index, index + 32768)))
  return btoa(parts.join(''))
}

export default function OfficePreview({
  data,
  name,
  sourceUrl,
}: {
  data: Uint8Array<ArrayBuffer>
  name: string
  sourceUrl?: string
}) {
  const t = useT()
  const [pdf, setPdf] = React.useState<Uint8Array<ArrayBuffer>>()
  const [error, setError] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    let active = true
    setPdf(undefined)
    setError(false)
    const timeout = setTimeout(() => {
      if (active) setError(true)
      controller.abort()
    }, 60_000)
    void (async () => {
      if (data.length > previewLimits.file) throw new PreviewError('size')
      const result = await apiClient.postBlob(
        previewEndpoint(sourceUrl, 'office'),
        { name, data: encode(data) },
        controller.signal,
      )
      if (result.size > previewLimits.file) throw new PreviewError('size')
      const bytes = new Uint8Array(await result.arrayBuffer())
      if (!controller.signal.aborted) setPdf(bytes)
    })()
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [data, name, sourceUrl, attempt])
  if (pdf) return <PdfPreview data={pdf} />
  return (
    <div className="file-viewer-message" role={error ? 'alert' : 'status'}>
      {error ? (
        <>
          <h3>{t('files.previewUnavailable')}</h3>
          <p>{t('files.officeFailure')}</p>
          <button onClick={() => setAttempt(attempt + 1)}>{t('files.retry')}</button>
        </>
      ) : (
        <>
          <span className="file-spinner" />
          <p>{t('files.preparingPages')}</p>
        </>
      )}
    </div>
  )
}
