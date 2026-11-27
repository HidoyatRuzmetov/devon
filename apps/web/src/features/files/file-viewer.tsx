import * as React from 'react'
import { useT } from '@devon/i18n'
import { Dialog, DialogContent, DialogDescription, DialogClose } from '@devon/ui'
import {
  Download,
  FolderDown,
  X,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { FilePreview, NoPreview, PreviewFailure, type PreviewFile } from './file-preview.js'
import { fileKind, formatFileSize, PreviewError, previewLimits } from './file-types.js'
import { AttachmentIcon } from './file-icon.js'
import './file-viewer.css'

export type ViewableAttachment = {
  id: string
  name: string
  size: number
  url: string
}
export async function fetchPreview(file: ViewableAttachment, signal: AbortSignal) {
  if (file.size > previewLimits.file) throw new PreviewError('size')
  const url = new URL(file.url, window.location.origin)
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/v1/'))
    throw new PreviewError('load')
  const response = await fetch(url, {
    credentials: 'same-origin',
    signal,
    redirect: 'error',
    cache: 'no-store',
  })
  if (!response.ok || !response.body) throw new PreviewError('load')
  const length = Number(response.headers.get('content-length'))
  if (length > previewLimits.file) {
    await response.body.cancel()
    throw new PreviewError('size')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      // nosemgrep: query-in-loop -- Check each downloaded chunk against the size limit before requesting the next stream chunk.
      const next = await reader.read()
      if (next.done) break
      total += next.value.length
      if (total > previewLimits.file) throw new PreviewError('size')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const data = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return { name: file.name, data, sourceUrl: file.url }
}
class PreviewBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
function LoadedFile({ file }: { file: ViewableAttachment }) {
  const t = useT()
  const [data, setData] = React.useState<PreviewFile>()
  const [error, setError] = React.useState<unknown>()
  const [attempt, setAttempt] = React.useState(0)
  const kind = fileKind(file.name)
  React.useEffect(() => {
    if (kind === 'risky' || kind === 'unknown') return
    const controller = new AbortController()
    setError(undefined)
    void fetchPreview(file, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason)
      })
    return () => controller.abort()
  }, [file, attempt, kind])
  if (kind === 'risky' || kind === 'unknown') return <NoPreview risky={kind === 'risky'} />
  if (error) return <PreviewFailure error={error} retry={() => setAttempt(attempt + 1)} />
  if (!data)
    return (
      <div className="file-viewer-message" role="status">
        <span className="file-spinner" />
        {t('files.loading')}
      </div>
    )
  return (
    <PreviewBoundary fallback={<PreviewFailure error={new PreviewError('format')} />}>
      <FilePreview file={data} />
    </PreviewBoundary>
  )
}
export default function FileViewer({
  files,
  initialId,
  onClose,
}: {
  files: ViewableAttachment[]
  initialId: string
  onClose(): void
}) {
  const t = useT()
  const [selected, setSelected] = React.useState(initialId)
  const [sidebar, setSidebar] = React.useState(() => files.length > 1 && window.innerWidth >= 1000)
  const [expanded, setExpanded] = React.useState(false)
  const file = files.find((item) => item.id === selected) ?? files[0]
  const [fileList, setFileList] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    const list = fileList
    if (!list) return
    const reveal = () =>
      list
        .querySelector('[aria-current="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(list)
    return () => observer.disconnect()
  }, [selected, sidebar, fileList])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        title={t('files.viewer')}
        titleHidden
        showClose={false}
        onEscapeKeyDown={(event) => {
          // Radix listens in capture phase, before the search input's React handler.
          if (event.target instanceof Element && event.target.closest('.file-findbar'))
            event.preventDefault()
        }}
        className={`file-viewer-dialog ${expanded ? 'file-viewer-expanded' : ''}`}
      >
        <DialogDescription className="sr-only">{t('files.description')}</DialogDescription>
        <header className="file-viewer-header">
          <div className="file-viewer-brand">
            {files.length > 1 ? (
              <button
                className="file-header-button"
                onClick={() => setSidebar(!sidebar)}
                aria-label={t(sidebar ? 'files.hideFiles' : 'files.showFiles')}
                aria-expanded={sidebar}
                title={t(sidebar ? 'files.hideFiles' : 'files.showFiles')}
              >
                {sidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
              </button>
            ) : null}
            <span className="file-viewer-brand-icon">
              <AttachmentIcon name={file?.name ?? ''} />
            </span>
            <div>
              <strong title={file?.name}>{file?.name ?? t('files.viewer')}</strong>
              <span>
                {file ? formatFileSize(file.size) + ' · ' : ''}
                {t('files.readOnly')}
              </span>
            </div>
          </div>
          <div className="file-viewer-header-actions">
            {file ? (
              <a
                href={file.url}
                download={file.name}
                className="file-download"
                aria-label={t(
                  fileKind(file.name) === 'archive'
                    ? 'files.downloadArchive'
                    : 'files.downloadFile',
                )}
                title={file.name}
              >
                {fileKind(file.name) === 'archive' ? <FolderDown /> : <Download />}
                <span>
                  {t(
                    fileKind(file.name) === 'archive'
                      ? 'files.downloadArchive'
                      : 'files.downloadFile',
                  )}
                </span>
              </a>
            ) : null}
            <button
              className="file-header-button file-expand"
              aria-label={t(expanded ? 'files.restoreSize' : 'files.expand')}
              title={t(expanded ? 'files.restoreSize' : 'files.expand')}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </button>
            <DialogClose
              className="file-close"
              aria-label={t('files.close')}
              title={t('files.close')}
            >
              <X />
            </DialogClose>
          </div>
        </header>
        <div className={`file-viewer-body ${sidebar ? '' : 'file-viewer-no-sidebar'}`}>
          {sidebar ? (
            <aside className="file-viewer-sidebar" aria-label={t('files.files')}>
              <div className="file-sidebar-heading">
                <span>{t('files.files')}</span>
                <span>{files.length}</span>
              </div>
              <nav ref={setFileList}>
                {files.map((item) => (
                  <button
                    key={item.id}
                    aria-current={item.id === file?.id ? 'true' : undefined}
                    onClick={() => {
                      setSelected(item.id)
                      if (window.innerWidth < 900) setSidebar(false)
                    }}
                  >
                    <AttachmentIcon name={item.name} />
                    <span>
                      <strong title={item.name}>{item.name}</strong>
                      <small>{formatFileSize(item.size)}</small>
                    </span>
                  </button>
                ))}
              </nav>
            </aside>
          ) : null}
          <div className="file-viewer-main">
            <div className="file-viewer-stage">
              {file ? (
                <LoadedFile key={file.id} file={file} />
              ) : (
                <p className="file-empty">{t('files.empty')}</p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
