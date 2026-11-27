/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The document region needs native keyboard scrolling. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- Ctrl/Cmd+F bubbles from the native controls and focusable document region to open document search. */
import * as React from 'react'
import { useT } from '@devon/i18n'
import { ChevronUp, ChevronDown, Minus, Plus, Search, RotateCw, X } from 'lucide-react'
import { AnnotationMode, getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

GlobalWorkerOptions.workerSrc = workerUrl

/** Continuous pages, selection and search use Mozilla's viewer. No scripting manager or editing. */
export default function PdfPreview({ data }: { data: Uint8Array<ArrayBuffer> }) {
  const t = useT()
  const surface = React.useRef<HTMLDivElement>(null)
  const pages = React.useRef<HTMLDivElement>(null)
  const viewer = React.useRef<PDFViewer | null>(null)
  const bus = React.useRef<EventBus | null>(null)
  const passwordReply = React.useRef<((value: string) => void) | null>(null)
  const findInput = React.useRef<HTMLInputElement>(null)
  const [ready, setReady] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageInput, setPageInput] = React.useState('1')
  const [count, setCount] = React.useState(0)
  const [zoom, setZoom] = React.useState(100)
  const [scaleMode, setScaleMode] = React.useState('page-width')
  const [password, setPassword] = React.useState('')
  const [passwordNeeded, setPasswordNeeded] = React.useState(false)
  const [passwordWrong, setPasswordWrong] = React.useState(false)
  const [findOpen, setFindOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [matches, setMatches] = React.useState({ current: 0, total: 0 })
  React.useEffect(() => {
    if (!surface.current || !pages.current) return
    let active = true
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: 2,
      externalLinkRel: 'noopener noreferrer',
    })
    const findController = new PDFFindController({ eventBus, linkService })
    const pdfViewer = new PDFViewer({
      container: surface.current,
      viewer: pages.current,
      eventBus,
      linkService,
      findController,
      annotationMode: AnnotationMode.ENABLE,
      maxCanvasPixels: 12_000_000,
      maxCanvasDim: 8192,
      enableDetailCanvas: false,
      enableAutoLinking: false,
    })
    linkService.setViewer(pdfViewer)
    viewer.current = pdfViewer
    bus.current = eventBus
    setReady(false)
    setError(false)
    const task = getDocument({
      data: data.slice(),
      useSystemFonts: true,
      useWasm: false,
      stopAtErrors: true,
    })
    let deadline: ReturnType<typeof setTimeout>
    const armDeadline = () => {
      clearTimeout(deadline)
      deadline = setTimeout(() => {
        if (active) setError(true)
        void task.destroy()
      }, 30_000)
    }
    armDeadline()
    task.onPassword = (update: (password: string) => void, reason: number) => {
      clearTimeout(deadline)
      if (!active) return
      setPasswordNeeded(true)
      setPasswordWrong(reason === 2)
      passwordReply.current = (value) => {
        armDeadline()
        update(value)
      }
    }
    eventBus.on('pagesinit', () => {
      if (!active) return
      pdfViewer.currentScaleValue = 'page-width'
      setReady(true)
    })
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      if (active) {
        setPage(pageNumber)
        setPageInput(String(pageNumber))
      }
    })
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => {
      if (active) setZoom(Math.round(scale * 100))
    })
    eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: typeof matches }) => {
      if (active) setMatches(matchesCount)
    })
    eventBus.on('updatefindcontrolstate', ({ matchesCount }: { matchesCount: typeof matches }) => {
      if (active) setMatches(matchesCount)
    })
    eventBus.on('pagerendered', ({ error: renderError }: { error?: unknown }) => {
      if (active && renderError) setError(true)
    })
    void task.promise
      .then((pdf) => {
        clearTimeout(deadline)
        if (!active) return
        if (pdf.numPages > 2000) {
          setError(true)
          void task.destroy()
          return
        }
        setCount(pdf.numPages)
        setPasswordNeeded(false)
        linkService.setDocument(pdf)
        pdfViewer.setDocument(pdf)
      })
      .catch(() => {
        clearTimeout(deadline)
        if (active) setError(true)
      })
    const observer = new ResizeObserver(() => {
      const currentScaleMode = pdfViewer.currentScaleValue
      if (
        pdfViewer.pdfDocument &&
        ['page-width', 'page-fit', 'auto'].includes(pdfViewer.currentScaleValue)
      )
        pdfViewer.currentScaleValue = currentScaleMode
      pdfViewer.update()
    })
    observer.observe(surface.current)
    return () => {
      active = false
      clearTimeout(deadline)
      observer.disconnect()
      passwordReply.current = null
      viewer.current = null
      bus.current = null
      pdfViewer.setDocument(null)
      linkService.setDocument(null)
      void task.destroy()
    }
  }, [data])
  const find = (value: string, again = false, previous = false) => {
    bus.current?.dispatch('find', {
      source: surface.current,
      type: again ? 'again' : '',
      query: value,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    })
  }
  const changePage = (value: number) => {
    if (!viewer.current || !ready) return
    viewer.current.currentPageNumber = Math.min(count, Math.max(1, value || 1))
    setPageInput(String(viewer.current.currentPageNumber))
  }
  const scale = (value: string) => {
    if (!viewer.current || !ready) return
    setScaleMode(value)
    viewer.current.currentScaleValue = value
  }
  const zoomBy = (direction: number) => {
    if (!viewer.current || !ready) return
    scale(String(Math.min(4, Math.max(0.25, viewer.current.currentScale + direction * 0.15))))
  }
  return (
    <div
      className="file-pdf"
      role="group"
      aria-label={t('files.documentPages')}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          setFindOpen(true)
          requestAnimationFrame(() => findInput.current?.focus())
        }
      }}
    >
      <div
        className="file-preview-controls file-document-toolbar"
        role="toolbar"
        aria-label={t('files.documentControls')}
      >
        <button
          aria-label={t('files.previousPage')}
          title={t('files.previousPage')}
          disabled={!ready || page <= 1}
          onClick={() => changePage(page - 1)}
        >
          <ChevronUp />
        </button>
        <input
          className="file-page-input"
          aria-label={t('files.pageNumber')}
          inputMode="numeric"
          value={pageInput}
          disabled={!ready}
          onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ''))}
          onBlur={() => changePage(Number(pageInput))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              changePage(Number(pageInput))
              event.currentTarget.blur()
            }
          }}
        />
        <span className="file-page-count">/ {count || '—'}</span>
        <button
          aria-label={t('files.nextPage')}
          title={t('files.nextPage')}
          disabled={!ready || page >= count}
          onClick={() => changePage(page + 1)}
        >
          <ChevronDown />
        </button>
        <span className="file-control-divider" />
        <button
          aria-label={t('files.zoomOut')}
          className="file-zoom-step"
          title={t('files.zoomOut')}
          disabled={!ready || zoom <= 25}
          onClick={() => zoomBy(-1)}
        >
          <Minus />
        </button>
        <select
          aria-label={t('files.zoom')}
          value={['page-width', 'page-fit'].includes(scaleMode) ? scaleMode : String(zoom / 100)}
          disabled={!ready}
          onChange={(event) => scale(event.target.value)}
        >
          <option value="page-width">{t('files.fitWidth')}</option>
          <option value="page-fit">{t('files.fitPage')}</option>
          {[...new Set([50, 75, 100, 125, 150, 200, 300, 400, zoom])]
            .sort((a, b) => a - b)
            .map((value) => (
              <option key={value} value={String(value / 100)}>
                {value}%
              </option>
            ))}
        </select>
        <button
          aria-label={t('files.zoomIn')}
          className="file-zoom-step"
          title={t('files.zoomIn')}
          disabled={!ready || zoom >= 400}
          onClick={() => zoomBy(1)}
        >
          <Plus />
        </button>
        <span className="file-control-divider" />
        <button
          aria-label={t('files.rotate')}
          title={t('files.rotate')}
          disabled={!ready}
          onClick={() => {
            if (viewer.current)
              viewer.current.pagesRotation = (viewer.current.pagesRotation + 90) % 360
          }}
        >
          <RotateCw />
        </button>
        <button
          aria-label={t('files.findDocument')}
          title={t('files.findDocument')}
          aria-expanded={findOpen}
          disabled={!ready}
          onClick={() => {
            setFindOpen(!findOpen)
            if (findOpen)
              bus.current?.dispatch('findbarclose', {
                source: surface.current,
              })
            requestAnimationFrame(() => findInput.current?.focus())
          }}
        >
          <Search />
        </button>
      </div>
      {findOpen ? (
        <div className="file-preview-controls file-findbar">
          <Search />
          <input
            ref={findInput}
            type="search"
            aria-label={t('files.findDocument')}
            placeholder={t('files.findDocument')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              find(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setFindOpen(false)
                bus.current?.dispatch('findbarclose', {
                  source: surface.current,
                })
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                find(query, true, event.shiftKey)
              }
            }}
          />
          <span role="status">
            {query ? `${matches?.current || 0} / ${matches?.total || 0}` : ''}
          </span>
          <button
            aria-label={t('files.previousMatch')}
            disabled={!query}
            onClick={() => find(query, true, true)}
          >
            <ChevronUp />
          </button>
          <button
            aria-label={t('files.nextMatch')}
            disabled={!query}
            onClick={() => find(query, true)}
          >
            <ChevronDown />
          </button>
          <button
            aria-label={t('files.closeSearch')}
            onClick={() => {
              setFindOpen(false)
              bus.current?.dispatch('findbarclose', {
                source: surface.current,
              })
            }}
          >
            <X />
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="file-viewer-message" role="alert">
          {t('files.error.format')}
        </div>
      ) : null}
      {passwordNeeded && !error ? (
        <form
          className="file-viewer-message"
          onSubmit={(event) => {
            event.preventDefault()
            passwordReply.current?.(password)
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
          {passwordWrong ? <p role="alert">{t('files.error.password')}</p> : null}
          <button type="submit">{t('files.open')}</button>
        </form>
      ) : null}
      {!ready && !error && !passwordNeeded ? (
        <div className="file-document-loading" role="status">
          <span className="file-spinner" />
          {t('files.loading')}
        </div>
      ) : null}
      <div className="file-pdf-workspace" hidden={error || passwordNeeded}>
        <div
          className="file-pdf-surface"
          ref={surface}
          tabIndex={0}
          role="region"
          aria-label={t('files.documentPages')}
        >
          <div ref={pages} className="pdfViewer" />
        </div>
      </div>
    </div>
  )
}
