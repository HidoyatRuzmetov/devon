import * as React from 'react'
import { useT } from '@devon/i18n'
import { ChevronLeft, ChevronRight, Minus, Plus, FileText } from 'lucide-react'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfPreview({ data }: { data: Uint8Array<ArrayBuffer> }) {
  const t = useT()
  const [pdf, setPdf] = React.useState<PDFDocumentProxy>()
  const [page, setPage] = React.useState(1)
  const [zoom, setZoom] = React.useState(1)
  const [width, setWidth] = React.useState(700)
  const [error, setError] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [passwordNeeded, setPasswordNeeded] = React.useState(false)
  const [text, setText] = React.useState('')
  const [showText, setShowText] = React.useState(false)
  const updatePassword = React.useRef<((password: string) => void) | null>(null)
  const surface = React.useRef<HTMLDivElement>(null)
  const canvas = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    let current = true
    const task = getDocument({
      data: data.slice(),
      useSystemFonts: true,
      useWasm: false,
      stopAtErrors: true,
    })
    const deadline = setTimeout(() => {
      if (current) setError(true)
      void task.destroy()
    }, 20_000)
    task.onPassword = (update: (password: string) => void) => {
      clearTimeout(deadline)
      if (current) {
        updatePassword.current = update
        setPasswordNeeded(true)
      }
    }
    void task.promise
      .then((result) => {
        clearTimeout(deadline)
        if (current) {
          setPdf(result)
          setPasswordNeeded(false)
        }
      })
      .catch(() => {
        clearTimeout(deadline)
        if (current) setError(true)
      })
    return () => {
      current = false
      clearTimeout(deadline)
      updatePassword.current = null
      void task.destroy()
    }
  }, [data])
  React.useEffect(() => {
    if (!surface.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(180, entry.contentRect.width - 48))
    })
    observer.observe(surface.current)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    if (!pdf || !canvas.current) return
    let current = true
    let render: RenderTask | undefined
    const deadline = setTimeout(() => {
      if (current) setError(true)
      render?.cancel()
    }, 20_000)
    void pdf
      .getPage(page)
      .then(async (sheet) => {
        if (!current || !canvas.current) return
        const size = sheet.getViewport({ scale: 1 })
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
        if (!Number.isFinite(size.width * size.height) || size.width <= 0 || size.height <= 0)
          throw new Error('Invalid PDF page size')
        // A hostile page can declare enormous dimensions inside a tiny PDF. Bound the
        // actual canvas allocation as well as the uploaded file size.
        const scale = Math.min(
          Math.min(2, width / size.width) * zoom,
          8192 / (size.width * pixelRatio),
          8192 / (size.height * pixelRatio),
          Math.sqrt(16_000_000 / (size.width * size.height)) / pixelRatio,
        )
        const viewport = sheet.getViewport({ scale })
        const target = canvas.current
        target.width = Math.ceil(viewport.width * pixelRatio)
        target.height = Math.ceil(viewport.height * pixelRatio)
        target.style.width = `${viewport.width}px`
        target.style.height = `${viewport.height}px`
        const context = target.getContext('2d')
        if (!context) throw new Error('canvas')
        render = sheet.render({
          canvas: target,
          canvasContext: context,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        })
        await render.promise
        const content = await sheet.getTextContent()
        if (current)
          setText(
            content.items
              .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
              .join(''),
          )
      })
      .catch((reason: unknown) => {
        if (current && !(reason instanceof Error && reason.name === 'RenderingCancelledException'))
          setError(true)
      })
      .finally(() => clearTimeout(deadline))
    return () => {
      current = false
      clearTimeout(deadline)
      render?.cancel()
    }
  }, [pdf, page, width, zoom])
  if (error)
    return (
      <div className="file-viewer-message" role="alert">
        {t('files.error.format')}
      </div>
    )
  return (
    <div className="file-pdf">
      <div className="file-preview-controls">
        <button
          aria-label={t('files.previousPage')}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={!pdf || page === 1}
        >
          <ChevronLeft />
        </button>
        <span>
          {page} / {pdf?.numPages ?? '—'}
        </span>
        <button
          aria-label={t('files.nextPage')}
          onClick={() => setPage((value) => Math.min(pdf?.numPages ?? 1, value + 1))}
          disabled={!pdf || page === pdf.numPages}
        >
          <ChevronRight />
        </button>
        <span className="file-control-divider" />
        <button
          aria-label={t('files.zoomOut')}
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          disabled={zoom <= 0.5}
        >
          <Minus />
        </button>
        <button onClick={() => setZoom(1)}>
          {zoom === 1 ? t('files.fit') : `${Math.round(zoom * 100)}%`}
        </button>
        <button
          aria-label={t('files.zoomIn')}
          onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
          disabled={zoom >= 2}
        >
          <Plus />
        </button>
        <button aria-pressed={showText} onClick={() => setShowText(!showText)}>
          <FileText />
          {t('files.text')}
        </button>
      </div>
      {passwordNeeded ? (
        <form
          className="file-viewer-message"
          onSubmit={(event) => {
            event.preventDefault()
            updatePassword.current?.(password)
            setPassword('')
            setPasswordNeeded(false)
          }}
        >
          <label>
            {t('files.password')}
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit">{t('files.open')}</button>
        </form>
      ) : null}
      <div className="file-pdf-surface" ref={surface}>
        {!pdf && !passwordNeeded ? <p role="status">{t('files.loading')}</p> : null}
        {showText ? <pre className="file-page-text">{text || t('files.noText')}</pre> : null}
        <canvas ref={canvas} hidden={showText} aria-label={t('files.pdfPage', { page })} />
      </div>
    </div>
  )
}
