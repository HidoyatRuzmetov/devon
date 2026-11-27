/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Read-only text and sheet regions need keyboard scrolling. */
/* eslint-disable jsx-a11y/media-has-caption -- This viewer plays user-supplied files; caption tracks are not supplied by the attachment API. */
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  AlertTriangle,
  FileQuestion,
  ChevronLeft,
  ChevronRight,
  Search,
  Folder,
  File,
  LockKeyhole,
  ArrowLeft,
  Maximize2,
  Plus,
  Minus,
  FileDown,
  LayoutGrid,
  Files,
} from 'lucide-react'
import { ArchiveClient } from './archive-client.js'
import {
  archiveChildren,
  extension,
  fileKind,
  fileMime,
  formatFileSize,
  PreviewError,
  previewLimits,
  type ArchiveEntry,
} from './file-types.js'
import {
  decodeText,
  safeDocument,
  wordDocument,
  workbook,
  slideDeck,
  openDocument,
  type Sheet,
  type Slide,
} from './document-formats.js'

const PdfPreview = React.lazy(() => import('./pdf-preview.js'))
const OfficePreview = React.lazy(() => import('./office-preview.js'))
const InteractiveHtml = React.lazy(() => import('./interactive-html.js'))
export type PreviewFile = {
  name: string
  data: Uint8Array<ArrayBuffer>
  sourceUrl?: string
}
function useBlobUrl(data: Uint8Array<ArrayBuffer>, mime: string) {
  const [url, setUrl] = React.useState('')
  React.useEffect(() => {
    const value = URL.createObjectURL(new Blob([data], { type: mime }))
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [data, mime])
  return url
}
export function PreviewFailure({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useT()
  const key = error instanceof PreviewError ? error.code : 'format'
  return (
    <div className="file-viewer-message" role="alert">
      <AlertTriangle />
      <h3>{t('files.previewUnavailable')}</h3>
      <p>{t(`files.error.${key}`)}</p>
      {retry ? <button onClick={retry}>{t('files.retry')}</button> : null}
    </div>
  )
}
export function NoPreview({ risky }: { risky: boolean }) {
  const t = useT()
  return (
    <div className={`file-viewer-message ${risky ? 'file-risk' : ''}`}>
      {risky ? <AlertTriangle /> : <FileQuestion />}
      <h3>{t(risky ? 'files.riskyTitle' : 'files.unsupportedTitle')}</h3>
      <p>{t(risky ? 'files.riskyBody' : 'files.unsupportedBody')}</p>
    </div>
  )
}
function DocumentFrame({ html, name }: { html: string; name: string }) {
  return (
    <iframe
      className="file-document-frame"
      title={name}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
    />
  )
}
function columnName(index: number) {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result
  return result
}
function SheetPreview({ sheets }: { sheets: Sheet[] }) {
  const t = useT()
  const id = React.useId()
  const [selected, setSelected] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const sheet = sheets[selected]
  if (!sheet) return <div className="file-viewer-message">{t('files.empty')}</div>
  const width = Math.max(1, ...sheet.rows.map((row) => row.length))
  const rows = sheet.rows
    .map((cells, index) => ({ cells, index }))
    .filter(
      (row) =>
        !query ||
        row.cells.some((cell) => cell.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    )
  return (
    <div className="file-sheet">
      <div className="file-preview-controls">
        <label className="file-search">
          <Search />
          <input
            aria-label={t('files.findRows')}
            placeholder={t('files.findRows')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span>{t('files.rowCount', { count: rows.length })}</span>
      </div>
      <div
        className="file-sheet-grid"
        tabIndex={0}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${selected}`}
      >
        <table>
          <colgroup>
            <col style={{ width: 44 }} />
            {Array.from({ length: width }, (_, index) => (
              <col key={index} style={{ width: sheet.widths?.[index] || 160 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{t('files.row')}</span>
                <span aria-hidden="true">#</span>
              </th>
              {Array.from({ length: width }, (_, index) => (
                <th
                  key={index}
                  scope="col"
                  style={sheet.widths?.[index] === 0 ? { display: 'none' } : undefined}
                >
                  {columnName(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cells, index }) => (
              <tr
                key={index}
                style={{
                  height: sheet.heights?.[index],
                  ...(sheet.heights?.[index] === 0 ? { display: 'none' } : {}),
                }}
              >
                <th scope="row">{index + 1}</th>
                {Array.from({ length: width }, (_, column) => {
                  const cell = sheet.cells?.[`${index}:${column}`]
                  if (cell?.covered && !query) return null
                  return (
                    <td
                      key={column}
                      title={cells[column] ?? ''}
                      rowSpan={query ? 1 : cell?.rowSpan}
                      colSpan={query ? 1 : cell?.colSpan}
                      style={{
                        ...cell?.style,
                        ...(sheet.widths?.[column] === 0 ? { display: 'none' } : {}),
                      }}
                    >
                      {cells[column] ?? ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="file-empty">{t(query ? 'files.noResults' : 'files.empty')}</p>
        ) : null}
      </div>
      {sheet.truncated ? <p className="file-preview-note">{t('files.sheetLimit')}</p> : null}
      <div className="file-sheet-tabs" role="tablist" aria-label={t('files.sheets')}>
        {sheets.map((item, index) => (
          <button
            key={index}
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel`}
            aria-selected={index === selected}
            tabIndex={index === selected ? 0 : -1}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % sheets.length
                  : event.key === 'ArrowLeft'
                    ? (index + sheets.length - 1) % sheets.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? sheets.length - 1
                        : null
              if (next === null) return
              event.preventDefault()
              setSelected(next)
              setQuery('')
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus()
            }}
            onClick={() => {
              setSelected(index)
              setQuery('')
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
    </div>
  )
}
function SlidesPreview({ slides }: { slides: Slide[] }) {
  const t = useT()
  const [page, setPage] = React.useState(0)
  return (
    <div className="file-slides">
      <div className="file-preview-controls">
        <button
          aria-label={t('files.previousPage')}
          onClick={() => setPage(page - 1)}
          disabled={!page}
        >
          <ChevronLeft />
        </button>
        <span>
          {page + 1} / {slides.length}
        </span>
        <button
          aria-label={t('files.nextPage')}
          onClick={() => setPage(page + 1)}
          disabled={page === slides.length - 1}
        >
          <ChevronRight />
        </button>
        <span className="file-preview-note">{t('files.contentPreview')}</span>
      </div>
      {slides[page] ? <DocumentFrame html={slides[page].html} name={slides[page].title} /> : null}
    </div>
  )
}
function RichPreview({ file }: { file: PreviewFile }) {
  const t = useT()
  const [layout, setLayout] = React.useState(false)
  const [result, setResult] = React.useState<{
    html?: string
    sheets?: Sheet[]
    slides?: Slide[]
  }>()
  const [error, setError] = React.useState<unknown>()
  React.useEffect(() => {
    const controller = new AbortController()
    async function read() {
      const kind = fileKind(file.name)
      if (kind === 'word')
        return {
          html: await wordDocument(file.name, file.data, controller.signal),
        }
      if (kind === 'sheet')
        return {
          sheets: await workbook(file.name, file.data, controller.signal),
        }
      if (kind === 'slides')
        return {
          slides: await slideDeck(file.name, file.data, controller.signal),
        }
      if (kind === 'opendocument') return openDocument(file.name, file.data, controller.signal)
      return { html: safeDocument(decodeText(file.data), file.name) }
    }
    void read()
      .then((value) => {
        if (!controller.signal.aborted) setResult(value)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason)
      })
    return () => controller.abort()
  }, [file])
  if (error) return <PreviewFailure error={error} />
  if (!result)
    return (
      <div className="file-viewer-message" role="status">
        <span className="file-spinner" />
        {t('files.loading')}
      </div>
    )
  if (result.sheets)
    return (
      <div className="file-spreadsheet">
        {file.sourceUrl && ['xlsx', 'xltx', 'ods'].includes(extension(file.name)) ? (
          <div
            className="file-preview-controls file-layout-controls"
            role="group"
            aria-label={t('files.documentView')}
          >
            <button aria-pressed={!layout} onClick={() => setLayout(false)}>
              <LayoutGrid />
              {t('files.gridView')}
            </button>
            <button aria-pressed={layout} onClick={() => setLayout(true)}>
              <Files />
              {t('files.printLayout')}
            </button>
          </div>
        ) : null}
        {layout ? (
          <React.Suspense
            fallback={
              <div className="file-viewer-message" role="status">
                {t('files.preparingPages')}
              </div>
            }
          >
            <OfficePreview {...file} />
          </React.Suspense>
        ) : (
          <SheetPreview sheets={result.sheets} />
        )}
      </div>
    )
  if (result.slides) return <SlidesPreview slides={result.slides} />
  return <DocumentFrame html={result.html ?? ''} name={file.name} />
}
function TextPreview({ file }: { file: PreviewFile }) {
  const t = useT()
  const [wrap, setWrap] = React.useState(true)
  const value = React.useMemo(() => {
    try {
      const source = decodeText(file.data)
      if (extension(file.name) === 'json') {
        try {
          return JSON.stringify(JSON.parse(source), null, 2)
        } catch {
          return source
        }
      }
      return source
    } catch (error) {
      return error
    }
  }, [file])
  if (typeof value !== 'string') return <PreviewFailure error={value} />
  return (
    <div className="file-text">
      <div className="file-preview-controls">
        <span>{t('files.lineCount', { count: value.split('\n').length })}</span>
        <button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
          {t('files.wrap')}
        </button>
      </div>
      <pre tabIndex={0} style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>
        {value}
      </pre>
    </div>
  )
}
function ImagePreview({ file }: { file: PreviewFile }) {
  const t = useT()
  const url = useBlobUrl(file.data, fileMime(file.name))
  const [zoom, setZoom] = React.useState(1)
  const [error, setError] = React.useState(false)
  const surface = React.useRef<HTMLDivElement>(null)
  const [natural, setNatural] = React.useState({ width: 0, height: 0 })
  const [available, setAvailable] = React.useState({ width: 0, height: 0 })
  React.useEffect(() => {
    const node = surface.current
    if (!node) return
    const observer = new ResizeObserver(() =>
      setAvailable({
        width: Math.max(1, node.clientWidth - 24),
        height: Math.max(1, node.clientHeight - 24),
      }),
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const fit = Math.min(
    1,
    available.width / (natural.width || 1),
    available.height / (natural.height || 1),
  )
  return (
    <div className="file-image-view">
      <div className="file-preview-controls">
        <button
          aria-label={t('files.zoomOut')}
          disabled={zoom <= 0.5}
          onClick={() => setZoom(zoom - 0.25)}
        >
          <Minus />
        </button>
        <button onClick={() => setZoom(1)}>
          <Maximize2 />
          {t('files.fit')}
        </button>
        <button
          aria-label={t('files.zoomIn')}
          disabled={zoom >= 3}
          onClick={() => setZoom(zoom + 0.25)}
        >
          <Plus />
        </button>
      </div>
      <div
        className="file-image-surface"
        ref={surface}
        tabIndex={0}
        role="region"
        aria-label={file.name}
      >
        {error ? (
          <PreviewFailure error={new PreviewError('format')} />
        ) : url ? (
          <div
            className="file-image-content"
            style={
              natural.width
                ? {
                    width: natural.width * fit * zoom,
                    height: natural.height * fit * zoom,
                  }
                : undefined
            }
          >
            <img
              src={url}
              alt={file.name}
              onError={() => setError(true)}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
function MediaPreview({ file, video }: { file: PreviewFile; video: boolean }) {
  const url = useBlobUrl(file.data, fileMime(file.name))
  const [error, setError] = React.useState(false)
  if (error) return <PreviewFailure error={new PreviewError('format')} />
  return (
    <div className="file-media">
      {url ? (
        video ? (
          <video
            controls
            preload="metadata"
            src={url}
            onError={() => setError(true)}
            aria-label={file.name}
          />
        ) : (
          <audio
            controls
            preload="metadata"
            src={url}
            onError={() => setError(true)}
            aria-label={file.name}
          />
        )
      ) : null}
    </div>
  )
}
function ArchivePreview({ file, depth }: { file: PreviewFile; depth: number }) {
  const t = useT()
  const client = React.useRef<ArchiveClient | null>(null)
  const [entries, setEntries] = React.useState<ArchiveEntry[]>()
  const [folder, setFolder] = React.useState('')
  const [selected, setSelected] = React.useState<PreviewFile>()
  const [selectedPath, setSelectedPath] = React.useState('')
  const [error, setError] = React.useState<unknown>()
  const [busy, setBusy] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)
  const retainedPassword = React.useRef('')
  const requestId = React.useRef(0)
  React.useEffect(() => {
    const archive = new ArchiveClient()
    client.current = archive
    let active = true
    setError(undefined)
    void archive
      .open(file.name, file.data.buffer, retainedPassword.current)
      .then((result) => {
        if (active) setEntries(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason)
      })
    return () => {
      active = false
      archive.close()
    }
  }, [file, attempt])
  const openFile = async (entry: ArchiveEntry) => {
    if (entry.directory) {
      setFolder(entry.path)
      setQuery('')
      return
    }
    const id = ++requestId.current
    setFolder(entry.path.split('/').slice(0, -1).join('/'))
    setQuery('')
    setSelectedPath(entry.path)
    setBusy(true)
    setError(undefined)
    try {
      const data = await client.current?.extract(entry.path, retainedPassword.current)
      if (id === requestId.current && data)
        setSelected({
          name: entry.path.split('/').pop() ?? entry.path,
          data,
          ...(file.sourceUrl ? { sourceUrl: file.sourceUrl } : {}),
        })
    } catch (reason) {
      if (id === requestId.current) setError(reason)
    } finally {
      if (id === requestId.current) setBusy(false)
    }
  }
  const go = (path: string) => {
    ++requestId.current
    setBusy(false)
    setFolder(path)
    setSelected(undefined)
    setSelectedPath('')
    setError(undefined)
    setQuery('')
  }
  const children = entries
    ? query
      ? entries.filter((entry) =>
          entry.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
      : archiveChildren(entries, folder)
    : []
  const downloadUrl = useBlobUrl(selected?.data ?? file.data, fileMime(selected?.name ?? file.name))
  const needsPassword = error instanceof PreviewError && error.code === 'password'
  return (
    <div className="file-archive">
      <div className="file-archive-navigation">
        {selected ? (
          <button
            className="file-folder-back"
            onClick={() => go(folder)}
            aria-label={t('files.backToFolder')}
            title={t('files.backToFolder')}
          >
            <ArrowLeft />
          </button>
        ) : null}
        <nav className="file-archive-path" aria-label={t('files.archiveRoot')}>
          <button aria-label={t('files.archiveRoot')} onClick={() => go('')}>
            <Folder />
            {file.name}
          </button>
          {folder
            .split('/')
            .filter(Boolean)
            .map((part, index, all) => (
              <React.Fragment key={index}>
                <ChevronRight />
                <button onClick={() => go(all.slice(0, index + 1).join('/'))}>{part}</button>
              </React.Fragment>
            ))}
          {selected ? (
            <>
              <ChevronRight />
              <span>{selected.name}</span>
            </>
          ) : null}
        </nav>
        {selected ? (
          <a
            className="file-entry-download"
            href={downloadUrl}
            download={selected.name}
            title={selected.name}
          >
            <FileDown />
            {t('files.downloadEntry')}
          </a>
        ) : null}
      </div>
      {needsPassword ? (
        <form
          className="file-viewer-message"
          onSubmit={(event) => {
            event.preventDefault()
            retainedPassword.current = password
            setPassword('')
            if (entries && selectedPath) {
              const entry = entries.find((item) => item.path === selectedPath)
              if (entry) void openFile(entry)
            } else setAttempt(attempt + 1)
          }}
        >
          <LockKeyhole />
          <h3>{t('files.password')}</h3>
          <input
            aria-label={t('files.password')}
            type="password"
            value={password}
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit">{t('files.open')}</button>
        </form>
      ) : error ? (
        <PreviewFailure
          error={error}
          retry={() => {
            setSelected(undefined)
            setSelectedPath('')
            setAttempt(attempt + 1)
          }}
        />
      ) : busy || !entries ? (
        <div className="file-viewer-message" role="status">
          <span className="file-spinner" />
          {t('files.loading')}
        </div>
      ) : selected ? (
        <FilePreview file={selected} depth={depth + 1} />
      ) : (
        <>
          <div className="file-preview-controls">
            <label className="file-search">
              <Search />
              <input
                type="search"
                aria-label={t('files.findFiles')}
                placeholder={t('files.findFiles')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span>{t('files.itemCount', { count: children.length })}</span>
          </div>
          <div className="file-archive-list">
            <div className="file-archive-list-head">
              <span>{t('files.name')}</span>
              <span>{t('files.size')}</span>
            </div>
            {children.map((entry) => (
              <button
                key={entry.path}
                onClick={() => void openFile(entry)}
                className="file-archive-entry"
              >
                {entry.directory ? <Folder className="file-folder-icon" /> : <File />}
                <span>
                  <strong>{query ? entry.path : entry.path.split('/').pop()}</strong>
                  <small>
                    {entry.directory
                      ? t('files.folder')
                      : fileKind(entry.path) === 'risky'
                        ? t('files.riskyTitle')
                        : extension(entry.path).toUpperCase()}
                  </small>
                </span>
                {entry.encrypted ? <LockKeyhole aria-label={t('files.encrypted')} /> : null}
                <span className="file-entry-size">
                  {entry.directory ? '—' : formatFileSize(entry.size)}
                </span>
                <ChevronRight />
              </button>
            ))}
            {!children.length ? (
              <p className="file-empty">{t(query ? 'files.noResults' : 'files.emptyFolder')}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
export function FilePreview({ file, depth = 0 }: { file: PreviewFile; depth?: number }) {
  const t = useT()
  const kind = fileKind(file.name, file.data)
  if (kind === 'risky' || kind === 'unknown') return <NoPreview risky={kind === 'risky'} />
  if (kind === 'archive' && depth >= previewLimits.depth)
    return <PreviewFailure error={new PreviewError('size')} />
  if (kind === 'archive') return <ArchivePreview file={file} depth={depth} />
  if (
    kind === 'pdf' ||
    kind === 'html' ||
    kind === 'word' ||
    kind === 'slides' ||
    ['odt', 'ott', 'odp', 'xls'].includes(extension(file.name))
  )
    return (
      <React.Suspense
        fallback={
          <div className="file-viewer-message" role="status">
            {t('files.loading')}
          </div>
        }
      >
        {kind === 'pdf' ? (
          <PdfPreview data={file.data} />
        ) : kind === 'html' ? (
          <InteractiveHtml {...file} />
        ) : (
          <OfficePreview {...file} />
        )}
      </React.Suspense>
    )
  if (kind === 'image') return <ImagePreview file={file} />
  if (kind === 'audio' || kind === 'video')
    return <MediaPreview file={file} video={kind === 'video'} />
  if (kind === 'text') return <TextPreview file={file} />
  return <RichPreview file={file} />
}
