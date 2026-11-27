import * as React from 'react'
import { useT } from '@devon/i18n'
import { RotateCw } from 'lucide-react'
import { decodeText } from './document-formats.js'
import { PreviewError } from './file-types.js'

export function previewEndpoint(sourceUrl: string | undefined, kind: 'html' | 'office') {
  if (!sourceUrl) throw new PreviewError('load')
  const url = new URL(sourceUrl, window.location.origin)
  if (
    url.origin !== window.location.origin ||
    !/^\/api\/v1\/pages\/[a-f\d-]+\/attachments\/[a-f\d-]+\/download$/.test(url.pathname)
  )
    throw new PreviewError('load')
  return url.pathname.replace(/\/download$/, `/preview/${kind}`)
}

export default function InteractiveHtml({
  data,
  name,
  sourceUrl,
}: {
  data: Uint8Array<ArrayBuffer>
  name: string
  sourceUrl?: string
}) {
  const t = useT()
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [attempt, setAttempt] = React.useState(0)
  const [ready, setReady] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const prepared = React.useMemo(() => {
    try {
      return {
        html: decodeText(data),
        url: previewEndpoint(sourceUrl, 'html'),
      }
    } catch {
      return null
    }
  }, [data, sourceUrl])
  React.useEffect(() => {
    if (!prepared) return
    setReady(false)
    setFailed(false)
    const timer = setTimeout(() => setFailed(true), 15_000)
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        event.data?.type !== 'workportal:file-html-ready' ||
        event.ports.length !== 1
      )
        return
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      // The authenticated opaque frame supplies a dedicated, one-use channel.
      // Uploaded content is never sent through a wildcard window message.
      const port = event.ports[0]!
      port.postMessage({ type: 'workportal:file-html', html: prepared.html })
      port.close()
      setReady(true)
    }
    window.addEventListener('message', receive)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
    }
  }, [prepared, attempt])
  return (
    <div className="file-html">
      <div className="file-preview-controls">
        <span title={t('files.htmlIsolation')}>{t('files.interactiveHtml')}</span>
        <button className="file-entry-download" onClick={() => setAttempt(attempt + 1)}>
          <RotateCw />
          {t('files.restartHtml')}
        </button>
      </div>
      {!prepared || failed ? (
        <div className="file-viewer-message" role="alert">
          {t('files.error.load')}
        </div>
      ) : (
        <>
          {!ready ? (
            <div className="file-document-loading" role="status">
              <span className="file-spinner" />
              {t('files.loading')}
            </div>
          ) : null}
          <iframe
            key={attempt}
            ref={frame}
            className="file-document-frame"
            title={name}
            src={prepared.url}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        </>
      )}
    </div>
  )
}
